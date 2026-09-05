/**
 * Shared API test harness: real service + repository over the in-memory fake db; payments, signer and
 * balances are vi.fn fakes. No network. Imported by app.test.ts and hardening.test.ts.
 */
import { vi } from 'vitest';
import {
  isTerminalRouteState,
  type PaidSellerResponse,
  type PaymentClient,
  type PaymentRequirement,
  type RouteState,
  type SellerRequest,
  type SettlementResult,
  type WalletSigner,
} from '@subbuddy/contracts';
import { CuratedRegistry, buildCuratedOffers, type SharedEnv } from '@subbuddy/config';
import { createRepository, createSpendLedger } from '@subbuddy/database';
import { FallbackClassifier } from '@subbuddy/routing';
// ponytail: the fake Prisma client is test-only and not on the package's public export map.
import { createFakeDb } from '../../../packages/database/src/fake-db.js';
import { buildApp } from './app.js';
import { RouteEvents } from './events.js';
import { Metrics } from './metrics.js';

export const RLUSD_HEX = '524C555344000000000000000000000000000000';
export const ISSUER = 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV';
export const SELLER = 'rhaDe3NBxgUSLL12N5Sxpii2xy8vSyXNG6';
export const WALLET = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';
export const KEY = 'demo-key-0123456789abcdef';
export const AUTH = { authorization: `Bearer ${KEY}` };
export const PROMPT = 'Implement Dijkstra in typescript and explain its complexity.';

export const env: SharedEnv = {
  APP_ENV: 'hackathon',
  XRPL_NETWORK: 'xrpl:1',
  XRPL_WSS_URL: 'wss://s.altnet.rippletest.net:51233',
  XRPL_EXPLORER_BASE: 'https://testnet.xrpl.org/transactions/',
  SETTLEMENT_ASSET: 'RLUSD',
  RLUSD_ISSUER: ISSUER,
  RLUSD_CURRENCY_HEX: RLUSD_HEX,
  FACILITATOR_URL: 'https://facilitator.example',
  SELLER_BASE_URL: 'http://127.0.0.1:4020',
  SELLER_PAYTO_ADDRESS: SELLER,
};

export const requirementFor = (req: SellerRequest, amount: string): PaymentRequirement => ({
  scheme: 'exact',
  network: 'xrpl:1',
  asset: RLUSD_HEX,
  issuer: ISSUER,
  payTo: SELLER,
  amount,
  invoiceId: `inv-${req.offerId}-${req.requestId}`,
  resource: req.endpoint,
  maxTimeoutSeconds: 300,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  requirementHash: 'a'.repeat(64),
});

export const okResult = (req: SellerRequest): PaidSellerResponse => ({
  result: {
    requestId: req.requestId,
    offerId: req.offerId,
    modelId: 'demo/fast-code',
    content: 'function dijkstra() {}',
    usage: { inputTokens: 20, outputTokens: 40 },
    providerLatencyMs: 900,
  },
  paymentResponse: { success: true, transactionHash: 'HASH1', network: 'xrpl:1', payer: WALLET },
});

export const settled: SettlementResult = {
  status: 'validated',
  transactionHash: 'HASH1',
  success: true,
  resultCode: 'tesSUCCESS',
  ledgerIndex: 1005,
  validatedAt: new Date().toISOString(),
  destination: SELLER,
  amount: '0.006200',
  asset: RLUSD_HEX,
};

export interface HarnessOptions {
  cap?: string;
  balance?: string;
  /** Share a db between two harnesses to simulate a process restart. */
  db?: ReturnType<typeof createFakeDb>;
  /** Extra clones of the top coding offer, so eligible offers can outnumber MAX_QUOTE_ATTEMPTS. */
  extraOffers?: number;
}

export async function harness(over: HarnessOptions = {}) {
  const db = over.db ?? createFakeDb();
  const base = buildCuratedOffers(env);
  const top = base.find((o) => o.offerId === 'fast-code-v1') as (typeof base)[number];
  const clones = Array.from({ length: over.extraOffers ?? 0 }, (_, i) => ({
    ...top,
    offerId: `clone-${i}`,
    endpoint: `${env.SELLER_BASE_URL}/v1/inference/clone-${i}`,
  }));
  const registry = new CuratedRegistry([...base, ...clones]);
  const events = new RouteEvents();
  const metrics = new Metrics();
  const payments = {
    obtainRequirement: vi.fn(async (req: SellerRequest) => requirementFor(req, '0.006200')),
    payAndRetry: vi.fn(async ({ request }: { request: SellerRequest }) => okResult(request)),
    resolveTransaction: vi.fn(async () => settled),
  };
  const signer = {
    getAddress: vi.fn(async () => WALLET),
    signExactPayment: vi.fn(async () => ({
      signedTxBlob: 'DEADBEEF',
      transactionHash: 'HASH1',
      payerAddress: WALLET,
      sequence: 7,
      lastLedgerSequence: 1100,
    })),
  };
  const balances = {
    getBalances: vi.fn(async () => [
      { asset: 'RLUSD' as const, amount: over.balance ?? '5.000000' },
      { asset: 'XRP' as const, amount: '25.000000' },
    ]),
  };
  const app = await buildApp({
    logger: false,
    deps: {
      repo: createRepository(db),
      spend: createSpendLedger(db),
      registry,
      classifier: new FallbackClassifier(),
      payments: payments as unknown as PaymentClient,
      signer: signer as unknown as WalletSigner,
      balances,
      events,
      metrics,
      sleep: async () => {},
      config: {
        network: 'xrpl:1',
        asset: 'RLUSD',
        hourlySpendCap: over.cap ?? '1.000000',
        mandateTtlSeconds: 300,
        explorerBase: env.XRPL_EXPLORER_BASE,
        walletAddress: WALLET,
        maxResolveAttempts: 3,
      },
    },
    registry,
    events,
    metrics,
    balances,
    demoApiKey: KEY,
    wallet: { address: WALLET, network: 'xrpl:1', asset: 'RLUSD' },
  });
  const terminal = (routeId: string) =>
    new Promise<RouteState>((resolve) => {
      const done = events.replay(routeId).find((e) => isTerminalRouteState(e.state));
      if (done) return resolve(done.state);
      const off = events.subscribe(routeId, (e) => {
        if (isTerminalRouteState(e.state)) {
          off();
          resolve(e.state);
        }
      });
    });
  const route = async (body: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/v1/routes',
      headers: AUTH,
      payload: { prompt: PROMPT, mode: 'balanced', maxCost: '0.020000', ...body },
    });
  const execute = (id: string, prompt = PROMPT) =>
    app.inject({
      method: 'POST',
      url: `/v1/routes/${id}/execute`,
      headers: AUTH,
      payload: { prompt },
    });
  const get = (id: string) => app.inject({ method: 'GET', url: `/v1/routes/${id}`, headers: AUTH });
  return { app, db, payments, signer, balances, events, metrics, terminal, route, execute, get };
}
