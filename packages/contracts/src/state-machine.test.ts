import { describe, expect, it } from 'vitest';
import {
  PAYMENT_STATES,
  ROUTE_STATES,
  assertPaymentTransition,
  assertRouteTransition,
  canTransitionPayment,
  canTransitionRoute,
  isTerminalRouteState,
  PAYMENT_TRANSITIONS,
  ROUTE_TRANSITIONS,
} from './index.js';

describe('state machines (§9)', () => {
  it('covers every enum state and only references known states', () => {
    for (const s of ROUTE_STATES) expect(ROUTE_TRANSITIONS[s]).toBeDefined();
    for (const s of PAYMENT_STATES) expect(PAYMENT_TRANSITIONS[s]).toBeDefined();
    for (const targets of Object.values(ROUTE_TRANSITIONS))
      for (const t of targets) expect(ROUTE_STATES).toContain(t);
    for (const targets of Object.values(PAYMENT_TRANSITIONS))
      for (const t of targets) expect(PAYMENT_STATES).toContain(t);
  });

  it('never signs before policy approval (INV-002)', () => {
    for (const from of ROUTE_STATES) {
      expect(canTransitionRoute(from, 'SIGNED')).toBe(from === 'POLICY_APPROVED');
    }
    expect(canTransitionPayment('CREATED', 'SIGNED')).toBe(true);
    expect(canTransitionPayment('POLICY_REJECTED', 'SIGNED')).toBe(false);
    expect(() => assertRouteTransition('QUOTED', 'SIGNED')).toThrow(/illegal route transition/);
  });

  it('#66: a signer failure after approval ends PAYMENT_FAILED instead of stranding (§14)', () => {
    expect(canTransitionRoute('POLICY_APPROVED', 'PAYMENT_FAILED')).toBe(true);
    expect(ROUTE_TRANSITIONS.POLICY_APPROVED).toEqual(['SIGNED', 'PAYMENT_FAILED']);
  });

  it('reaches SETTLED only from a sent payment and never re-signs (INV-009, INV-011)', () => {
    for (const from of PAYMENT_STATES) {
      expect(canTransitionPayment(from, 'SETTLED')).toBe(
        from === 'SENT' || from === 'OUTCOME_UNKNOWN',
      );
    }
    expect(canTransitionPayment('OUTCOME_UNKNOWN', 'SIGNED')).toBe(false);
    expect(canTransitionPayment('SENT', 'SIGNED')).toBe(false);
    expect(assertPaymentTransition('SENT', 'SETTLED')).toBe('SETTLED');
  });

  it('treats settled and failed routes as terminal (INV-004)', () => {
    for (const s of ['SUCCEEDED', 'PAID_EXECUTION_FAILED', 'PAYMENT_FAILED', 'FAILED'] as const) {
      expect(isTerminalRouteState(s)).toBe(true);
      expect(canTransitionRoute(s, 'QUOTING')).toBe(false);
    }
    expect(isTerminalRouteState('QUOTED')).toBe(false);
  });
});
