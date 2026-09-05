/** AT-004: Destination substitution attack (PRD §17, FR-051, SEC-003). Issue #33. */
import { describe, expect, it } from 'vitest';
import { OTHER, SELLER } from '../fakes/env.js';
import { createHarness } from '../fakes/harness.js';

describe('AT-004: Destination substitution attack', () => {
  it('fails the route with QUOTE_REJECTED and never calls the wallet signer', async () => {
    // Given: registry destination is address A; every received requirement carries address B
    const h = await createHarness({ seller: { payTo: OTHER } });
    expect((await h.registry.listActiveOffers()).every((o) => o.payTo === SELLER)).toBe(true);

    const res = await h.route();

    // Then
    // PRD AT-004 / FR-051: 'the route fails with QUOTE_REJECTED' with a safe public reason.
    expect(res.json().error).toMatchObject({
      code: 'QUOTE_REJECTED',
      message: expect.any(String),
      routeId: expect.any(String),
    });
    expect(res.statusCode).toBe(502);
    const routeId = res.json().error.routeId;
    expect(h.states(routeId)).toEqual(['CLASSIFYING', 'ROUTING', 'QUOTING', 'FAILED']);
    expect(h.signCalls).toHaveLength(0);
    expect(await h.paymentRows()).toHaveLength(0);
    // Every eligible offer was tried once and rejected (§14 bounded walk); none was quoted.
    expect(h.seller.unpaidRequests).toHaveLength(2);
    const receipt = await h.receipt(routeId);
    expect(receipt.state).toBe('FAILED');
    expect(receipt.payment.status).toBe('NOT_CREATED');
    expect(receipt.quotedCost).toBeNull();
    for (const c of receipt.candidates.filter(
      (c: { eligibility: string }) => c.eligibility !== 'ineligible',
    ))
      expect(c).toMatchObject({
        eligibility: 'quote_rejected',
        rejectionReasons: ['QUOTE_REJECTED'],
      });
  });
});
