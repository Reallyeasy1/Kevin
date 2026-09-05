/** §19 required metrics. ponytail: in-memory counters served as JSON at /metrics; swap for prom-client if scraped. */
interface Timing {
  count: number;
  sumMs: number;
  maxMs: number;
}

const timing = (): Timing => ({ count: 0, sumMs: 0, maxMs: 0 });
const bump = (k: Record<string, number>, key: string): void => {
  k[key] = (k[key] ?? 0) + 1;
};

export class Metrics {
  routesCreated = 0;
  routesCompleted = 0;
  noEligibleOffer = 0;
  quoteRejectedByReason: Record<string, number> = {};
  payment = { success: 0, failure: 0, unknown: 0 };
  paidExecutionFailed = 0;
  routeLatency = timing();
  settlementLatency = timing();
  providerLatency = timing();
  selectedOffer: Record<string, number> = {};

  quoteRejected(reason: string): void {
    bump(this.quoteRejectedByReason, reason);
  }
  selected(offerId: string): void {
    bump(this.selectedOffer, offerId);
  }
  observe(which: 'routeLatency' | 'settlementLatency' | 'providerLatency', ms: number): void {
    const t = this[which];
    t.count += 1;
    t.sumMs += ms;
    if (ms > t.maxMs) t.maxMs = ms;
  }
  snapshot(): Record<string, unknown> {
    return { ...this } as unknown as Record<string, unknown>;
  }
}
