/**
 * AT-012: Seller payment gate (PRD §17, FR-050, FR-080, INV-001). Issue #41.
 * Driven through the buyer API over HTTP to the seller; the fake seller counts "upstream model" invocations.
 * The real apps/seller x402 middleware is covered in apps/seller/src/app.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { CODING_PROMPT } from '../fakes/env.js';
import { createHarness } from '../fakes/harness.js';

describe('AT-012: Seller payment gate', () => {
  it('unpaid request gets 402 with model invocations 0; the paid retry releases exactly one invocation', async () => {
    const h = await createHarness();

    // Given/When: an unpaid inference request reaches the seller endpoint (the quote step)
    const body = (await h.route()).json();
    expect(body.state).toBe('QUOTED');
    // Then: 402 came back (the buyer holds a quote) and the model was not invoked
    expect(h.seller.unpaidRequests).toHaveLength(1);
    expect(h.seller.unpaidRequests[0]).toMatchObject({
      offerId: 'fast-code-v1',
      requestId: body.routeId,
    });
    expect(h.seller.modelInvocations).toBe(0);
    expect(h.seller.paidRequests).toHaveLength(0);

    // When: the same request is retried with a valid payment
    await h.execute(body.routeId);
    expect(await h.terminal(body.routeId)).toBe('SUCCEEDED');
    // Then: the invocation count becomes one, bound to the same invoice the 402 issued
    expect(h.seller.modelInvocations).toBe(1);
    expect(h.seller.paidRequests).toHaveLength(1);
    expect(h.seller.paidRequests[0]!.invoiceId).toBe(h.seller.unpaidRequests[0]!.invoiceId);
    expect(h.seller.paidRequests[0]!.transactionHash).toBe(h.signed[0]!.transactionHash);
  });

  it('a direct unpaid call to the seller is a 402 with no model invocation (INV-001 holds without the buyer)', async () => {
    const h = await createHarness();
    const offer = h.registry.getOffer('fast-code-v1')!;
    const res = await fetch(offer.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'direct-1', prompt: CODING_PROMPT }),
    });
    expect(res.status).toBe(402);
    const wire = (await res.json()) as {
      accepts: { scheme: string; extra: { invoiceId: string } }[];
    };
    expect(wire.accepts[0]?.scheme).toBe('exact');
    expect(wire.accepts[0]?.extra.invoiceId).toBeTruthy();
    expect(h.seller.modelInvocations).toBe(0);
  });

  it('seller idempotency by invoice: replaying the identical paid request does not invoke the model again (FR-080)', async () => {
    const h = await createHarness();
    const body = (await h.route()).json();
    await h.execute(body.routeId);
    expect(await h.terminal(body.routeId)).toBe('SUCCEEDED');
    const paid = h.seller.paidRequests[0]!;
    const offer = h.registry.getOffer(paid.offerId)!;

    const replay = await fetch(offer.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'payment-signature': paid.header },
      body: JSON.stringify({ requestId: body.routeId, prompt: CODING_PROMPT }),
    });
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { offerId: string }).offerId).toBe(paid.offerId);
    expect(h.seller.modelInvocations).toBe(1);
    expect(h.ledger.txs.size).toBe(1); // no second settlement either
  });
});
