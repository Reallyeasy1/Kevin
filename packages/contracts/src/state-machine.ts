/**
 * Route and payment state machines (PRD §9.1, §9.2) as adjacency maps plus one guard.
 * The graph encodes the invariants: SIGNED is reachable only from POLICY_APPROVED (INV-002), SETTLED only
 * from SENT/OUTCOME_UNKNOWN (INV-009), and terminal states have no exits (INV-004: a settled route is never
 * rerouted). INV-003/INV-011 (one payment, one signature) are DB uniqueness, not graph edges.
 */
import type { PaymentState, RouteState } from './index.js';

export const ROUTE_TRANSITIONS: Readonly<Record<RouteState, readonly RouteState[]>> = {
  CLASSIFYING: ['ROUTING', 'FAILED'],
  ROUTING: ['QUOTING', 'NO_ELIGIBLE_OFFER'],
  QUOTING: ['QUOTED', 'FAILED'],
  QUOTED: ['POLICY_APPROVED', 'POLICY_REJECTED'],
  // PAYMENT_FAILED: signer unavailable / insufficient balance after approval (#66, §14). Nothing was signed
  // or submitted, so the route must not strand in POLICY_APPROVED; §9.1 lacked the edge.
  POLICY_APPROVED: ['SIGNED', 'PAYMENT_FAILED'],
  SIGNED: ['PAID_REQUEST_SENT'],
  PAID_REQUEST_SENT: ['VERIFYING', 'PAYMENT_FAILED', 'OUTCOME_UNKNOWN'],
  OUTCOME_UNKNOWN: ['VERIFYING', 'PAYMENT_FAILED'],
  VERIFYING: ['SUCCEEDED', 'PAID_EXECUTION_FAILED', 'PAYMENT_FAILED'],
  NO_ELIGIBLE_OFFER: [],
  POLICY_REJECTED: [],
  SUCCEEDED: [],
  PAID_EXECUTION_FAILED: [],
  PAYMENT_FAILED: [],
  FAILED: [],
};

export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentState, readonly PaymentState[]>> = {
  NOT_CREATED: ['CREATED'],
  CREATED: ['SIGNED', 'POLICY_REJECTED'],
  SIGNED: ['SENT'],
  SENT: ['SETTLED', 'VALIDATED_FAILED', 'OUTCOME_UNKNOWN'],
  // Resolved by hash only; never re-signed (FR-071).
  OUTCOME_UNKNOWN: ['SETTLED', 'VALIDATED_FAILED'],
  POLICY_REJECTED: [],
  SETTLED: [],
  VALIDATED_FAILED: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly machine: 'route' | 'payment',
    readonly from: string,
    readonly to: string,
  ) {
    super(`illegal ${machine} transition ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function canTransitionRoute(from: RouteState, to: RouteState): boolean {
  return ROUTE_TRANSITIONS[from].includes(to);
}

export function canTransitionPayment(from: PaymentState, to: PaymentState): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/** Returns `to` so callers can write `route.state = assertRouteTransition(route.state, 'QUOTED')`. */
export function assertRouteTransition(from: RouteState, to: RouteState): RouteState {
  if (!canTransitionRoute(from, to)) throw new IllegalTransitionError('route', from, to);
  return to;
}

export function assertPaymentTransition(from: PaymentState, to: PaymentState): PaymentState {
  if (!canTransitionPayment(from, to)) throw new IllegalTransitionError('payment', from, to);
  return to;
}

export function isTerminalRouteState(state: RouteState): boolean {
  return ROUTE_TRANSITIONS[state].length === 0;
}

export function isTerminalPaymentState(state: PaymentState): boolean {
  return PAYMENT_TRANSITIONS[state].length === 0;
}
