/**
 * NFR-001: route computation excluding the external quote, p95 under 2 seconds (PRD §16, §19). Issue #82.
 * Uses the in-process fake PaymentClient so the measured window is classify + filter + score + persist only.
 */
import { describe, expect, it } from 'vitest';
import { createHarness } from '../fakes/harness.js';

const RUNS = 20;
const P95_BUDGET_MS = 2_000;

describe('NFR-001: Routing latency budget', () => {
  it(`p95 of ${RUNS} POST /v1/routes calls is under ${P95_BUDGET_MS} ms with the quote mocked`, async () => {
    const h = await createHarness({ payments: 'fake' });
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const res = await h.route({
        prompt: `Run ${i}: refactor this typescript function for readability.`,
      });
      samples.push(performance.now() - t0);
      expect(res.statusCode).toBe(201);
      expect(res.json().state).toBe('QUOTED');
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(0.95 * RUNS) - 1]!;
    expect(p95).toBeLessThan(P95_BUDGET_MS);
    // The service's own routeLatency metric agrees (§19).
    expect(h.metrics.routeLatency.count).toBe(RUNS);
    expect(h.metrics.routeLatency.maxMs).toBeLessThan(P95_BUDGET_MS);
  });
});
