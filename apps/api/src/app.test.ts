/**
 * Buyer API tests. Payments, signer, balances are mocked; the database is the package's in-memory fake
 * (real repository code, real FR-071 unique constraints). No network. Harness: harness.test-helper.ts.
 */
import { describe, expect, it } from 'vitest';
import type { SellerRequest } from '@subbuddy/contracts';
import { PaymentError } from '@subbuddy/payments';
import { AUTH, PROMPT, WALLET, harness, requirementFor } from './harness.test-helper.js';
import { MAX_QUOTE_ATTEMPTS } from './service.js';

describe('auth and envelope (SEC-011, §11.1)', () => {
  it('rejects every /v1 call without the demo key, before any processing', async () => {
    const h = await harness();
    for (const url of ['/v1/routes', '/v1/offers', '/v1/wallet', '/v1/routes/x']) {
      const res = await h.app.inject(
        url === '/v1/routes' ? { method: 'POST', url, payload: {} } : { method: 'GET', url },
      );
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        error: { code: 'UNAUTHORIZED', message: expect.any(String), retryable: false },
      });
    }
    expect(h.payments.obtainRequirement).not.toHaveBeenCalled();
    expect((await h.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('maps validation failures: empty prompt, oversized prompt, bad JSON', async () => {
    const h = await harness();
    expect((await h.route({ prompt: '   ' })).json().error.code).toBe('VALIDATION_ERROR');
    const big = await h.route({ prompt: 'x'.repeat(32_001) });
    expect(big.statusCode).toBe(413);
    expect(big.json().error.code).toBe('PROMPT_TOO_LARGE');
    const bad = await h.app.inject({
      method: 'POST',
      url: '/v1/routes',
      headers: { ...AUTH, 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /v1/routes (§11.2)', () => {
  it('classifies, scores, quotes the top offer and returns QUOTED', async () => {
    const h = await harness();
    const res = await h.route();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.state).toBe('QUOTED');
    expect(body.taskProfile.taskType).toBe('coding');
    expect(body.selected.offerId).toBe('fast-code-v1');
    expect(body.selected.quotedCost).toBe('0.006200');
    expect(body.mandate).toMatchObject({ maxCost: '0.020000', asset: 'RLUSD', network: 'xrpl:1' });
    // FR-050: the prompt went to the selected seller only.
    expect(h.payments.obtainRequirement).toHaveBeenCalledTimes(1);
    const byId = Object.fromEntries(
      body.candidates.map((c: { offerId: string }) => [c.offerId, c]),
    );
    expect(byId['fast-code-v1'].eligibility).toBe('selected');
    expect(byId['deep-reasoning-v1'].eligibility).toBe('not_quoted');
    expect(byId['deep-reasoning-v1'].quotedCost).toBeNull();
    expect(byId['fast-text-v1'].eligibility).toBe('ineligible');
  });

  it('AT-002: no offer within budget ends NO_ELIGIBLE_OFFER without quoting or signing', async () => {
    const h = await harness();
    const res = await h.route({ maxCost: '0.001000' });
    expect(res.statusCode).toBe(201);
    expect(res.json().state).toBe('NO_ELIGIBLE_OFFER');
    expect(res.json().selected).toBeNull();
    expect(h.payments.obtainRequirement).not.toHaveBeenCalled();
    expect(h.signer.signExactPayment).not.toHaveBeenCalled();
    expect(h.metrics.noEligibleOffer).toBe(1);
    const receipt = (await h.get(res.json().routeId)).json();
    expect(receipt.payment.status).toBe('NOT_CREATED');
  });

  it('FR-051 / §14: an over-budget or failing quote walks to the next unpaid offer, bounded', async () => {
    const h = await harness();
    h.payments.obtainRequirement.mockImplementationOnce(async (req: SellerRequest) =>
      requirementFor(req, '0.050000'),
    );
    const res = await h.route();
    expect(res.json().state).toBe('QUOTED');
    expect(res.json().selected.offerId).toBe('deep-reasoning-v1');
    expect(h.payments.obtainRequirement).toHaveBeenCalledTimes(2);
    const rejected = res
      .json()
      .candidates.find((c: { offerId: string }) => c.offerId === 'fast-code-v1');
    expect(rejected).toMatchObject({
      eligibility: 'quote_rejected',
      rejectionReasons: ['QUOTE_OVER_BUDGET'],
    });

    h.payments.obtainRequirement.mockRejectedValue(
      new PaymentError('SELLER_UNAVAILABLE', 'seller did not respond', { retryable: true }),
    );
    const fail = await h.route();
    expect(fail.statusCode).toBe(503);
    expect(fail.json().error).toMatchObject({ code: 'SELLER_UNAVAILABLE', retryable: true });
    // 2 from the first route + 2 eligible offers here; never more than the eligible set.
    expect(h.payments.obtainRequirement).toHaveBeenCalledTimes(4);
    expect(h.metrics.quoteRejectedByReason).toEqual({
      QUOTE_OVER_BUDGET: 1,
      SELLER_UNAVAILABLE: 2,
    });
    expect(h.metrics.noEligibleOffer).toBe(0);
    expect((await h.get(fail.json().error.routeId)).json().state).toBe('FAILED');
  });

  it('§14 / INV-004: quote attempts stop at MAX_QUOTE_ATTEMPTS even with more eligible offers, then FAILED with the last quote error', async () => {
    const h = await harness({ extraOffers: 3 }); // 5 eligible coding offers
    h.payments.obtainRequirement.mockRejectedValue(
      new PaymentError('QUOTE_REJECTED', 'malformed payment requirement'),
    );
    const res = await h.route();
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatchObject({ code: 'QUOTE_REJECTED', retryable: false });
    expect(h.payments.obtainRequirement).toHaveBeenCalledTimes(MAX_QUOTE_ATTEMPTS);
    expect(h.signer.signExactPayment).not.toHaveBeenCalled();
    const receipt = (await h.get(res.json().error.routeId)).json();
    expect(receipt.state).toBe('FAILED');
    expect(receipt.payment.status).toBe('NOT_CREATED');
    const byElig = (e: string) =>
      receipt.candidates.filter((c: { eligibility: string }) => c.eligibility === e).length;
    expect(byElig('quote_rejected')).toBe(MAX_QUOTE_ATTEMPTS);
    expect(byElig('not_quoted')).toBe(2);
    expect(h.events.replay(res.json().error.routeId).at(-1)).toMatchObject({
      type: 'route.failed',
      state: 'FAILED',
      payload: expect.objectContaining({
        code: 'QUOTE_REJECTED',
        requestId: expect.any(String),
      }),
    });
  });

  it('SEC-004: a seller timeout surfaces as a safe envelope with no internal detail', async () => {
    const h = await harness();
    const cause = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    h.payments.obtainRequirement.mockRejectedValue(
      new PaymentError('SELLER_UNAVAILABLE', 'seller did not respond', { retryable: true, cause }),
    );
    const res = await h.route();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: {
        code: 'SELLER_UNAVAILABLE',
        message: expect.any(String),
        retryable: true,
        routeId: expect.any(String),
      },
    });
    expect(res.body).not.toContain('aborted');
  });
});

describe('POST /v1/routes/:id/execute (§11.3, §9.1)', () => {
  it('happy path: one signature, one paid request, SETTLED + SUCCEEDED, redacted receipt and SSE', async () => {
    const h = await harness();
    const { routeId } = (await h.route()).json();
    const exec = await h.execute(routeId);
    expect(exec.statusCode).toBe(202);
    expect(exec.json()).toEqual({
      routeId,
      state: 'POLICY_APPROVED',
      statusUrl: `/v1/routes/${routeId}`,
      eventsUrl: `/v1/routes/${routeId}/events`,
    });
    expect(await h.terminal(routeId)).toBe('SUCCEEDED');
    expect(h.signer.signExactPayment).toHaveBeenCalledTimes(1);
    expect(h.payments.payAndRetry).toHaveBeenCalledTimes(1);

    const states = h.events
      .replay(routeId)
      .filter((e) => e.type === 'route.state_changed')
      .map((e) => e.state);
    expect(states).toEqual([
      'CLASSIFYING',
      'ROUTING',
      'QUOTING',
      'QUOTED',
      'POLICY_APPROVED',
      'SIGNED',
      'PAID_REQUEST_SENT',
      'VERIFYING',
      'SUCCEEDED',
    ]);
    const types = h.events.replay(routeId).map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'payment.submitted',
        'payment.validated',
        'execution.started',
        'execution.completed',
      ]),
    );

    const receipt = (await h.get(routeId)).json();
    expect(receipt.state).toBe('SUCCEEDED');
    expect(receipt.payment).toMatchObject({
      status: 'SETTLED',
      transactionHash: 'HASH1',
      explorerUrl: 'https://testnet.xrpl.org/transactions/HASH1',
      ledgerIndex: 1005,
      amount: '0.006200',
    });
    expect(receipt.execution).toMatchObject({
      status: 'succeeded',
      modelId: 'demo/fast-code',
      latencyMs: 900,
    });
    expect(receipt.result).toBe('function dijkstra() {}');
    expect(receipt.policyDecision.approved).toBe(true);
    const text = JSON.stringify(receipt);
    expect(text).not.toContain('DEADBEEF'); // SEC-009
    expect(text).not.toContain(PROMPT); // SEC-008

    const sse = await h.app.inject({
      method: 'GET',
      url: `/v1/routes/${routeId}/events`,
      headers: AUTH,
    });
    expect(sse.headers['content-type']).toBe('text/event-stream');
    expect(sse.body).toContain('event: route.state_changed');
    expect(sse.body).toContain('event: execution.completed');
    expect(sse.body).not.toContain('DEADBEEF');
    expect(h.metrics.payment.success).toBe(1);
    expect(h.metrics.routesCompleted).toBe(1);
  });

  it('AT-009: a mutated prompt is rejected before any signing', async () => {
    const h = await harness();
    const { routeId } = (await h.route()).json();
    const res = await h.execute(routeId, PROMPT + ' please');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'PROMPT_MISMATCH', routeId });
    expect(h.signer.signExactPayment).not.toHaveBeenCalled();
    expect((await h.get(routeId)).json().payment.status).toBe('NOT_CREATED');
  });

  it('AT-005: concurrent execute calls yield one claim, one signature, one paid request', async () => {
    const h = await harness();
    const { routeId } = (await h.route()).json();
    const results = await Promise.all([h.execute(routeId), h.execute(routeId), h.execute(routeId)]);
    for (const r of results) expect(r.statusCode).toBe(202);
    expect(await h.terminal(routeId)).toBe('SUCCEEDED');
    expect(h.signer.signExactPayment).toHaveBeenCalledTimes(1);
    expect(h.payments.payAndRetry).toHaveBeenCalledTimes(1);
    // Repeated execute after completion is idempotent: same state, no new transaction.
    const again = await h.execute(routeId);
    expect(again.statusCode).toBe(202);
    expect(again.json().state).toBe('SUCCEEDED');
    expect(h.signer.signExactPayment).toHaveBeenCalledTimes(1);
  });

  it('SPEND_CAP_REACHED: the hourly cap rejects before signing (SEC-011, INV-012)', async () => {
    const h = await harness({ cap: '0.005000' });
    const { routeId } = (await h.route()).json();
    const res = await h.execute(routeId);
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toMatchObject({ code: 'SPEND_CAP_REACHED', routeId });
    expect(h.signer.signExactPayment).not.toHaveBeenCalled();
    const receipt = (await h.get(routeId)).json();
    expect(receipt.state).toBe('POLICY_REJECTED');
    expect(receipt.payment.status).toBe('POLICY_REJECTED');
    expect(receipt.policyDecision.checks).toContainEqual({
      name: 'spend_cap',
      passed: false,
      reason: expect.any(String),
    });
  });

  it('FR-060: insufficient wallet balance is POLICY_REJECTED and never calls the signer', async () => {
    const h = await harness({ balance: '0.001000' });
    const { routeId } = (await h.route()).json();
    const res = await h.execute(routeId);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('POLICY_REJECTED');
    expect(h.signer.signExactPayment).not.toHaveBeenCalled();
  });

  it('FR-081 / AT-007: settled but not served ends PAID_EXECUTION_FAILED with no reroute', async () => {
    const h = await harness();
    h.payments.payAndRetry.mockRejectedValue(
      new PaymentError('PAID_EXECUTION_FAILED', 'seller returned a malformed response', {
        transactionHash: 'HASH1',
      }),
    );
    const { routeId } = (await h.route()).json();
    await h.execute(routeId);
    expect(await h.terminal(routeId)).toBe('PAID_EXECUTION_FAILED');
    expect(h.payments.payAndRetry).toHaveBeenCalledTimes(1);
    expect(h.signer.signExactPayment).toHaveBeenCalledTimes(1);
    const receipt = (await h.get(routeId)).json();
    expect(receipt.payment.status).toBe('SETTLED');
    expect(receipt.execution).toMatchObject({
      status: 'failed',
      failureCode: 'PAID_EXECUTION_FAILED',
    });
    const failed = h.events.replay(routeId).find((e) => e.type === 'route.failed');
    expect(failed?.payload).toMatchObject({ code: 'PAID_EXECUTION_FAILED' });
    expect(h.metrics.paidExecutionFailed).toBe(1);
  });

  it('AT-006 / §14: a lost response resolves by hash; absent after LastLedgerSequence is PAYMENT_FAILED', async () => {
    const h = await harness();
    h.payments.payAndRetry.mockRejectedValue(
      new PaymentError('OUTCOME_UNKNOWN', 'paid request response lost', {
        transactionHash: 'HASH1',
      }),
    );
    h.payments.resolveTransaction
      .mockResolvedValueOnce({
        status: 'not_found',
        transactionHash: 'HASH1',
        currentLedgerIndex: 1050,
      })
      .mockResolvedValue({
        status: 'not_found',
        transactionHash: 'HASH1',
        currentLedgerIndex: 1101,
      });
    const { routeId } = (await h.route()).json();
    await h.execute(routeId);
    expect(await h.terminal(routeId)).toBe('PAYMENT_FAILED');
    expect(h.signer.signExactPayment).toHaveBeenCalledTimes(1); // INV-011: never re-signed
    const states = h.events
      .replay(routeId)
      .filter((e) => e.type === 'route.state_changed')
      .map((e) => e.state);
    expect(states.slice(-4)).toEqual([
      'PAID_REQUEST_SENT',
      'OUTCOME_UNKNOWN',
      'VERIFYING',
      'PAYMENT_FAILED',
    ]);
    const receipt = (await h.get(routeId)).json();
    expect(receipt.payment).toMatchObject({
      status: 'VALIDATED_FAILED',
      failureCode: 'NOT_FOUND_AFTER_LAST_LEDGER',
    });
    expect(h.metrics.payment).toEqual({ success: 0, failure: 1, unknown: 1 });
  });
});

describe('GET /v1/offers and /v1/wallet (§11.6, §11.7)', () => {
  it('returns the secret-free registry and address + balances only', async () => {
    const h = await harness();
    const offers = (await h.app.inject({ method: 'GET', url: '/v1/offers', headers: AUTH })).json();
    expect(offers.offers.map((o: { offerId: string }) => o.offerId)).toEqual([
      'deep-reasoning-v1',
      'fast-code-v1',
      'fast-text-v1',
    ]);
    const wallet = (await h.app.inject({ method: 'GET', url: '/v1/wallet', headers: AUTH })).json();
    expect(wallet).toEqual({
      address: WALLET,
      network: 'xrpl:1',
      balances: [
        { asset: 'RLUSD', amount: '5.000000' },
        { asset: 'XRP', amount: '25.000000' },
      ],
    });
    expect(Object.keys(wallet)).toEqual(['address', 'network', 'balances']);
  });
});
