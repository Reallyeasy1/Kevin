/**
 * @subbuddy/contracts — shared Zod schemas, domain types, and adapter interfaces (PRD §8, §10.3, §11, §12).
 *
 * Money is always a decimal string (INV-006). No external SDK types appear here (PRD §10.3).
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Non-negative decimal as a string, e.g. "0.006200". Never a JS number (INV-006). */
export const DecimalString = z.string().regex(/^\d+(\.\d+)?$/, 'decimal string required');
export type DecimalString = z.infer<typeof DecimalString>;

/** CAIP-2 XRPL network id as used on the x402 wire, e.g. "xrpl:1". "xrpl:testnet" is invalid (FR-020). */
export const XrplNetworkId = z.string().regex(/^xrpl:\d+$/, 'CAIP-2 xrpl:<id> required');
export type XrplNetworkId = z.infer<typeof XrplNetworkId>;

/**
 * CAIP-2 ids as defined by x402-xrpl 0.3.x (`XRPLNetworkId = "xrpl:0" | "xrpl:1" | "xrpl:2"`; xrpl:1 resolves to
 * s.altnet.rippletest.net). The SDK exports the type only, so this mirror is the runtime source of truth (FR-020).
 * packages/payments must assert it against the SDK type so drift fails typecheck (the SDK stays there, PRD §10.3).
 */
export const XRPL_NETWORKS = { mainnet: 'xrpl:0', testnet: 'xrpl:1', devnet: 'xrpl:2' } as const;

/** Strictly positive decimal string, e.g. maxCost (FR-001). */
export const PositiveDecimalString = DecimalString.refine((v) => /[1-9]/.test(v), 'must be > 0');
export type PositiveDecimalString = z.infer<typeof PositiveDecimalString>;

/** Classic XRPL address. */
export const XrplAddress = z
  .string()
  .regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, 'XRPL address required');
export type XrplAddress = z.infer<typeof XrplAddress>;

/** 40-hex issued-currency code (FR-020). */
export const CurrencyHex = z.string().regex(/^[0-9A-F]{40}$/, '40-hex currency code required');
export type CurrencyHex = z.infer<typeof CurrencyHex>;

export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 hex required');
export type Sha256Hex = z.infer<typeof Sha256Hex>;

export const IsoTimestamp = z.iso.datetime({ offset: true });
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

// ---------------------------------------------------------------------------
// Enums (FR-010, FR-001, §9, FR-092, §11.1)
// ---------------------------------------------------------------------------

export const TASK_TYPES = [
  'general_chat',
  'coding',
  'mathematical_reasoning',
  'summarization',
  'extraction',
  'creative_writing',
  'long_context_analysis',
] as const;
export const TaskType = z.enum(TASK_TYPES);
export type TaskType = z.infer<typeof TaskType>;

export const ROUTING_MODES = ['balanced', 'quality', 'cheapest', 'fastest'] as const;
export const RoutingMode = z.enum(ROUTING_MODES);
export type RoutingMode = z.infer<typeof RoutingMode>;

export const ReasoningLevel = z.enum(['low', 'medium', 'high']);
export type ReasoningLevel = z.infer<typeof ReasoningLevel>;

export const InputModality = z.enum(['text']);
export type InputModality = z.infer<typeof InputModality>;

export const SettlementAssetCode = z.enum(['RLUSD', 'XRP']);
export type SettlementAssetCode = z.infer<typeof SettlementAssetCode>;

export const ROUTE_STATES = [
  'CLASSIFYING',
  'ROUTING',
  'NO_ELIGIBLE_OFFER',
  'QUOTING',
  'QUOTED',
  'POLICY_APPROVED',
  'POLICY_REJECTED',
  'SIGNED',
  'PAID_REQUEST_SENT',
  'OUTCOME_UNKNOWN',
  'VERIFYING',
  'SUCCEEDED',
  'PAID_EXECUTION_FAILED',
  'PAYMENT_FAILED',
  'FAILED',
] as const;
export const RouteState = z.enum(ROUTE_STATES);
export type RouteState = z.infer<typeof RouteState>;

