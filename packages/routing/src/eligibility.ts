/**
 * Eligibility filtering (PRD FR-030). Every removed offer carries machine-readable reasons; rejected offers
 * are never quoted or paid.
 */
import { Decimal } from 'decimal.js';
import type { InferenceOffer, SettlementAssetCode, TaskProfile } from '@subbuddy/contracts';

export const REJECTION_REASONS = [
  'OFFER_DISABLED',
  'CAPABILITY_MISSING',
  'CONTEXT_WINDOW_TOO_SMALL',
  'TOOL_CALLING_UNSUPPORTED',
  'NETWORK_MISMATCH',
  'ASSET_MISMATCH',
  'SELLER_NOT_ALLOWLISTED',
  'DESTINATION_NOT_ALLOWLISTED',
  'ESTIMATED_COST_EXCEEDS_MAX',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface EligibilityContext {
  profile: TaskProfile;
  /** Decimal string (INV-006). */
  maxCost: string;
  /** Configured CAIP-2 network, e.g. "xrpl:1". */
  network: string;
  asset: SettlementAssetCode;
  /** Mandate allowlists (FR-002). Omit a set to skip that check. */
  allowedSellerIds?: ReadonlySet<string>;
  allowedPayTo?: ReadonlySet<string>;
}

export interface RejectedOffer {
  offer: InferenceOffer;
  reasons: RejectionReason[];
}

export interface EligibilityResult {
  eligible: InferenceOffer[];
  rejected: RejectedOffer[];
}

export function rejectionReasons(
  offer: InferenceOffer,
  ctx: EligibilityContext,
): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  const { profile } = ctx;
  if (!offer.enabled) reasons.push('OFFER_DISABLED');
  if (!offer.capabilities.includes(profile.taskType)) reasons.push('CAPABILITY_MISSING');
  if (profile.requiredContextTokens > offer.contextWindow) reasons.push('CONTEXT_WINDOW_TOO_SMALL');
  if (profile.toolCallingRequired && !offer.supportsTools) reasons.push('TOOL_CALLING_UNSUPPORTED');
  if (offer.network !== ctx.network) reasons.push('NETWORK_MISMATCH');
  if (offer.asset.code !== ctx.asset) reasons.push('ASSET_MISMATCH');
  if (ctx.allowedSellerIds && !ctx.allowedSellerIds.has(offer.sellerId)) {
    reasons.push('SELLER_NOT_ALLOWLISTED');
  }
  if (ctx.allowedPayTo && !ctx.allowedPayTo.has(offer.payTo)) {
    reasons.push('DESTINATION_NOT_ALLOWLISTED');
  }
  if (new Decimal(offer.advertisedPrice).gt(new Decimal(ctx.maxCost))) {
    reasons.push('ESTIMATED_COST_EXCEEDS_MAX');
  }
  return reasons;
}

export function filterEligible(
  offers: readonly InferenceOffer[],
  ctx: EligibilityContext,
): EligibilityResult {
  const result: EligibilityResult = { eligible: [], rejected: [] };
  for (const offer of offers) {
    const reasons = rejectionReasons(offer, ctx);
    if (reasons.length === 0) result.eligible.push(offer);
    else result.rejected.push({ offer, reasons });
  }
  return result;
}
