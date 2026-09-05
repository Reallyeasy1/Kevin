/** NFR-004: the API survives one seller failure and one classifier failure (PRD §16, §14). Issue #79. */
import { describe, expect, it } from 'vitest';
import { downLlmClassifier } from '../fakes/classifier.js';
import { createHarness } from '../fakes/harness.js';

describe('NFR-004: API availability under one seller and one classifier failure', () => {
  it('top-ranked seller down (500) and LLM classifier down: the route still quotes, pays once, and succeeds', async () => {
    const h = await createHarness({
      seller: { failOffers: ['fast-code-v1'] },
      classifier: downLlmClassifier(),
    });

    const res = await h.route();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.taskProfile.taskType).toBe('coding'); // fallback classifier carried the request
    expect(body.state).toBe('QUOTED');
    expect(body.selected.offerId).toBe('deep-reasoning-v1'); // walked past the dead seller (§14)
    const dead = body.candidates.find((c: { offerId: string }) => c.offerId === 'fast-code-v1');
    expect(dead).toMatchObject({
      eligibility: 'quote_rejected',
      rejectionReasons: ['SELLER_UNAVAILABLE'],
    });
    expect(h.metrics.quoteRejectedByReason).toEqual({ SELLER_UNAVAILABLE: 1 });

    await h.execute(body.routeId);
    expect(await h.terminal(body.routeId)).toBe('SUCCEEDED');
    expect(h.signCalls).toHaveLength(1);
    expect(h.seller.paidRequests.map((r) => r.offerId)).toEqual(['deep-reasoning-v1']);

    // The API is still serving: health, offers, and a second route on the same process.
    expect((await h.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const second = await h.route({ prompt: 'Write a python script that parses CSV files.' });
    expect(second.statusCode).toBe(201);
    expect(second.json().state).toBe('QUOTED');
  });

  it('every seller down: retryable error envelope, route FAILED, nothing signed, API still up', async () => {
    const h = await createHarness({
      seller: { failOffers: ['fast-code-v1', 'deep-reasoning-v1', 'fast-text-v1'] },
    });
    const res = await h.route();
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    // §14 pins the behaviour (bounded walk, nothing signed, retryable), not the public code.
    expect(['SELLER_UNAVAILABLE', 'NO_ELIGIBLE_OFFER']).toContain(res.json().error.code);
    expect(res.json().error).toMatchObject({ retryable: true, routeId: expect.any(String) });
    expect((await h.receipt(res.json().error.routeId)).state).toBe('FAILED');
    expect(h.signCalls).toHaveLength(0);
    expect(await h.paymentRows()).toHaveLength(0);
    expect((await h.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({
      status: 'ok',
      service: 'api',
    });
  });
});
