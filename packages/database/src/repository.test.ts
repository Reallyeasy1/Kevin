import { describe, expect, it } from 'vitest';
import { createFakeDb } from './fake-db.js';
import { createRepository, type ClaimPaymentInput } from './repository.js';
import { createSpendLedger } from './spend-ledger.js';

const routeInput = {
  promptHash: 'a'.repeat(64),
  mode: 'balanced' as const,
  maxCost: '0.500000',
  assetCode: 'RLUSD',
  network: 'xrpl:1',
  registryVersion: 'v1',
  expiresAt: new Date('2026-09-05T00:05:00Z'),
};

async function seed() {
  const db = createFakeDb();
  const repo = createRepository(db);
  const route = await repo.createRoute(routeInput);
  await repo.saveCandidates(route.id, [
    {
      offerId: 'offer-1',
      eligibility: 'selected',
      rejectionReasons: [],
      qualityScore: '0.9',
      costScore: '0.8',
      latencyScore: '0.7',
      reliabilityScore: '0.95',
      finalScore: '0.85',
      estimatedCost: '0.010000',
    },
  ]);
  const quote = await repo.saveQuote({
    routeId: route.id,
    invoiceId: 'inv-1',
    sellerId: 'seller-1',
    offerId: 'offer-1',
    destination: 'rSELLER',
    amount: '0.012345',
    assetCode: 'RLUSD',
    assetIssuer: 'rISSUER',
    network: 'xrpl:1',
    rawRequirementHash: 'h',
    expiresAt: new Date('2026-09-05T00:02:00Z'),
  });
  const claim: ClaimPaymentInput = {
    routeId: route.id,
    quoteId: quote.id,
    invoiceId: 'inv-1',
    payerAddress: 'rPAYER',
    destination: 'rSELLER',
    amount: '0.012345',
    assetCode: 'RLUSD',
  };
  return { db, repo, route, quote, claim };
}

describe('repository', () => {
  it('claimPayment: concurrent execute calls yield exactly one claim (FR-071, SEC-007)', async () => {
    const { repo, claim } = await seed();
    const results = await Promise.all([
      repo.claimPayment(claim),
      repo.claimPayment(claim),
      repo.claimPayment(claim),
    ]);
    const winners = results.filter((r) => r.claimed);
    expect(winners).toHaveLength(1);
    expect(new Set(results.map((r) => r.paymentId)).size).toBe(1);
  });

  it('rejects a second payment reusing the invoice or tx hash on another route', async () => {
    const { repo, claim } = await seed();
    const first = await repo.claimPayment(claim);
    await repo.updatePayment(first.paymentId, {
      status: 'SIGNED',
      transactionHash: 'HASH1',
      signedTxBlob: 'BLOB',
    });
    const other = await repo.createRoute(routeInput);
    // same invoiceId, different route: the P2002 fallback looks up by routeId and finds nothing
    await expect(
      repo.claimPayment({ ...claim, routeId: other.id, quoteId: 'q2' }),
    ).rejects.toThrow();
    const second = await repo.claimPayment({
      ...claim,
      routeId: other.id,
      quoteId: 'q2',
      invoiceId: 'inv-2',
    });
    expect(second.claimed).toBe(true);
    await expect(
      repo.updatePayment(second.paymentId, { transactionHash: 'HASH1' }),
    ).resolves.toBeUndefined();
  });

  it('getRoute returns receipt data with money as strings and no signed blob (INV-006, SEC-009)', async () => {
    const { repo, route, claim } = await seed();
    const { paymentId } = await repo.claimPayment(claim);
    await repo.updatePayment(paymentId, {
      status: 'SIGNED',
      signedTxBlob: 'SECRET',
      transactionHash: 'HASH',
    });
    await repo.saveExecution({
      routeId: route.id,
      invoiceId: 'inv-1',
      offerId: 'offer-1',
      modelId: 'm',
      status: 'succeeded',
      latencyMs: 12,
    });
    const r = await repo.getRoute(route.id);
    expect(r?.maxCost).toBe('0.5'); // Decimal.toFixed() drops trailing zeros; compare money numerically downstream
    expect(r?.quote?.amount).toBe('0.012345');
    expect(r?.payment?.amount).toBe('0.012345');
    expect(r?.candidates[0]?.finalScore).toBe('0.85');
    expect(r?.execution?.status).toBe('succeeded');
    expect(JSON.stringify(r)).not.toContain('SECRET');
    expect((await repo.getSignedPayment(route.id))?.signedTxBlob).toBe('SECRET');
  });
});

describe('spend ledger (SEC-011)', () => {
  it('sums signed/sent/settled payments in the rolling hour as a decimal string', async () => {
    const { db, repo, claim } = await seed();
    const { paymentId } = await repo.claimPayment(claim);
    const ledger = createSpendLedger(db);
    // INV-012: a CREATED claim counts so concurrent executes see each other's pending spend...
    expect(await ledger.spentLastHour()).toBe('0.012345');
    // ...but the claimant excludes its own row so its amount is not counted twice.
    expect(await ledger.spentLastHour(new Date(), paymentId)).toBe('0');
    expect(await ledger.wouldExceedCap('0.012345', '0.012345', new Date(), paymentId)).toBe(false);
    await repo.updatePayment(paymentId, { status: 'SETTLED' });
    expect(await ledger.spentLastHour()).toBe('0.012345');
    expect(await ledger.wouldExceedCap('1.000000', '0.987655')).toBe(false);
    expect(await ledger.wouldExceedCap('1.000000', '0.987656')).toBe(true);
    // POLICY_REJECTED payments and payments older than an hour do not count
    await repo.updatePayment(paymentId, { status: 'POLICY_REJECTED' });
    expect(await ledger.spentLastHour()).toBe('0');
    await repo.updatePayment(paymentId, { status: 'SETTLED' });
    expect(await ledger.spentLastHour(new Date(Date.now() + 2 * 3600_000))).toBe('0');
  });
});
