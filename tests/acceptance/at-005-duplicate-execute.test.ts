/** AT-005: Duplicate execute calls (PRD §17, FR-071, SEC-007). Issues #34, #56. */
import { describe, expect, it } from 'vitest';
import { createHarness } from '../fakes/harness.js';

describe('AT-005: Duplicate execute calls', () => {
  it('concurrent executes submit at most one payment; all callers observe the same route and payment state', async () => {
    const h = await createHarness();
    const { routeId } = (await h.route()).json();

    // When: several execute requests arrive concurrently for the same route
    const results = await Promise.all(Array.from({ length: 5 }, () => h.execute(routeId)));
    for (const r of results) expect(r.statusCode).toBe(202);
    expect(await h.terminal(routeId)).toBe('SUCCEEDED');

    // Then: DB uniqueness elected one winner; one signature, one paid request, one payment row
    expect(h.signCalls).toHaveLength(1);
    expect(h.seller.paidRequests).toHaveLength(1);
    expect(h.seller.modelInvocations).toBe(1);
    expect(h.ledger.txs.size).toBe(1);
    const rows = await h.paymentRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ routeId, status: 'SETTLED' });

    // And: every caller sees the same route/payment state
    const receipts = await Promise.all(results.map(() => h.receipt(routeId)));
    const first = receipts[0];
    for (const r of receipts) {
      expect(r.state).toBe('SUCCEEDED');
      expect(r.payment).toEqual(first.payment);
    }

    // A later repeated execute is idempotent by routeId: existing state, no second transaction (§11.3).
    const again = await h.execute(routeId);
    expect(again.statusCode).toBe(202);
    expect(again.json()).toMatchObject({ routeId, state: 'SUCCEEDED' });
    expect(h.signCalls).toHaveLength(1);
    expect(h.seller.paidRequests).toHaveLength(1);
    expect(await h.paymentRows()).toHaveLength(1);
  });

  it('UNIQUE(routeId | quoteId | invoiceId) rejects a second payment row for the same route (FR-071)', async () => {
    const h = await createHarness();
    const { routeId } = (await h.route()).json();
    await h.execute(routeId);
    await h.terminal(routeId);
    const [row] = await h.paymentRows();
    const dup = (over: Record<string, unknown>) =>
      h.db.payment.create({
        data: {
          routeId: 'other-route',
          quoteId: 'other-quote',
          invoiceId: 'other-invoice',
          payerAddress: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
          destination: 'rhaDe3NBxgUSLL12N5Sxpii2xy8vSyXNG6',
          amount: '0.006000',
          assetCode: 'RLUSD',
          ...over,
        },
      });
    await expect(dup({ routeId })).rejects.toMatchObject({ code: 'P2002' });
    await expect(dup({ quoteId: row!.quoteId })).rejects.toMatchObject({ code: 'P2002' });
    await expect(dup({ invoiceId: row!.invoiceId })).rejects.toMatchObject({ code: 'P2002' });
    await expect(dup({ transactionHash: row!.transactionHash })).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(await h.paymentRows()).toHaveLength(1);
  });
});
