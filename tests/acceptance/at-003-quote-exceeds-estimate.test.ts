/** AT-003: Authoritative quote exceeds estimate (PRD §17, FR-051). Issue #33. */
import { describe, expect, it } from 'vitest';
import { createHarness } from '../fakes/harness.js';

describe('AT-003: Authoritative quote exceeds estimate', () => {
  it('rejects the over-budget quote, signs nothing for that offer, tries the next eligible unpaid offer', async () => {
    // Given: fast-code-v1 is estimated at 0.006000 but quotes 0.021000; maxCost is 0.020000
    const h = await createHarness({ seller: { prices: { 'fast-code-v1': '0.021000' } } });
    expect(h.registry.getOffer('fast-code-v1')?.advertisedPrice).toBe('0.006000');

    const res = await h.route({ maxCost: '0.020000' });
    expect(res.statusCode).toBe(201);
    const body = res.json();

    // Then: quote rejected, router moved to the next eligible unpaid offer
    expect(body.state).toBe('QUOTED');
    expect(body.selected.offerId).toBe('deep-reasoning-v1');
    expect(body.selected.quotedCost).toBe('0.015000');
    const fastCode = body.candidates.find((c: { offerId: string }) => c.offerId === 'fast-code-v1');
    expect(fastCode).toMatchObject({
      eligibility: 'quote_rejected',
      rejectionReasons: ['QUOTE_OVER_BUDGET'],
      estimatedCost: '0.006000',
      quotedCost: null,
    });
    expect(h.seller.unpaidRequests.map((r) => r.offerId)).toEqual([
      'fast-code-v1',
      'deep-reasoning-v1',
    ]);
    expect(h.metrics.quoteRejectedByReason).toEqual({ QUOTE_OVER_BUDGET: 1 });
    expect(h.signCalls).toHaveLength(0);

    // And: when executed, the only signature is for the next offer, never for the rejected one
    await h.execute(body.routeId);
    expect(await h.terminal(body.routeId)).toBe('SUCCEEDED');
    expect(h.signCalls).toHaveLength(1);
    expect(h.signCalls[0]?.amount).toBe('0.015000');
    expect(h.seller.paidRequests.map((r) => r.offerId)).toEqual(['deep-reasoning-v1']);
    expect(h.seller.modelInvocations).toBe(1);
  });

  it('every eligible quote over budget: route FAILED with an error envelope; nothing signed or paid', async () => {
    const h = await createHarness({
      seller: { prices: { 'fast-code-v1': '0.021000', 'deep-reasoning-v1': '0.030000' } },
    });
    const res = await h.route({ maxCost: '0.020000' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    // §14 exhausted walk; the PRD pins no public code for this case (FR-051 marks each offer quote_over_budget).
    expect(res.json().error).toMatchObject({
      routeId: expect.any(String),
      message: expect.any(String),
    });
    const receipt = await h.receipt(res.json().error.routeId);
    for (const c of receipt.candidates.filter(
      (c: { eligibility: string }) => c.eligibility !== 'ineligible',
    ))
      expect(c).toMatchObject({
        eligibility: 'quote_rejected',
        rejectionReasons: ['QUOTE_OVER_BUDGET'],
      });
    expect((await h.receipt(res.json().error.routeId)).state).toBe('FAILED');
    expect(h.signCalls).toHaveLength(0);
    expect(await h.paymentRows()).toHaveLength(0);
  });
});
