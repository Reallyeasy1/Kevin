/**
 * Acceptance harness: the real buyer API (buildApp) over the real repository on the in-memory DB, the real
 * X402PaymentClient talking HTTP to the fake seller, a fake ledger and a fake signer. Tests drive only the
 * §11 wire contract through app.inject. No network beyond 127.0.0.1, no XRPL, no facilitator, no model.
 */
import { onTestFinished } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { RouteEvents } from '../../apps/api/src/events.js';
import { Metrics } from '../../apps/api/src/metrics.js';
import { CuratedRegistry, buildCuratedOffers } from '../../packages/config/src/index.js';
import {
  isTerminalRouteState,
  type Classifier,
  type PaymentClient,
  type RouteEvent,
  type RouteState,
} from '../../packages/contracts/src/index.js';
import { createFakeDb } from '../../packages/database/src/fake-db.js';
import { createRepository, createSpendLedger } from '../../packages/database/src/index.js';
import { X402PaymentClient } from '../../packages/payments/src/index.js';
import { FallbackClassifier } from '../../packages/routing/src/index.js';
import {
  AUTH,
  CODING_PROMPT,
  DEMO_API_KEY,
  EXPLORER_BASE,
  ISSUER,
  NETWORK,
  RLUSD_HEX,
  WALLET,
  sharedEnv,
} from './env.js';
import { FakeLedger } from './ledger.js';
import { createFakePaymentClient, createFakeSigner, type FakePaymentClient } from './payments.js';
import { startFakeSeller, type FakeSeller, type FakeSellerOptions } from './seller.js';

export interface HarnessOptions {
  seller?: Omit<FakeSellerOptions, 'ledger'>;
  /** 'http' (default): real X402PaymentClient over HTTP to the fake seller. 'fake': in-process PaymentClient. */
  payments?: 'http' | 'fake';
  classifier?: Classifier;
  hourlySpendCap?: string;
  rlusdBalance?: string;
  /** Route mandate TTL; default 300s. */
  mandateTtlSeconds?: number;
  /** Injected clock for the service (mandate/quote expiry checks). */
  now?: () => Date;
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;

export async function createHarness(opts: HarnessOptions = {}) {
  const ledger = new FakeLedger();
  const seller: FakeSeller = await startFakeSeller({ ledger, ...opts.seller });
  const registry = new CuratedRegistry(buildCuratedOffers(sharedEnv(seller.url)));
  seller.setOffers(await registry.listActiveOffers());
  const db = createFakeDb();
  const { signer, calls: signCalls, signed } = createFakeSigner(ledger);
  const fakePayments: FakePaymentClient | null =
    opts.payments === 'fake' ? createFakePaymentClient(registry, ledger) : null;
  const payments: PaymentClient =
    fakePayments ??
    new X402PaymentClient({
      ledger: ledger.handle,
      registry,
      expected: { network: NETWORK, currencyHex: RLUSD_HEX, issuer: ISSUER },
      // FR-051 "not previously seen": the Quote table is the invoice history, as in apps/api/src/index.ts.
      invoiceSeen: async (invoiceId) =>
        (await db.quote.findUnique({ where: { invoiceId } })) !== null,
      sleep: async () => undefined,
    });
  const balances = {
    getBalances: async () => [
      { asset: 'RLUSD' as const, amount: opts.rlusdBalance ?? '5.000000' },
      { asset: 'XRP' as const, amount: '25.000000' },
    ],
  };
  const events = new RouteEvents();
  const metrics = new Metrics();
  const app = await buildApp({
    logger: false,
    deps: {
      repo: createRepository(db),
      spend: createSpendLedger(db),
      registry,
      classifier: opts.classifier ?? new FallbackClassifier(),
      payments,
      signer,
      balances,
      events,
      metrics,
      sleep: async () => undefined,
      ...(opts.now ? { now: opts.now } : {}),
      config: {
        network: NETWORK,
        asset: 'RLUSD',
        hourlySpendCap: opts.hourlySpendCap ?? '1.000000',
        mandateTtlSeconds: opts.mandateTtlSeconds ?? 300,
        explorerBase: EXPLORER_BASE,
        walletAddress: WALLET,
        maxResolveAttempts: 3,
      },
    },
    registry,
    events,
    metrics,
    balances,
    demoApiKey: DEMO_API_KEY,
    wallet: { address: WALLET, network: NETWORK, asset: 'RLUSD' },
  });

  const close = async () => {
    await app.close();
    await seller.close();
  };
  onTestFinished(close);

  const route = (body: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/v1/routes',
      headers: AUTH,
      payload: { prompt: CODING_PROMPT, mode: 'balanced', maxCost: '0.020000', ...body },
    });
  const execute = (routeId: string, prompt: string = CODING_PROMPT) =>
    app.inject({
      method: 'POST',
      url: `/v1/routes/${routeId}/execute`,
      headers: AUTH,
      payload: { prompt },
    });
  const receipt = async (routeId: string) =>
    (await app.inject({ method: 'GET', url: `/v1/routes/${routeId}`, headers: AUTH })).json();
  const sse = (routeId: string) =>
    app.inject({ method: 'GET', url: `/v1/routes/${routeId}/events`, headers: AUTH });
  /** Resolves with the terminal route state (from the event stream), rejecting after 10s. */
  const terminal = (routeId: string) =>
    new Promise<RouteState>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`route ${routeId} never reached a terminal state`)),
        10_000,
      );
      const done = events.replay(routeId).find((e) => isTerminalRouteState(e.state));
      if (done) {
        clearTimeout(timer);
        return resolve(done.state);
      }
      const off = events.subscribe(routeId, (e: RouteEvent) => {
        if (isTerminalRouteState(e.state)) {
          clearTimeout(timer);
          off();
          resolve(e.state);
        }
      });
    });
  const states = (routeId: string): RouteState[] =>
    events
      .replay(routeId)
      .filter((e) => e.type === 'route.state_changed')
      .map((e) => e.state);
  const paymentRows = () => db.payment.findMany({});

  return {
    app,
    db,
    seller,
    ledger,
    registry,
    signCalls,
    signed,
    fakePayments,
    events,
    metrics,
    route,
    execute,
    receipt,
    sse,
    terminal,
    states,
    paymentRows,
    close,
  };
}