export const PAYMENT_STATES = [
  'NOT_CREATED',
  'CREATED',
  'POLICY_REJECTED',
  'SIGNED',
  'SENT',
  'SETTLED',
  'VALIDATED_FAILED',
  'OUTCOME_UNKNOWN',
] as const;
export const PaymentState = z.enum(PAYMENT_STATES);
export type PaymentState = z.infer<typeof PaymentState>;

export const ExecutionStatus = z.enum(['pending', 'running', 'succeeded', 'failed']);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

export const CandidateEligibility = z.enum([
  'eligible',
  'ineligible',
  'selected',
  'quote_rejected',
  'not_quoted',
]);
export type CandidateEligibility = z.infer<typeof CandidateEligibility>;

export const ERROR_CODES = [
  'UNAUTHORIZED',
  'VALIDATION_ERROR',
  'PROMPT_TOO_LARGE',
  'NO_ELIGIBLE_OFFER',
  'QUOTE_REJECTED',
  'POLICY_REJECTED',
  'SPEND_CAP_REACHED',
  'MANDATE_EXPIRED',
  'PROMPT_MISMATCH',
  'PAYMENT_FAILED',
  'PAID_EXECUTION_FAILED',
  'SELLER_UNAVAILABLE',
  'SELLER_MISCONFIGURED',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Standard error envelope (§11.1). Message must be safe to display; no stack traces or raw payloads. */
export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    retryable: z.boolean(),
    routeId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

// ---------------------------------------------------------------------------
// Classification (FR-010)
// ---------------------------------------------------------------------------

export const TaskProfile = z.object({
  taskType: TaskType,
  reasoningLevel: ReasoningLevel,
  inputModality: InputModality,
  estimatedInputTokens: z.number().int().nonnegative(),
  requiredContextTokens: z.number().int().positive(),
  toolCallingRequired: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export type TaskProfile = z.infer<typeof TaskProfile>;

/** FR-010: unknown or invalid classifier output falls back to this. */
export const FALLBACK_TASK_PROFILE: TaskProfile = {
  taskType: 'general_chat',
  reasoningLevel: 'medium',
  inputModality: 'text',
  estimatedInputTokens: 0,
  requiredContextTokens: 4096,
  toolCallingRequired: false,
  confidence: 0,
};

export interface ClassifyInput {
  prompt: string;
  maxOutputTokens?: number;
}

// ---------------------------------------------------------------------------
// Offer registry (FR-020, FR-021)
// ---------------------------------------------------------------------------

export const OfferAsset = z.object({
  code: SettlementAssetCode,
  /** 40-hex wire code for issued currencies; null for native XRP. */
  currencyHex: CurrencyHex.nullable(),
  /** Issuer address for issued currencies; null for native XRP. */
  issuer: XrplAddress.nullable(),
  decimals: z.number().int().min(0).max(15),
});
export type OfferAsset = z.infer<typeof OfferAsset>;

export const OfferSource = z.enum(['curated', 'xrpl-ai-hub']);
export type OfferSource = z.infer<typeof OfferSource>;

export const InferenceOffer = z.object({
  offerId: z.string().min(1),
  sellerId: z.string().min(1),
  displayName: z.string().min(1),
  modelId: z.string().min(1),
  endpoint: z.url(),
  payTo: XrplAddress,
  network: XrplNetworkId,
  asset: OfferAsset,
  capabilities: z.array(TaskType).min(1),
  contextWindow: z.number().int().positive(),
  supportsTools: z.boolean(),
  /** Registry estimate per request; the x402 quote is authoritative (DEC-010). */
  advertisedPrice: DecimalString,
  p50LatencyMs: z.number().int().positive(),
  reliability: z.number().min(0).max(1),
  qualityByTask: z.partialRecord(TaskType, z.number().min(0).max(1)),
  enabled: z.boolean(),
  source: OfferSource.default('curated'),
  hubServiceId: z.string().optional(),
  hubUrl: z.url().optional(),
});
export type InferenceOffer = z.infer<typeof InferenceOffer>;

// ---------------------------------------------------------------------------
// Seller wire contract (§11.8, FR-080)
// ---------------------------------------------------------------------------

export const SellerInferenceRequest = z.object({
  requestId: z.string().min(1),
  prompt: z.string().min(1),
  maxOutputTokens: z.number().int().positive().optional(),
});
export type SellerInferenceRequest = z.infer<typeof SellerInferenceRequest>;

export const SellerInferenceResponse = z.object({
  requestId: z.string().min(1),
  offerId: z.string().min(1),
  modelId: z.string().min(1),
  content: z.string(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  providerLatencyMs: z.number().int().nonnegative(),
});
export type SellerInferenceResponse = z.infer<typeof SellerInferenceResponse>;

/** Outbound request to a registry seller. `endpoint` MUST come from the registry (SEC-003). */
export interface SellerRequest {
  offerId: string;
  endpoint: string;
  requestId: string;
  prompt: string;
  promptHash: Sha256Hex;
  maxOutputTokens?: number;
}

// ---------------------------------------------------------------------------
// x402 payment requirement / quote (FR-050, FR-051, §12.3)
// ---------------------------------------------------------------------------

/** SDK-agnostic view of the seller's 402 requirement. Immutable once obtained (INV-005). */
export const PaymentRequirement = z.object({
  scheme: z.literal('exact'),
  network: XrplNetworkId,
  /** "XRP" or the 40-hex currency code as carried on the wire. */
  asset: z.union([z.literal('XRP'), CurrencyHex]),
  issuer: XrplAddress.nullable(),
  payTo: XrplAddress,
  amount: DecimalString,
  /** `extra.invoiceId` from the requirement; binds the payment to the invoice (SEC-006). */
  invoiceId: z.string().min(1),
  /** Request/resource binding present in the requirement. */
  resource: z.string().min(1),
  maxTimeoutSeconds: z.number().int().positive(),
  expiresAt: IsoTimestamp,
  /** SHA-256 over the canonical raw requirement (§12.3 rawRequirementHash). */
  requirementHash: Sha256Hex,
  /** The exact `accepts[]` entry as received, JSON-encoded, so the requirement can be rebuilt byte-identical after restart (INV-005). */
  rawRequirementJson: z.string().optional(),
});
export type PaymentRequirement = z.infer<typeof PaymentRequirement>;

// ---------------------------------------------------------------------------
// Signing (FR-070)
// ---------------------------------------------------------------------------

/** Exactly what the signer may sign. Revalidated against the quote immediately before signing (SEC-005). */
export interface ExactPayment {
  destination: XrplAddress;
  amount: DecimalString;
  asset: 'XRP' | CurrencyHex;
  issuer: XrplAddress | null;
  network: XrplNetworkId;
  /** Raw invoice id; the signer sets InvoiceID = sha256(invoiceId) (scheme Method B). */
  invoiceId: string;
}

/**
 * Result of the single signing event (INV-011). `signedTxBlob` is server-side only and MUST NOT
 * appear in any public API response (SEC-009).
 */
export interface SignedPayment {
  signedTxBlob: string;
  transactionHash: string;
  payerAddress: XrplAddress;
  sequence: number;
  lastLedgerSequence: number;
}

// ---------------------------------------------------------------------------
// Paid retry and settlement (FR-071, FR-072)
// ---------------------------------------------------------------------------

export interface PayAndRetryInput {
  request: SellerRequest;
  requirement: PaymentRequirement;
  signed: SignedPayment;
}

/** Facilitator settle metadata echoed by the seller in PAYMENT-RESPONSE. Not proof of settlement (INV-009). */
export interface PaymentResponseMeta {
  success: boolean;
  transactionHash: string | null;
  network: XrplNetworkId;
  payer: XrplAddress | null;
}

export interface PaidSellerResponse {
  result: SellerInferenceResponse;
  paymentResponse: PaymentResponseMeta | null;
}

/** Ledger facts for one hash. Only `validated` with `success` may produce SETTLED (INV-009). */
export type SettlementResult =
  | {
      status: 'validated';
      transactionHash: string;
      success: boolean;
      resultCode: string;
      ledgerIndex: number;
      validatedAt: IsoTimestamp;
      destination: XrplAddress;
      amount: DecimalString;
      asset: 'XRP' | CurrencyHex;
    }
  | {
      status: 'not_found';
      transactionHash: string;
      /** Latest validated ledger; compare with the persisted LastLedgerSequence to decide failed vs pending. */
      currentLedgerIndex: number;
    }
  | {
      /** The node could not search the whole ledger range (no history). Never a failure; poll again (INV-009). */
      status: 'unknown';
      transactionHash: string;
    };

// ---------------------------------------------------------------------------
// Adapter interfaces (PRD §10.3). External SDK types never cross these boundaries.
// ---------------------------------------------------------------------------

export interface Classifier {
  classify(input: ClassifyInput): Promise<TaskProfile>;
}

export interface ProviderRegistry {
  listActiveOffers(): Promise<InferenceOffer[]>;
  /** Hash of the offer set behind listActiveOffers(); stored on every route (INV-010, §12.1). */
  readonly registryVersion: string;
}

export interface PaymentClient {
  obtainRequirement(request: SellerRequest): Promise<PaymentRequirement>;
  payAndRetry(input: PayAndRetryInput): Promise<PaidSellerResponse>;
  /** `range` = first ledger the payment could appear in .. LastLedgerSequence; lets the node say "not searched" vs "not found". */
  resolveTransaction(hash: string, range?: LedgerRange): Promise<SettlementResult>;
}

export interface LedgerRange {
  minLedger: number;
  maxLedger: number;
}

export interface WalletSigner {
  getAddress(): Promise<string>;
  signExactPayment(input: ExactPayment): Promise<SignedPayment>;
}

// ---------------------------------------------------------------------------
// Public receipt (FR-090, SEC-009). No seed, no upstream key, no signed blob, no hidden reasoning.
// ---------------------------------------------------------------------------

export const RouteCandidateView = z.object({
  offerId: z.string(),
  sellerId: z.string(),
  displayName: z.string(),
  eligibility: CandidateEligibility,
  rejectionReasons: z.array(z.string()),
  qualityScore: DecimalString.nullable(),
  costScore: DecimalString.nullable(),
  latencyScore: DecimalString.nullable(),
  reliabilityScore: DecimalString.nullable(),
  finalScore: DecimalString.nullable(),
  estimatedCost: DecimalString,
  quotedCost: DecimalString.nullable(),
  source: OfferSource,
});
export type RouteCandidateView = z.infer<typeof RouteCandidateView>;

export const PaymentReceipt = z.object({
  status: PaymentState,
  payerAddress: XrplAddress.nullable(),
  destination: XrplAddress.nullable(),
  amount: DecimalString.nullable(),
  assetCode: SettlementAssetCode.nullable(),
  transactionHash: z.string().nullable(),
  explorerUrl: z.url().nullable(),
  ledgerIndex: z.number().int().nullable(),
  validatedAt: IsoTimestamp.nullable(),
  failureCode: z.string().nullable(),
});
export type PaymentReceipt = z.infer<typeof PaymentReceipt>;

export const ExecutionReceipt = z.object({
  status: ExecutionStatus,
  modelId: z.string().nullable(),
  latencyMs: z.number().int().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  failureCode: z.string().nullable(),
});
export type ExecutionReceipt = z.infer<typeof ExecutionReceipt>;

export const Receipt = z.object({
  routeId: z.string(),
  promptHash: Sha256Hex,
  taskProfile: TaskProfile,
  mode: RoutingMode,
  state: RouteState,
  candidates: z.array(RouteCandidateView),
  selectedOfferId: z.string().nullable(),
  estimatedCost: DecimalString.nullable(),
  quotedCost: DecimalString.nullable(),
  policyDecision: z
    .object({
      approved: z.boolean(),
      checks: z.array(
        z.object({ name: z.string(), passed: z.boolean(), reason: z.string().optional() }),
      ),
    })
    .nullable(),
  payment: PaymentReceipt,
  execution: ExecutionReceipt,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type Receipt = z.infer<typeof Receipt>;

// ---------------------------------------------------------------------------
// Buyer API wire contract (§11). Every schema here is a public shape: z.object strips unknown keys, so
// parsing a server-side record through these drops signedTxBlob and other internals (SEC-009).
// ---------------------------------------------------------------------------

/** FR-001: prompts above this return PROMPT_TOO_LARGE (the API maps the `too_big` issue on `prompt`). */
export const PROMPT_MAX_CHARS = 32_000;

export const RouteRequest = z.object({
  prompt: z
    .string()
    .max(PROMPT_MAX_CHARS)
    .refine((p) => p.trim().length > 0, 'prompt must not be empty'),
  mode: RoutingMode,
  maxCost: PositiveDecimalString,
  maxOutputTokens: z.number().int().positive().optional(),
});
export type RouteRequest = z.infer<typeof RouteRequest>;

/** FR-002: request-scoped authorization the policy engine checks before signing. Server-side. */
export const Mandate = z.object({
  promptHash: Sha256Hex,
  maxCost: PositiveDecimalString,
  asset: SettlementAssetCode,
  network: XrplNetworkId,
  allowedSellerIds: z.array(z.string().min(1)).min(1),
  expiresAt: IsoTimestamp,
});
export type Mandate = z.infer<typeof Mandate>;

/** The public subset of the mandate echoed in POST /v1/routes (§11.2). */
export const PublicMandate = Mandate.pick({
  maxCost: true,
  network: true,
  asset: true,
  expiresAt: true,
});
export type PublicMandate = z.infer<typeof PublicMandate>;

export const SelectedOffer = z.object({
  offerId: z.string().min(1),
  sellerName: z.string().min(1),
  modelId: z.string().min(1),
  /** Four decimal places (FR-040). */
  score: DecimalString,
  estimatedCost: DecimalString,
  quotedCost: DecimalString.nullable(),
  asset: SettlementAssetCode,
  /** Generated from structured score deltas, never chain-of-thought (FR-041, DEC-012). */
  reason: z.string().min(1),
});
export type SelectedOffer = z.infer<typeof SelectedOffer>;

export const RouteResponse = z.object({
  routeId: z.string().min(1),
  state: RouteState,
  expiresAt: IsoTimestamp,
  taskProfile: TaskProfile,
  selected: SelectedOffer.nullable(),
  candidates: z.array(RouteCandidateView),
  mandate: PublicMandate,
});
export type RouteResponse = z.infer<typeof RouteResponse>;

export const ExecuteRequest = z.object({ prompt: z.string().min(1) });
export type ExecuteRequest = z.infer<typeof ExecuteRequest>;

/** GET /v1/routes/:id (§11.4): the receipt plus the fields the UI needs that FR-090 leaves implicit. */
export const RouteView = Receipt.extend({
  selected: SelectedOffer.nullable(),
  result: z.string().nullable(),
  expiresAt: IsoTimestamp,
});
export type RouteView = z.infer<typeof RouteView>;

export const ExecuteResponse = z.object({
  routeId: z.string().min(1),
  state: RouteState,
  statusUrl: z.string().min(1),
  eventsUrl: z.string().min(1),
});
export type ExecuteResponse = z.infer<typeof ExecuteResponse>;

export const ROUTE_EVENT_TYPES = [
  'route.state_changed',
  'payment.submitted',
  'payment.validated',
  'execution.started',
  'execution.completed',
  'route.failed',
] as const;
export const RouteEventType = z.enum(ROUTE_EVENT_TYPES);
export type RouteEventType = z.infer<typeof RouteEventType>;

/** SSE payload (§11.5). The payload is public: no prompt, response body, seed, or signed blob (§19). */
export const RouteEvent = z.object({
  eventId: z.string().min(1),
  routeId: z.string().min(1),
  type: RouteEventType,
  timestamp: IsoTimestamp,
  state: RouteState,
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type RouteEvent = z.infer<typeof RouteEvent>;

/** GET /v1/offers (§11.6). Offer records carry no secrets by construction (FR-020). */
export const OffersResponse = z.object({
  registryVersion: z.string().min(1),
  offers: z.array(InferenceOffer),
});
export type OffersResponse = z.infer<typeof OffersResponse>;

/** GET /v1/wallet (§11.7). Address and balances only; never the seed (INV-007). */
export const WalletResponse = z.object({
  address: XrplAddress,
  network: XrplNetworkId,
  balances: z.array(z.object({ asset: SettlementAssetCode, amount: DecimalString })),
});
export type WalletResponse = z.infer<typeof WalletResponse>;

// Named exports: `export *` from this module breaks Turbopack in apps/web.
export {
  IllegalTransitionError,
  PAYMENT_TRANSITIONS,
  ROUTE_TRANSITIONS,
  assertPaymentTransition,
  assertRouteTransition,
  canTransitionPayment,
  canTransitionRoute,
  isTerminalPaymentState,
  isTerminalRouteState,
} from './state-machine.js';
