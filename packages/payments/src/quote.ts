import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { canonicalPaymentRequirementsJson, type XRPLNetworkId } from 'x402-xrpl';
import {
  CurrencyHex,
  XrplAddress,
  type DecimalString,
  type ExactPayment,
  type InferenceOffer,
  type PaymentRequirement,
  type XrplNetworkId,
  XRPL_NETWORKS,
} from '@subbuddy/contracts';
import { PaymentError } from './errors.js';

// FR-020: the SDK exports XRPLNetworkId as a type only, so this is the runtime-free drift check.
export const SDK_NETWORK_IDS = Object.values(XRPL_NETWORKS) satisfies readonly XRPLNetworkId[];

/** The scheme's default SourceTag (x402-xrpl README). */
export const DEFAULT_SOURCE_TAG = 804681468;

/** Configured settlement network/asset (FR-051). `currencyHex` is the 40-hex RLUSD code; XRP is always allowed as fallback. */
export interface ExpectedSettlement {
  network: XrplNetworkId;
  currencyHex: CurrencyHex;
  issuer: XrplAddress;
}

/** One `accepts[]` entry as received on the wire. Kept internal; callers see `PaymentRequirement`. */
export interface RawRequirement {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  amount: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown> | null;
}

export interface ValidateQuoteContext {
  offer: InferenceOffer;
  expected: ExpectedSettlement;
  /** `resource.url` from the 402 body; the request/resource binding. */
  resource: string | undefined;
  receivedAt: Date;
  now?: Date;
  /** Mandate ceiling; omit when not yet known (checked again by the policy engine, FR-060). */
  maxCost?: DecimalString;
  /** True when `extra.invoiceId` was already seen (FR-051). */
  invoiceSeen?: boolean;
}

const reject = (reason: string): never => {
  throw new PaymentError('QUOTE_REJECTED', reason);
};

function extraString(
  extra: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const v = extra?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function requirementHash(raw: RawRequirement): string {
  return createHash('sha256').update(canonicalPaymentRequirementsJson(raw)).digest('hex');
}

/**
 * FR-051 validation matrix. Pure; throws PaymentError(QUOTE_REJECTED) with a safe public reason.
 * Never mutates or "fixes" the quote (INV-005).
 */
export function validateQuote(raw: RawRequirement, ctx: ValidateQuoteContext): PaymentRequirement {
  const { offer, expected } = ctx;
  if (raw.scheme !== 'exact') reject('unsupported payment scheme');
  if (raw.network !== expected.network) reject('network mismatch');
  if (offer.network !== expected.network) reject('offer network mismatch');

  const asset = raw.asset.trim().toUpperCase();
  const issuer = extraString(raw.extra, 'issuer');
  const offerAsset = offer.asset.currencyHex ?? 'XRP';
  if (asset !== 'XRP' && !CurrencyHex.safeParse(asset).success) reject('asset not supported');
  if (asset !== 'XRP' && asset !== expected.currencyHex) reject('asset mismatch');
  if (asset !== offerAsset) reject('asset does not match offer');
  if (asset === 'XRP') {
    if (issuer !== null) reject('issuer not allowed for XRP');
  } else {
    if (issuer !== expected.issuer) reject('issuer mismatch');
    if (issuer !== offer.asset.issuer) reject('issuer does not match offer');
  }

  if (!XrplAddress.safeParse(raw.payTo).success) reject('invalid destination');
  if (raw.payTo !== offer.payTo) reject('destination does not match registry');

  const invoiceId = extraString(raw.extra, 'invoiceId');
  if (!invoiceId) reject('invoice id missing');
  if (ctx.invoiceSeen) reject('invoice id already used');
  if (!ctx.resource) reject('resource binding missing');

  if (!/^\d+(\.\d+)?$/.test(raw.amount)) reject('invalid amount');
  const amount = new Decimal(raw.amount);
  if (!amount.greaterThan(0)) reject('amount must be positive');
  if (asset === 'XRP' && !amount.isInteger()) reject('XRP amount must be whole drops');
  if (ctx.maxCost !== undefined && amount.greaterThan(new Decimal(ctx.maxCost)))
    reject('quote exceeds budget');

  if (!Number.isInteger(raw.maxTimeoutSeconds) || raw.maxTimeoutSeconds <= 0)
    reject('invalid timeout');
  const expiresAt = new Date(ctx.receivedAt.getTime() + raw.maxTimeoutSeconds * 1000);
  if (expiresAt.getTime() <= (ctx.now ?? new Date()).getTime()) reject('quote expired');

  // Exact scheme carries no partial-payment or path behaviour; anything advertising it is unsupported.
  const extra = raw.extra ?? {};
  if (
    extra['partialPayment'] === true ||
    extra['paths'] !== undefined ||
    extra['crossCurrency'] === true
  )
    reject('partial or path payments not supported');

  return {
    scheme: 'exact',
    network: expected.network,
    asset: asset as PaymentRequirement['asset'],
    issuer: asset === 'XRP' ? null : (issuer as XrplAddress),
    payTo: raw.payTo,
    amount: raw.amount,
    invoiceId: invoiceId as string,
    resource: ctx.resource as string,
    maxTimeoutSeconds: raw.maxTimeoutSeconds,
    expiresAt: expiresAt.toISOString(),
    requirementHash: requirementHash(raw),
    rawRequirementJson: JSON.stringify(raw),
  };
}

/** Rebuild the wire `accepted` object from the immutable requirement (for PAYMENT-SIGNATURE). */
export function toRawRequirement(req: PaymentRequirement, sourceTag: number): RawRequirement {
  return {
    scheme: 'exact',
    network: req.network,
    asset: req.asset,
    payTo: req.payTo,
    amount: req.amount,
    maxTimeoutSeconds: req.maxTimeoutSeconds,
    extra: { invoiceId: req.invoiceId, sourceTag, ...(req.issuer ? { issuer: req.issuer } : {}) },
  };
}

export function toExactPayment(req: PaymentRequirement): ExactPayment {
  return {
    destination: req.payTo,
    amount: req.amount,
    asset: req.asset,
    issuer: req.issuer,
    network: req.network,
    invoiceId: req.invoiceId,
  };
}

/** SEC-005: what is about to be signed must equal the immutable quote, field by field. */
export function assertExactMatchesRequirement(exact: ExactPayment, req: PaymentRequirement): void {
  const want = toExactPayment(req);
  for (const key of Object.keys(want) as (keyof ExactPayment)[]) {
    if (exact[key] !== want[key])
      throw new PaymentError('QUOTE_REJECTED', `${key} changed since quote`);
  }
  if (new Date(req.expiresAt).getTime() <= Date.now())
    throw new PaymentError('QUOTE_REJECTED', 'quote expired');
}
