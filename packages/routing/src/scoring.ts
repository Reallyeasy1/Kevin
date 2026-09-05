/**
 * Deterministic scoring (PRD FR-040). Normalisation is over the ELIGIBLE set, never maxCost.
 * All arithmetic is decimal.js; scores are 4-dp decimal strings.
 */
import { Decimal } from 'decimal.js';
import type { InferenceOffer, RoutingMode, TaskProfile } from '@subbuddy/contracts';

interface Weights {
  quality: string;
  cost: string;
  latency: string;
  reliability: string;
}

/** FR-040 weight tables; each row sums to exactly 1.00. */
export const MODE_WEIGHTS: Record<RoutingMode, Weights> = {
  balanced: { quality: '0.45', cost: '0.30', latency: '0.15', reliability: '0.10' },
  quality: { quality: '0.70', cost: '0.10', latency: '0.10', reliability: '0.10' },
  cheapest: { quality: '0.15', cost: '0.65', latency: '0.10', reliability: '0.10' },
  fastest: { quality: '0.15', cost: '0.15', latency: '0.60', reliability: '0.10' },
};

export interface ScoredCandidate {
  offer: InferenceOffer;
  /** Normalised factors and final score, each a 4-dp decimal string in [0,1]. */
  qualityScore: string;
  costScore: string;
  latencyScore: string;
  reliabilityScore: string;
  finalScore: string;
}

const ONE = new Decimal(1);
const dp4 = (d: Decimal): string => d.toFixed(4);

/** quality(c) = qualityByTask[taskType], falling back to general_chat, then 0. */
export function qualityFor(offer: InferenceOffer, taskType: TaskProfile['taskType']): Decimal {
  return new Decimal(offer.qualityByTask[taskType] ?? offer.qualityByTask.general_chat ?? 0);
}

/**
 * Scores and ranks eligible offers; index 0 is the selection. Ranking is one comparator:
 * mode guarantee (Cheapest: lowest price, Fastest: lowest p50) -> final score desc ->
 * lower price -> higher reliability -> smaller offerId.
 */
export function scoreOffers(
  eligible: readonly InferenceOffer[],
  profile: TaskProfile,
  mode: RoutingMode,
): ScoredCandidate[] {
  if (eligible.length === 0) return [];
  const w = MODE_WEIGHTS[mode];
  const single = eligible.length === 1;
  const maxPrice = Decimal.max(...eligible.map((o) => o.advertisedPrice));
  const maxLatency = new Decimal(Math.max(...eligible.map((o) => o.p50LatencyMs)));

  const scored = eligible.map((offer) => {
    const quality = qualityFor(offer, profile.taskType);
    // FR-040: single member => cost = latency = 1. A zero max price (free offers) is also 1, not NaN.
    const cost =
      single || maxPrice.isZero()
        ? ONE
        : ONE.minus(new Decimal(offer.advertisedPrice).div(maxPrice));
    const latency = single ? ONE : ONE.minus(new Decimal(offer.p50LatencyMs).div(maxLatency));
    const reliability = new Decimal(offer.reliability);
    const final = quality
      .mul(w.quality)
      .plus(cost.mul(w.cost))
      .plus(latency.mul(w.latency))
      .plus(reliability.mul(w.reliability));
    return {
      offer,
      qualityScore: dp4(quality),
      costScore: dp4(cost),
      latencyScore: dp4(latency),
      reliabilityScore: dp4(reliability),
      finalScore: dp4(final),
    };
  });

  return scored.sort((a, b) => {
    const priceCmp = new Decimal(a.offer.advertisedPrice).cmp(b.offer.advertisedPrice);
    if (mode === 'cheapest' && priceCmp !== 0) return priceCmp;
    if (mode === 'fastest' && a.offer.p50LatencyMs !== b.offer.p50LatencyMs) {
      return a.offer.p50LatencyMs - b.offer.p50LatencyMs;
    }
    const scoreCmp = new Decimal(b.finalScore).cmp(a.finalScore);
    if (scoreCmp !== 0) return scoreCmp;
    if (priceCmp !== 0) return priceCmp;
    if (a.offer.reliability !== b.offer.reliability)
      return b.offer.reliability - a.offer.reliability;
    return a.offer.offerId < b.offer.offerId ? -1 : a.offer.offerId > b.offer.offerId ? 1 : 0;
  });
}
