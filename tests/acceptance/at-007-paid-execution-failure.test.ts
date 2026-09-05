/** AT-007: Paid execution failure (PRD §17, FR-081, INV-004). */
import { describe, expect, it } from 'vitest';
import { createHarness } from '../fakes/harness.js';

describe('AT-007: Paid execution failure', () => {
  it('payment validated, upstream fails: PAID_EXECUTION_FAILED, payment shown as succeeded, no second purchase', async () => {
    const h = await createHarness({ seller: { upstreamFails: true } });
    const { routeId } = (await h.route()).json();
    await h.execute(routeId);

    expect(await h.terminal(routeId)).toBe('PAID_EXECUTION_FAILED');
    expect(h.signCalls).toHaveLength(1);
    expect(h.seller.paidRequests).toHaveLength(1);
    expect(h.seller.modelInvocations).toBe(1);

    // And: the UI can state that payment succeeded
    const receipt = await h.receipt(routeId);
    expect(receipt.state).toBe('PAID_EXECUTION_FAILED');
    expect(receipt.payment.status).toBe('SETTLED');
    expect(receipt.payment.transactionHash).toBe(h.signed[0]!.transactionHash);
    // ponytail: X402PaymentClient maps the seller's 502 to OUTCOME_UNKNOWN before the ledger check; the route
    // state is what AT-007 pins, the execution failureCode is the adapter's wording.
    expect(receipt.execution).toMatchObject({ status: 'failed', failureCode: expect.any(String) });
    expect(receipt.result).toBeNull();
    const failed = h.events.replay(routeId).find((e) => e.type === 'route.failed');
    expect(failed?.payload).toMatchObject({ code: 'PAID_EXECUTION_FAILED' });

    // And: the router does not purchase another offer; there is no second payment after PAID_EXECUTION_FAILED
    expect(await h.paymentRows()).toHaveLength(1);
    expect(h.ledger.txs.size).toBe(1);
    const again = await h.execute(routeId);
    expect(again.statusCode).toBe(202);
    expect(again.json()).toMatchObject({ routeId, state: 'PAID_EXECUTION_FAILED' });
    expect(h.signCalls).toHaveLength(1);
    expect(h.seller.paidRequests).toHaveLength(1);
    expect(await h.paymentRows()).toHaveLength(1);
    expect(h.metrics.paidExecutionFailed).toBe(1);
  });
});
