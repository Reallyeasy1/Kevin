/**
 * Routing explanation (PRD FR-041), generated from structured score deltas — never free-form reasoning.
 * Wording is relative to registry/config values; it never claims empirical superiority.
 */
import { Decimal } from 'decimal.js';
import type { RoutingMode, TaskProfile, TaskType } from '@subbuddy/contracts';
import type { ScoredCandidate } from './scoring.js';

export interface RoutingExplanation {
  taskType: TaskType;
  mode: RoutingMode;
  selectedOfferId: string;
  factors: { quality: string; cost: string; latency: string; reliability: string };
  finalScore: string;
  estimatedCost: string;
  quotedCost: string | null;
  /** Structured deltas versus the highest-quality eligible offer (null when it is the selection). */
  deltas: {
    highestQualityOfferId: string;
    /** Positive means the selection is cheaper, as a percentage of the comparison price. */
    costSavingPct: string;
    /** Quality gap in percentage points (comparison minus selection). */
    qualityGapPts: string;
  } | null;
  explanation: string;
}

const MODE_LABEL: Record<RoutingMode, string> = {
  balanced: 'Balanced',
  quality: 'Quality',
  cheapest: 'Cheapest',
  fastest: 'Fastest',
};

const TASK_LABEL: Record<TaskType, string> = {
  general_chat: 'general chat',
  coding: 'coding',
  mathematical_reasoning: 'mathematical reasoning',
  summarization: 'summarization',
  extraction: 'extraction',
  creative_writing: 'creative writing',
  long_context_analysis: 'long-context analysis',
};

/** `ranked` is the output of `scoreOffers` (index 0 selected). */
export function explainSelection(
  ranked: readonly ScoredCandidate[],
  profile: TaskProfile,
  mode: RoutingMode,
  quotedCost: string | null = null,
): RoutingExplanation {
  const selected = ranked[0];
  if (!selected) throw new Error('explainSelection requires at least one ranked candidate');
  const task = TASK_LABEL[profile.taskType];
  const n = ranked.length;

  const first =
    mode === 'cheapest'
      ? `Selected ${selected.offer.displayName} because it had the lowest advertised price (${selected.offer.advertisedPrice} ${selected.offer.asset.code}) among ${n} eligible offer${n === 1 ? '' : 's'} for a ${task} task.`
      : mode === 'fastest'
        ? `Selected ${selected.offer.displayName} because it had the lowest p50 latency (${selected.offer.p50LatencyMs} ms) among ${n} eligible offer${n === 1 ? '' : 's'} for a ${task} task.`
        : `Selected ${selected.offer.displayName} because it had the highest ${MODE_LABEL[mode]} score for a ${task} task.`;

  // Highest-quality eligible offer: quality desc, then offerId for determinism.
  const best = [...ranked].sort(
    (a, b) =>
      new Decimal(b.qualityScore).cmp(a.qualityScore) ||
      a.offer.offerId.localeCompare(b.offer.offerId),
  )[0]!;

  let deltas: RoutingExplanation['deltas'] = null;
  let second: string;
  if (n === 1) {
    second = 'It was the only eligible offer.';
  } else if (best.offer.offerId === selected.offer.offerId) {
    second = `It also had the highest ${task} quality score (${selected.qualityScore}) among the ${n} eligible offers.`;
  } else {
    const bestPrice = new Decimal(best.offer.advertisedPrice);
    const saving = bestPrice.isZero()
      ? new Decimal(0)
      : bestPrice.minus(selected.offer.advertisedPrice).div(bestPrice).mul(100);
    const gap = new Decimal(best.qualityScore).minus(selected.qualityScore).mul(100);
    deltas = {
      highestQualityOfferId: best.offer.offerId,
      costSavingPct: saving.toFixed(4),
      qualityGapPts: gap.toFixed(4),
    };
    const costClause = saving.isZero()
      ? 'was estimated to cost the same as'
      : saving.gt(0)
        ? `was estimated to cost ${saving.toFixed(0)}% less than`
        : `was estimated to cost ${saving.abs().toFixed(0)}% more than`;
    second = `It ${costClause} the highest-quality eligible offer (${best.offer.displayName}) while remaining within ${gap.toDecimalPlaces(0, Decimal.ROUND_CEIL).toFixed(0)} percentage points of its ${task} quality score.`;
  }

  return {
    taskType: profile.taskType,
    mode,
    selectedOfferId: selected.offer.offerId,
    factors: {
      quality: selected.qualityScore,
      cost: selected.costScore,
      latency: selected.latencyScore,
      reliability: selected.reliabilityScore,
    },
    finalScore: selected.finalScore,
    estimatedCost: selected.offer.advertisedPrice,
    quotedCost,
    deltas,
    explanation: `${first} ${second}`,
  };
}
