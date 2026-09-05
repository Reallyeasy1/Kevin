/**
 * Pure mapping from route state + seen SSE events to the eleven UI states of PRD §13.2, the six timeline
 * steps of §13.1, and the failure copy rules of §13.4 (what failed, whether money moved, retry risk).
 */
import type {
  PaymentState,
  Receipt,
  RouteEvent,
  RouteEventType,
  RouteResponse,
  RouteState,
} from '@subbuddy/contracts';

export const UI_STATES = [
  'idle',
  'classifying',
  'routing',
  'quoting',
  'quoted',
  'payment_pending',
  'settled',
  'executing',
  'succeeded',
  'failed_before_payment',
  'paid_execution_failed',
] as const;
export type UiState = (typeof UI_STATES)[number];

export const STEPS = ['classify', 'compare', 'quote', 'approve', 'settle', 'execute'] as const;
export type Step = (typeof STEPS)[number];
export type StepStatus = 'pending' | 'active' | 'done' | 'failed' | 'warning';

const PAYMENT_PENDING_STATES: ReadonlySet<RouteState> = new Set([
  'POLICY_APPROVED',
  'SIGNED',
  'PAID_REQUEST_SENT',
  'OUTCOME_UNKNOWN',
  'VERIFYING',
]);

const FAILED_BEFORE_PAYMENT: ReadonlySet<RouteState> = new Set([
  'NO_ELIGIBLE_OFFER',
  'POLICY_REJECTED',
  'PAYMENT_FAILED',
  'FAILED',
]);

// ponytail: mirrors isTerminalRouteState from @subbuddy/contracts; Turbopack cannot follow the barrel's
// `export * from './state-machine.js'` (.js specifier for a .ts source), so the re-export is invisible in the browser bundle.
const TERMINAL_STATES: ReadonlySet<RouteState> = new Set([
  'NO_ELIGIBLE_OFFER',
  'POLICY_REJECTED',
  'SUCCEEDED',
  'PAID_EXECUTION_FAILED',
  'PAYMENT_FAILED',
  'FAILED',
]);
export const isTerminal = (s: RouteState): boolean => TERMINAL_STATES.has(s);

export function uiStateFor(
  state: RouteState | null,
  seen: ReadonlySet<RouteEventType> = new Set(),
): UiState {
  if (state === null) return 'idle';
  if (state === 'CLASSIFYING') return 'classifying';
  if (state === 'ROUTING') return 'routing';
  if (state === 'QUOTING') return 'quoting';
  if (state === 'QUOTED') return 'quoted';
  if (state === 'SUCCEEDED') return 'succeeded';
  if (state === 'PAID_EXECUTION_FAILED') return 'paid_execution_failed';
  if (FAILED_BEFORE_PAYMENT.has(state)) return 'failed_before_payment';
  if (PAYMENT_PENDING_STATES.has(state)) {
    // Settle and execute both happen inside the seller call (§7.2 step 11); events, not the route state,
    // tell us how far it got. Only payment.validated may show "settled" (NFR-003, INV-009).
    if (seen.has('execution.started')) return 'executing';
    if (seen.has('payment.validated')) return 'settled';
    return 'payment_pending';
  }
  return 'payment_pending';
}

/** Index of the step that is in progress (or where the flow stopped) for each UI state. */
const ACTIVE_STEP: Record<UiState, number> = {
  idle: -1,
  classifying: 0,
  routing: 1,
  quoting: 2,
  quoted: 3,
  payment_pending: 4,
  settled: 5,
  executing: 5,
  succeeded: 6,
  failed_before_payment: 2,
  paid_execution_failed: 5,
};

// ponytail: FAILED is reachable from CLASSIFYING or QUOTING (§9.1); we blame the quote step without a payload hint.
const FAILED_AT_STEP: Partial<Record<RouteState, number>> = {
  NO_ELIGIBLE_OFFER: 1,
  POLICY_REJECTED: 3,
  PAYMENT_FAILED: 4,
  FAILED: 2,
};

export function stepStatuses(ui: UiState, state: RouteState | null): Record<Step, StepStatus> {
  const active =
    ui === 'failed_before_payment' && state ? (FAILED_AT_STEP[state] ?? 2) : ACTIVE_STEP[ui];
  const out = {} as Record<Step, StepStatus>;
  STEPS.forEach((step, i) => {
    if (i < active) out[step] = 'done';
    else if (i > active) out[step] = 'pending';
    else if (ui === 'failed_before_payment') out[step] = 'failed';
    else if (ui === 'paid_execution_failed') out[step] = 'warning';
    else out[step] = 'active';
  });
  return out;
}

export const STEP_LABEL: Record<Step, string> = {
  classify: 'Classify',
  compare: 'Compare',
  quote: 'Quote',
  approve: 'Approve',
  settle: 'Settle',
  execute: 'Execute',
};

export interface FailureCopy {
  title: string;
  body: string;
  moneyMoved: boolean;
  /** True when routing again cannot produce a second payment for this route. */
  retrySafe: boolean;
}

