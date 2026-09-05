import { describe, expect, it } from 'vitest';
import { parseSse } from './api.js';
import { failureCopy, paymentStatusLabel, stepStatuses, uiStateFor } from './route-ui.js';

describe('uiStateFor (PRD §13.2)', () => {
  it('maps every route state to one of the eleven UI states', () => {
    expect(uiStateFor(null)).toBe('idle');
    expect(uiStateFor('CLASSIFYING')).toBe('classifying');
    expect(uiStateFor('ROUTING')).toBe('routing');
    expect(uiStateFor('QUOTING')).toBe('quoting');
    expect(uiStateFor('QUOTED')).toBe('quoted');
    expect(uiStateFor('SIGNED')).toBe('payment_pending');
    expect(uiStateFor('PAID_REQUEST_SENT')).toBe('payment_pending');
    expect(uiStateFor('OUTCOME_UNKNOWN')).toBe('payment_pending');
    expect(uiStateFor('SUCCEEDED')).toBe('succeeded');
    expect(uiStateFor('PAID_EXECUTION_FAILED')).toBe('paid_execution_failed');
    for (const s of ['NO_ELIGIBLE_OFFER', 'POLICY_REJECTED', 'PAYMENT_FAILED', 'FAILED'] as const) {
      expect(uiStateFor(s)).toBe('failed_before_payment');
    }
  });

  it('shows settled only after payment.validated, never on submission alone (NFR-003)', () => {
    expect(uiStateFor('VERIFYING', new Set(['payment.submitted']))).toBe('payment_pending');
    expect(uiStateFor('VERIFYING', new Set(['payment.submitted', 'payment.validated']))).toBe(
      'settled',
    );
    expect(uiStateFor('VERIFYING', new Set(['payment.validated', 'execution.started']))).toBe(
      'executing',
    );
  });

  it('marks the failing step and leaves later steps pending', () => {
    const s = stepStatuses('failed_before_payment', 'POLICY_REJECTED');
    expect(s).toEqual({
      classify: 'done',
      compare: 'done',
      quote: 'done',
      approve: 'failed',
      settle: 'pending',
      execute: 'pending',
    });
    expect(stepStatuses('paid_execution_failed', 'PAID_EXECUTION_FAILED').execute).toBe('warning');
    expect(stepStatuses('succeeded', 'SUCCEEDED').execute).toBe('done');
  });
});

describe('failureCopy (PRD §13.4, FR-081)', () => {
  it('states money moved only for paid execution failure and never promises a refund', () => {
    const paid = failureCopy('PAID_EXECUTION_FAILED');
    expect(paid.moneyMoved).toBe(true);
    expect(paid.body).toContain('No second provider was purchased');
    expect(paid.body).not.toMatch(/refund/i);
    for (const s of ['NO_ELIGIBLE_OFFER', 'POLICY_REJECTED', 'PAYMENT_FAILED', 'FAILED'] as const) {
      const c = failureCopy(s);
      expect(c.moneyMoved).toBe(false);
      expect(c.body).toMatch(/no (payment was made|money moved)/i);
    }
  });

  it('never labels a payment validated unless SETTLED', () => {
    expect(paymentStatusLabel('SENT', false)).toBe('Pending');
    expect(paymentStatusLabel('OUTCOME_UNKNOWN', false)).toBe('Pending');
    expect(paymentStatusLabel('SETTLED', false)).toBe('Validated');
    expect(paymentStatusLabel('VALIDATED_FAILED', true)).toBe('Failed');
  });
});

describe('parseSse', () => {
  it('parses complete frames, keeps the partial tail, and drops non-route frames', () => {
    const ev = {
      eventId: 'e1',
      routeId: 'route_1',
      type: 'payment.submitted',
      timestamp: '2026-09-05T00:00:00Z',
      state: 'PAID_REQUEST_SENT',
      payload: { transactionHash: 'ABC' },
    };
    const buf = `: keep-alive\n\nevent: payment.submitted\ndata: ${JSON.stringify(ev)}\n\ndata: {"partial":`;
    const { events, rest } = parseSse(buf);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.transactionHash).toBe('ABC');
    expect(rest).toBe('data: {"partial":');
  });
});
