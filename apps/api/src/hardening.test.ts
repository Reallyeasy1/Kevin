/**
 * §14 / §19 / SEC-004 / SEC-005 / US-010 hardening tests. Same harness as app.test.ts; no network.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  PaidSellerResponse,
  PaymentRequirement,
  RouteEvent,
  SellerRequest,
} from '@subbuddy/contracts';
import { buildCuratedOffers } from '@subbuddy/config';
import { PaymentError } from '@subbuddy/payments';
import { createFakeDb } from '../../../packages/database/src/fake-db.js';
import {
  AUTH,
  ISSUER,
  RLUSD_HEX,
  SELLER,
  WALLET,
  env,
  harness,
  okResult,
} from './harness.test-helper.js';
import { ResponseTooLargeError, guardedFetch } from './http.js';
import { assertExactMatchesQuote } from './service.js';

describe('§14 client disconnect and §19 correlation', () => {
  it('execute returns before settlement; the route reaches its terminal state with no further request', async () => {
    const h = await harness();
    let release: () => void = () => {};
    h.payments.payAndRetry.mockImplementation(
      ({ request }: { request: SellerRequest }) =>
        new Promise<PaidSellerResponse>((resolve) => {
          release = () => resolve(okResult(request));
        }),
    );
    const { routeId } = (await h.route()).json();
    const exec = await h.execute(routeId);
    // The client is gone from here on: the 202 was returned while the paid request is still in flight.
    expect(exec.statusCode).toBe(202);
    expect(exec.json().state).toBe('POLICY_APPROVED');
    expect((await h.get(routeId)).json().state).toBe('PAID_REQUEST_SENT');
    release();
    expect(await h.terminal(routeId)).toBe('SUCCEEDED');
    const receipt = (await h.get(routeId)).json();
    expect(receipt.state).toBe('SUCCEEDED');
    expect(receipt.payment.status).toBe('SETTLED');
    expect(receipt.result).toBe('function dijkstra() {}');
  });

  it('every SSE event carries requestId, offerId, invoiceId and transactionHash once known', async () => {
    const h = await harness();
    const { routeId } = (await h.route()).json();
    await h.execute(routeId);
    await h.terminal(routeId);
    const all = h.events.replay(routeId);
    for (const e of all) {
      expect(e).toMatchObject({
        routeId,
        eventId: expect.any(String),
        timestamp: expect.any(String),
      });
      expect(e.payload['requestId']).toEqual(expect.any(String));
    }
    const quoted = all.find((e) => e.state === 'QUOTED') as RouteEvent;
    expect(quoted.payload).toMatchObject({
      offerId: 'fast-code-v1',
      invoiceId: expect.stringMatching(/^inv-/),
    });
    const afterSign = all.filter((e) =>
      ['SIGNED', 'PAID_REQUEST_SENT', 'VERIFYING', 'SUCCEEDED'].includes(e.state),
    );
    expect(afterSign.length).toBeGreaterThan(3);
    for (const e of afterSign) expect(e.payload['transactionHash']).toBe('HASH1');
    // The execute request's id replaces the create request's id from POLICY_APPROVED on.
    const approved = all.find((e) => e.state === 'POLICY_APPROVED') as RouteEvent;
    expect(approved.payload['requestId']).not.toBe(all[0]?.payload['requestId']);
    // SSE frames are the same events, so the ids reach the client too.
    const sse = await h.app.inject({
      method: 'GET',
      url: `/v1/routes/${routeId}/events`,
      headers: AUTH,
    });
    expect(sse.body).toContain('"transactionHash":"HASH1"');
  });
});

describe('GET /metrics (§19)', () => {
  it('is auth-protected and exposes every required counter in Prometheus text format', async () => {
    const h = await harness();
    expect((await h.app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401);
    const { routeId } = (await h.route()).json();
    await h.execute(routeId);
    await h.terminal(routeId);
    await h.route({ maxCost: '0.001000' }); // NO_ELIGIBLE_OFFER
    const res = await h.app.inject({ method: 'GET', url: '/metrics', headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    const text = res.body;
    expect(text).toContain('subbuddy_routes_created_total 2');
    expect(text).toContain('subbuddy_routes_completed_total 1');
    expect(text).toContain('subbuddy_no_eligible_offer_total 1');
    expect(text).toContain('subbuddy_payment_total{outcome="success"} 1');
    expect(text).toContain('subbuddy_paid_execution_failed_total 0');
    expect(text).toContain('subbuddy_selected_offer_total{offer_id="fast-code-v1"} 1');
    expect(text).toContain('subbuddy_route_latency_ms_count 2');
    expect(text).toContain('subbuddy_settlement_latency_ms_count 1');
    expect(text).toContain('subbuddy_provider_latency_ms_sum 900');
    expect(text).toContain('# TYPE subbuddy_quote_rejected_total counter');
    const json = await h.app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { ...AUTH, accept: 'application/json' },
    });
    expect(json.json().routesCreated).toBe(2);
  });
});

describe('GET /v1/routes (US-010)', () => {
  it('lists completed routes newest first with keyset pagination and receipt-level fields only', async () => {
    const h = await harness();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { routeId } = (await h.route()).json();
      await h.execute(routeId);
      await h.terminal(routeId);
      ids.push(routeId);
    }
    const pending = (await h.route()).json().routeId; // QUOTED: not completed, must not be listed
    const list = (url: string) => h.app.inject({ method: 'GET', url, headers: AUTH });
    const p1 = (await list('/v1/routes?limit=2')).json();
    expect(p1.routes).toHaveLength(2);
    expect(p1.nextCursor).toBe(p1.routes[1].routeId);
    expect(p1.routes[0]).toEqual({
      routeId: ids[2],
      createdAt: expect.any(String),
      state: 'SUCCEEDED',
      mode: 'balanced',
      selected: {
        offerId: 'fast-code-v1',
        sellerName: expect.any(String),
        modelId: 'demo/fast-code',
      },
      asset: 'RLUSD',
      quotedCost: '0.006200',
      settledAmount: '0.006200',
      transactionHash: 'HASH1',
      explorerUrl: 'https://testnet.xrpl.org/transactions/HASH1',
    });
    const p2 = (await list(`/v1/routes?limit=2&cursor=${p1.nextCursor}`)).json();
    expect(p2.routes.map((r: { routeId: string }) => r.routeId)).toEqual([ids[0]]);
    expect(p2.nextCursor).toBeNull();
    const listed = [...p1.routes, ...p2.routes].map((r: { routeId: string }) => r.routeId);
    expect(listed).toEqual([ids[2], ids[1], ids[0]]);
    expect(listed).not.toContain(pending);
    expect(JSON.stringify([p1, p2])).not.toContain('DEADBEEF');
    expect((await list('/v1/routes?limit=0')).json().error.code).toBe('VALIDATION_ERROR');
    expect((await list('/v1/routes')).json().routes).toHaveLength(3);
  });
});

describe('SEC-005 / INV-005: what is signed equals the stored quote', () => {
  const quoteRow = {
    destination: SELLER,
    amount: '0.006200',
    assetCode: 'RLUSD',
    assetIssuer: ISSUER,
    network: 'xrpl:1',
    invoiceId: 'inv-1',
  } as unknown as Parameters<typeof assertExactMatchesQuote>[1];
  const offer = buildCuratedOffers(env).find((o) => o.offerId === 'fast-code-v1') as ReturnType<
    typeof buildCuratedOffers
  >[number];
  const exact = {
    destination: SELLER,
    amount: '0.0062',
    asset: RLUSD_HEX,
    issuer: ISSUER,
    network: 'xrpl:1',
    invoiceId: 'inv-1',
  } as Parameters<typeof assertExactMatchesQuote>[0];

  it('accepts a decimal-equal amount and rejects any tampered field', () => {
    expect(() => assertExactMatchesQuote(exact, quoteRow, offer)).not.toThrow();
    for (const patch of [
      { amount: '0.0063' },
      { destination: WALLET },
      { invoiceId: 'inv-2' },
      { network: 'xrpl:2' },
      { asset: 'XRP' },
      { issuer: WALLET },
    ]) {
      expect(() =>
        assertExactMatchesQuote({ ...exact, ...patch } as typeof exact, quoteRow, offer),
      ).toThrow(PaymentError);
    }
  });

  it('after a restart the paid request carries the persisted requirement, byte-identical', async () => {
    const db = createFakeDb();
    const first = await harness({ db });
    const { routeId } = (await first.route()).json();
    const original = (await first.payments.obtainRequirement.mock.results[0]
      ?.value) as PaymentRequirement;
    // New process: fresh service instance, same database, empty in-memory requirement cache.
    const second = await harness({ db });
    await second.execute(routeId);
    expect(await second.terminal(routeId)).toBe('SUCCEEDED');
    const sent = second.payments.payAndRetry.mock.calls[0]?.[0] as unknown as {
      requirement: PaymentRequirement;
    };
    expect(JSON.stringify(sent.requirement)).toBe(JSON.stringify(original));
    expect(first.payments.payAndRetry).not.toHaveBeenCalled();
  });
});

describe('guardedFetch (SEC-004)', () => {
  const stream = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
        c.close();
      },
    });
  const asFetch = (fn: (url: unknown, init?: RequestInit) => Promise<Response>) =>
    vi.fn(fn) as unknown as typeof fetch;

  it('aborts a call that exceeds the deadline', async () => {
    const base = asFetch(
      (_url, init) =>
        new Promise<Response>((_res, rej) =>
          init?.signal?.addEventListener('abort', () => rej(init.signal?.reason)),
        ),
    );
    const f = guardedFetch({ timeoutMs: 20, maxResponseBytes: 1024 }, base);
    await expect(f('http://seller.test/x')).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('cuts off a streamed body over the cap, rejects an oversized content-length, passes small bodies', async () => {
    const opts = { timeoutMs: 1000, maxResponseBytes: 1000 };
    const big = asFetch(async () => new Response(stream(['a'.repeat(600), 'b'.repeat(600)])));
    await expect(
      (await guardedFetch(opts, big)('http://seller.test/x')).text(),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
    const declared = asFetch(
      async () => new Response('x', { headers: { 'content-length': '5000' } }),
    );
    await expect(guardedFetch(opts, declared)('http://seller.test/x')).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
    const ok = asFetch(async () => new Response(stream(['{"ok":true}']), { status: 402 }));
    const res = await guardedFetch(opts, ok)('http://seller.test/x');
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ ok: true });
  });
});
