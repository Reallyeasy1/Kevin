/** AT-006: Lost submission response (PRD §17, FR-071, FR-072, §14). Issue #34. */
import { describe, expect, it } from 'vitest';
import { createHarness } from '../fakes/harness.js';

describe('AT-006: Lost submission response', () => {
  it('seller settled then the response was lost: outcome resolved by hash; no replacement payment', async () => {
    const h = await createHarness({ seller: { dropPaidResponse: 'after-settle' } });
    const { routeId } = (await h.route()).json();
    await h.execute(routeId);

    // Then: the worker resolves the known transaction on the ledger instead of paying again
    expect(await h.terminal(routeId)).toBe('PAID_EXECUTION_FAILED'); // paid, validated, no result delivered
    expect(h.states(routeId).slice(-5)).toEqual([
      'SIGNED',
      'PAID_REQUEST_SENT',
      'OUTCOME_UNKNOWN',
      'VERIFYING',
      'PAID_EXECUTION_FAILED',
    ]);
    expect(h.signCalls).toHaveLength(1); // never re-signed (INV-011)
    expect(h.seller.paidRequests).toHaveLength(1);
    expect(await h.paymentRows()).toHaveLength(1);
    const receipt = await h.receipt(routeId);
    expect(receipt.payment).toMatchObject({
      status: 'SETTLED',
      transactionHash: h.signed[0]!.transactionHash,
      ledgerIndex: h.ledger.txs.get(h.signed[0]!.transactionHash)!.ledgerIndex,
    });
    expect(h.metrics.payment).toEqual({ success: 1, failure: 0, unknown: 1 });
  });

  it('response lost and the ledger never sees the hash: PAYMENT_FAILED after LastLedgerSequence; no re-sign', async () => {
    const h = await createHarness({ seller: { dropPaidResponse: 'before-settle' } });
    const { routeId } = (await h.route()).json();
    await h.execute(routeId);
    // The paid request is in flight over a real socket; the ledger closes past LastLedgerSequence meanwhile.
    h.ledger.validatedIndex = h.signed[0]!.lastLedgerSequence + 1;

    expect(await h.terminal(routeId)).toBe('PAYMENT_FAILED');
    expect(h.states(routeId).slice(-3)).toEqual(['OUTCOME_UNKNOWN', 'VERIFYING', 'PAYMENT_FAILED']);
    expect(h.signCalls).toHaveLength(1);
    expect(h.ledger.txs.size).toBe(0); // no money moved
    const receipt = await h.receipt(routeId);
    expect(receipt.payment).toMatchObject({
      status: 'VALIDATED_FAILED',
      failureCode: 'NOT_FOUND_AFTER_LAST_LEDGER',
    });
    const failed = h.events.replay(routeId).find((e) => e.type === 'route.failed');
    expect(failed?.payload).toMatchObject({ code: 'PAYMENT_FAILED' });
    // Re-execute reports the terminal state and does not sign a replacement (FR-071).
    const again = await h.execute(routeId);
    expect(again.json()).toMatchObject({ state: 'PAYMENT_FAILED' });
    expect(h.signCalls).toHaveLength(1);
  });
});
