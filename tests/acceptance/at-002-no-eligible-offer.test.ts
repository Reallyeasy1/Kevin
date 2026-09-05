/** AT-002: No offer within budget (PRD §17, FR-030). */
import { describe, expect, it } from 'vitest';
import { createHarness } from '../fakes/harness.js';

describe('AT-002: No offer within budget', () => {
  it('ends NO_ELIGIBLE_OFFER, never calls the signer, creates no payment record', async () => {
    const h = await createHarness();
    // Given: every active offer is advertised above 0.001000
    const offers = await h.registry.listActiveOffers();
    expect(offers.every((o) => o.advertisedPrice > '0.001000')).toBe(true);

    // When: maxCost 0.001000
    const res = await h.route({ maxCost: '0.001000' });

    // Then
    expect(res.statusCode).toBe(201);
    expect(res.json().state).toBe('NO_ELIGIBLE_OFFER');
    expect(res.json().selected).toBeNull();
    expect(res.json().candidates).toHaveLength(3);
    expect(
      res.json().candidates.every((c: { eligibility: string }) => c.eligibility === 'ineligible'),
    ).toBe(true);
    expect(h.states(res.json().routeId)).toEqual(['CLASSIFYING', 'ROUTING', 'NO_ELIGIBLE_OFFER']);
    expect(h.signCalls).toHaveLength(0); // signer not called
    expect(await h.paymentRows()).toHaveLength(0); // no payment record
    expect(h.seller.unpaidRequests).toHaveLength(0); // no quote was even requested
    const receipt = await h.receipt(res.json().routeId);
    expect(receipt.payment.status).toBe('NOT_CREATED');
    expect(receipt.quotedCost).toBeNull();

    // A terminal route cannot be executed.
    const exec = await h.execute(res.json().routeId);
    expect(exec.statusCode).toBe(409);
    expect(exec.json().error.code).toBe('CONFLICT');
    expect(h.signCalls).toHaveLength(0);
  });
});