/** §13.4: state what failed, whether money moved, and whether a retry can create another payment. */
export function failureCopy(state: RouteState, apiMessage?: string | null): FailureCopy {
  const detail = apiMessage ? ` ${apiMessage}` : '';
  switch (state) {
    case 'NO_ELIGIBLE_OFFER':
      return {
        title: 'No eligible offer',
        body: `No registered offer fit this task within your budget.${detail} No payment was made. Raise the budget or change the mode and route again; this route cannot create a payment.`,
        moneyMoved: false,
        retrySafe: true,
      };
    case 'POLICY_REJECTED':
      return {
        title: 'Spend policy rejected the quote',
        body: `The seller quote failed the spend policy (budget, asset, network, or hourly cap).${detail} Nothing was signed and no money moved. Routing again is safe.`,
        moneyMoved: false,
        retrySafe: true,
      };
    case 'PAYMENT_FAILED':
      return {
        title: 'Payment did not validate',
        body: `The payment did not validate on the XRP Ledger.${detail} No money moved. This route will not be retried automatically; starting a new route creates a new payment attempt.`,
        moneyMoved: false,
        retrySafe: true,
      };
    case 'PAID_EXECUTION_FAILED':
      return {
        title: 'Payment succeeded, delivery failed',
        // PRD §13.4 example copy, verbatim.
        body: 'Payment was validated, but the seller could not complete inference. No second provider was purchased. You can retry delivery from the same seller without creating a new payment if the paid entitlement remains valid.',
        moneyMoved: true,
        retrySafe: false,
      };
    default:
      return {
        title: 'Routing failed',
        body: `Routing failed before any quote was accepted.${detail} No payment was made. You can route again safely.`,
        moneyMoved: false,
        retrySafe: true,
      };
  }
}

/** FR-093 / NFR-003: only SETTLED reads as validated; anything else is pending or failed, never success. */
export function paymentStatusLabel(
  status: PaymentState | null,
  seenValidated: boolean,
): 'Validated' | 'Pending' | 'Failed' {
  if (status === 'SETTLED') return 'Validated';
  if (status === 'VALIDATED_FAILED') return 'Failed';
  if (status === null && seenValidated) return 'Validated';
  return 'Pending';
}

// ---------------------------------------------------------------------------
// View models derived from the route response, the receipt, and SSE payloads.
// ---------------------------------------------------------------------------

export interface SelectedView {
  offerId: string;
  sellerName: string;
  modelId: string | null;
  score: string | null;
  estimatedCost: string;
  quotedCost: string | null;
  asset: string;
  reason: string | null;
}

export interface EvidenceView {
  status: 'Validated' | 'Pending' | 'Failed';
  hash: string | null;
  explorerUrl: string | null;
  amount: string | null;
  asset: string | null;
  sellerName: string | null;
  ledgerIndex: number | null;
}

/** Prefer the live route response; fall back to the receipt's selected candidate (history view). */
export function deriveSelected(
  route: RouteResponse | null,
  detail: Receipt | null,
): SelectedView | null {
  if (route?.selected) {
    const s = route.selected;
    return {
      offerId: s.offerId,
      sellerName: s.sellerName,
      modelId: s.modelId,
      score: s.score,
      estimatedCost: s.estimatedCost,
      quotedCost: s.quotedCost,
      asset: s.asset,
      reason: s.reason,
    };
  }
  if (detail?.selectedOfferId) {
    const c = detail.candidates.find((x) => x.offerId === detail.selectedOfferId);
    if (c) {
      return {
        offerId: c.offerId,
        sellerName: c.displayName,
        modelId: detail.execution.modelId,
        score: c.finalScore,
        estimatedCost: c.estimatedCost,
        quotedCost: c.quotedCost ?? detail.quotedCost,
        asset: detail.payment.assetCode ?? '',
        reason: null,
      };
    }
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Payment evidence (FR-093). The receipt is authoritative; before it loads, SSE payloads supply the hash.
 * Status is "Validated" only on SETTLED or after a payment.validated event (NFR-003).
 */
export function deriveEvidence(
  detail: Receipt | null,
  events: readonly RouteEvent[],
  selected: SelectedView | null,
  explorerBase: string,
): EvidenceView | null {
  const seenValidated = events.some((e) => e.type === 'payment.validated');
  if (detail && detail.payment.status !== 'NOT_CREATED' && detail.payment.status !== 'CREATED') {
    const p = detail.payment;
    return {
      status: paymentStatusLabel(p.status, seenValidated),
      hash: p.transactionHash,
      explorerUrl: p.explorerUrl ?? (p.transactionHash ? explorerBase + p.transactionHash : null),
      amount: p.amount,
      asset: p.assetCode,
      sellerName: selected?.sellerName ?? null,
      ledgerIndex: p.ledgerIndex,
    };
  }
  const paymentEvents = events.filter(
    (e) => e.type === 'payment.submitted' || e.type === 'payment.validated',
  );
  if (paymentEvents.length === 0) return null;
  const payload = Object.assign({}, ...paymentEvents.map((e) => e.payload)) as Record<
    string,
    unknown
  >;
  const hash = str(payload.transactionHash);
  return {
    status: paymentStatusLabel(null, seenValidated),
    hash,
    explorerUrl: str(payload.explorerUrl) ?? (hash ? explorerBase + hash : null),
    amount: str(payload.amount) ?? selected?.quotedCost ?? null,
    asset: str(payload.asset) ?? selected?.asset ?? null,
    sellerName: selected?.sellerName ?? null,
    ledgerIndex: typeof payload.ledgerIndex === 'number' ? payload.ledgerIndex : null,
  };
}

export function shortHash(hash: string): string {
  return hash.length <= 14 ? hash : `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function networkLabel(network: string): string {
  if (network === 'xrpl:1') return 'XRPL Testnet';
  if (network === 'xrpl:0') return 'XRPL Mainnet';
  if (network === 'xrpl:2') return 'XRPL Devnet';
  return network;
}
