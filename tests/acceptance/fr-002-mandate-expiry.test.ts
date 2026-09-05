/** FR-002: request-scoped authorization expires with the mandate (PRD §18.1 "mandate expiry"). */
import { describe, expect, it } from 'vitest';
import { createHarness } from '../fakes/harness.js';

describe('FR-002: mandate expiry', () => {
  it('execute after the mandate TTL is rejected 410 MANDATE_EXPIRED before signing', async () => {
    let now = new Date('2026-01-01T00:00:00Z');
    const h = await createHarness({ mandateTtlSeconds: 60, now: () => now });
    const res = await h.route();
    expect(res.statusCode).toBe(201);
    const { routeId, expiresAt } = res.json();
    expect(new Date(expiresAt).getTime()).toBe(now.getTime() + 60_000);

    now = new Date(now.getTime() + 61_000);
    const exec = await h.execute(routeId);

    expect(exec.statusCode).toBe(410);
    expect(exec.json().error).toMatchObject({ code: 'MANDATE_EXPIRED', routeId });
    expect(h.signCalls).toHaveLength(0);
    expect(h.seller.paidRequests).toHaveLength(0);
    const rows = await h.paymentRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('POLICY_REJECTED');
    expect((await h.receipt(routeId)).state).toBe('POLICY_REJECTED');
  });

  it('FR-010: the classification source reaches metrics', async () => {
    const h = await createHarness();
    await h.route();
    expect(h.metrics.classifierSource).toEqual({ fallback: 1 });
    expect(h.metrics.toPrometheus()).toContain(
      'subbuddy_classifier_source_total{source="fallback"} 1',
    );
  });
});
