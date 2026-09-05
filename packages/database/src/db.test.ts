import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { createRepository } from './repository.js';

// Real Postgres; run `pnpm db:up && pnpm --filter @subbuddy/database db:push` then set DATABASE_URL.
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('repository against Postgres (FR-071 / AT-005)', () => {
  const db = createDb(url ?? '');
  const repo = createRepository(db);
  afterAll(() => db.$disconnect());

  it('the unique constraints let exactly one concurrent claim win', async () => {
    const route = await repo.createRoute({
      promptHash: 'x'.repeat(64),
      mode: 'balanced',
      maxCost: '0.100000',
      assetCode: 'RLUSD',
      network: 'xrpl:1',
      registryVersion: 'test',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const invoiceId = `inv-${route.id}`;
    const quote = await repo.saveQuote({
      routeId: route.id,
      invoiceId,
      sellerId: 's',
      offerId: 'o',
      destination: 'rSELLER',
      amount: '0.001000',
      assetCode: 'RLUSD',
      assetIssuer: null,
      network: 'xrpl:1',
      rawRequirementHash: 'h',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const claim = {
      routeId: route.id,
      quoteId: quote.id,
      invoiceId,
      payerAddress: 'rPAYER',
      destination: 'rSELLER',
      amount: '0.001000',
      assetCode: 'RLUSD',
    };
    const results = await Promise.all(Array.from({ length: 5 }, () => repo.claimPayment(claim)));
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(new Set(results.map((r) => r.paymentId)).size).toBe(1);
    expect((await repo.getRoute(route.id))?.payment?.amount).toBe('0.001');
  });
});
