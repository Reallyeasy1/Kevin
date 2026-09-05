/**
 * §19 required metrics as in-process counters, served at GET /metrics in Prometheus text exposition format
 * (no dependency). ponytail: single process, no histograms; latency is count/sum/max. Swap for prom-client
 * if buckets are ever needed.
 */
interface Timing {
  count: number;
  sumMs: number;
  maxMs: number;
}

const timing = (): Timing => ({ count: 0, sumMs: 0, maxMs: 0 });
const bump = (k: Record<string, number>, key: string): void => {
  k[key] = (k[key] ?? 0) + 1;
};
const label = (v: string): string =>
  v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

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
  /** FR-010: classification source (llm | fallback). */
  classifierSource: Record<string, number> = {};

  quoteRejected(reason: string): void {
    bump(this.quoteRejectedByReason, reason);
  }
  classified(source: string): void {
    bump(this.classifierSource, source);
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

  /** Prometheus text format 0.0.4. */
  toPrometheus(): string {
    const out: string[] = [];
    const counter = (name: string, help: string, value: number) =>
      out.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`, `${name} ${value}`);
    const labelled = (name: string, help: string, key: string, values: Record<string, number>) => {
      out.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
      for (const [k, v] of Object.entries(values).sort())
        out.push(`${name}{${key}="${label(k)}"} ${v}`);
    };
    const summary = (name: string, help: string, t: Timing) =>
      out.push(
        `# HELP ${name} ${help}`,
        `# TYPE ${name} summary`,
        `${name}_count ${t.count}`,
        `${name}_sum ${t.sumMs}`,
        `# HELP ${name}_max Maximum observed ${help}`,
        `# TYPE ${name}_max gauge`,
        `${name}_max ${t.maxMs}`,
      );

    counter('subbuddy_routes_created_total', 'Routes created.', this.routesCreated);
    counter(
      'subbuddy_routes_completed_total',
      'Routes that reached SUCCEEDED.',
      this.routesCompleted,
    );
    counter(
      'subbuddy_no_eligible_offer_total',
      'Routes with no eligible offer.',
      this.noEligibleOffer,
    );
    labelled(
      'subbuddy_quote_rejected_total',
      'Quotes rejected, by reason.',
      'reason',
      this.quoteRejectedByReason,
    );
    labelled('subbuddy_payment_total', 'Payment outcomes.', 'outcome', this.payment);
    counter(
      'subbuddy_paid_execution_failed_total',
      'Settled payments with no delivered result.',
      this.paidExecutionFailed,
    );
    summary(
      'subbuddy_route_latency_ms',
      'route latency in ms (create to quoted).',
      this.routeLatency,
    );
    summary(
      'subbuddy_settlement_latency_ms',
      'settlement latency in ms (paid request sent to validated).',
      this.settlementLatency,
    );
    summary(
      'subbuddy_provider_latency_ms',
      'seller-reported provider latency in ms.',
      this.providerLatency,
    );
    labelled(
      'subbuddy_selected_offer_total',
      'Selected-offer distribution.',
      'offer_id',
      this.selectedOffer,
    );
    labelled(
      'subbuddy_classifier_source_total',
      'Classification source (FR-010).',
      'source',
      this.classifierSource,
    );
    return out.join('\n') + '\n';
  }
}
