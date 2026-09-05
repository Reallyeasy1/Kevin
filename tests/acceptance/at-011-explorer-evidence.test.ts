/** AT-011: Explorer evidence (PRD §17, FR-072, FR-093). Issue #40. */
import { describe, expect, it, test } from 'vitest';
import { EXPLORER_BASE, RLUSD_HEX } from '../fakes/env.js';
import { createHarness } from '../fakes/harness.js';

describe('AT-011: Explorer evidence', () => {
  it('explorer link = XRPL_EXPLORER_BASE + hash; ledger destination and amount match the receipt', async () => {
    const h = await createHarness();
    const { routeId } = (await h.route()).json();
    await h.execute(routeId);
    expect(await h.terminal(routeId)).toBe('SUCCEEDED');

    const receipt = await h.receipt(routeId);
    const hash: string = receipt.payment.transactionHash;
    expect(hash).toMatch(/^[0-9A-F]{64}$/);
    expect(receipt.payment.explorerUrl).toBe(`${EXPLORER_BASE}${hash}`);
    expect(receipt.payment.explorerUrl).toBe(`https://testnet.xrpl.org/transactions/${hash}`);

    // The same hash on the (fake) ledger shows the receipt's destination and asset amount.
    const onLedger = h.ledger.txs.get(hash);
    expect(onLedger).toBeDefined();
    expect(onLedger).toMatchObject({
      destination: receipt.payment.destination,
      amount: receipt.payment.amount,
      asset: RLUSD_HEX,
      ledgerIndex: receipt.payment.ledgerIndex,
      resultCode: 'tesSUCCESS',
    });
    expect(receipt.payment.validatedAt).toBe(onLedger!.validatedAt);
    expect(receipt.payment.assetCode).toBe('RLUSD');

    // The SSE stream carried the same explorer URL on payment.submitted and payment.validated.
    const withUrl = h.events
      .replay(routeId)
      .filter((e) => e.type === 'payment.submitted' || e.type === 'payment.validated');
    expect(withUrl).toHaveLength(2);
    for (const e of withUrl)
      expect(e.payload).toMatchObject({
        transactionHash: hash,
        explorerUrl: `${EXPLORER_BASE}${hash}`,
      });
  });

  // Manual live evidence (PRD §18.3): run `pnpm tsx scripts/smoke-testnet.ts`, open the printed explorer link at
  // https://testnet.xrpl.org/transactions/<hash>, confirm destination, amount and asset match GET /v1/routes/:id,
  // then record hash + link in docs/EVIDENCE.md (README "Manual live Testnet smoke test", step 5).
  test.skip('AT-011 live Testnet explorer evidence (manual: scripts/smoke-testnet.ts)', () =>
    undefined);
});
