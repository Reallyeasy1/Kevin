/** Buyer API entrypoint. Config validation runs first and fails fast (NFR-009, SEC-010). */
import {
  buildCuratedOffers,
  loadBuyerEnv,
  loadMergedRegistry,
  settlementAsset,
} from '@subbuddy/config';
import { createDb, createRepository, createSpendLedger } from '@subbuddy/database';
import { X402PaymentClient, XrplWalletSigner, createLedgerClient } from '@subbuddy/payments';
import { createClassifier } from '@subbuddy/routing';
import { buildApp } from './app.js';
import { createBalanceReader } from './balances.js';
import { RouteEvents } from './events.js';
import { guardedFetch } from './http.js';
import { Metrics } from './metrics.js';

const env = loadBuyerEnv();
const asset = settlementAsset(env);
// FR-021: curated ∪ hub listings (live from HUB_URL when set, else the hub-offers.json import); hubStatus
// surfaces on GET /v1/offers for the UI notice.
const registry = await loadMergedRegistry(env, buildCuratedOffers(env), { hubUrl: env.HUB_URL });
const db = createDb(env.DATABASE_URL);
const ledger = createLedgerClient(env.XRPL_WSS_URL);

const signer = new XrplWalletSigner({
  ledger,
  network: env.XRPL_NETWORK,
  seedEnvVar: 'AGENT_WALLET_SEED',
});
// Read once at startup; the service and /v1/wallet use the cached address so no request touches the seed.
const walletAddress = await signer.getAddress();

// SEC-004: deadlines and body caps on every outbound call. The payment client adds its own per-call
// timeouts (30s quote / 120s paid); the wrapper is the outer bound and the streaming size cap.
const payments = new X402PaymentClient({
  ledger,
  registry,
  fetchImpl: guardedFetch({ timeoutMs: 120_000, maxResponseBytes: 1024 * 1024 }),
  expected: {
    network: env.XRPL_NETWORK,
    // Only consulted for issued-currency quotes; XRP settlement never reads these (validateQuote).
    currencyHex: env.RLUSD_CURRENCY_HEX ?? '524C555344000000000000000000000000000000',
    issuer: env.RLUSD_ISSUER ?? env.SELLER_PAYTO_ADDRESS,
  },
  // FR-051 "not previously seen": the Quote table is the invoice history.
  invoiceSeen: async (invoiceId) =>
    (await db.quote.findUnique({ where: { invoiceId }, select: { id: true } })) !== null,
});

const events = new RouteEvents();
const metrics = new Metrics();
const balances = createBalanceReader({
  wssUrl: env.XRPL_WSS_URL,
  asset: env.SETTLEMENT_ASSET,
  issuer: asset.issuer,
  currencyHex: asset.currencyHex,
});

const app = await buildApp({
  deps: {
    repo: createRepository(db),
    spend: createSpendLedger(db),
    registry,
    classifier: createClassifier(
      {
        provider: env.CLASSIFIER_PROVIDER,
        apiKey: env.CLASSIFIER_API_KEY,
        model: env.CLASSIFIER_MODEL,
        baseUrl: env.CLASSIFIER_BASE_URL,
      },
      guardedFetch({ timeoutMs: 8_000, maxResponseBytes: 64 * 1024 }),
    ),
    payments,
    signer,
    balances,
    events,
    metrics,
    config: {
      network: env.XRPL_NETWORK,
      asset: env.SETTLEMENT_ASSET,
      hourlySpendCap: env.HOURLY_SPEND_CAP,
      mandateTtlSeconds: env.MANDATE_TTL_SECONDS,
      explorerBase: env.XRPL_EXPLORER_BASE,
      walletAddress,
    },
  },
  registry,
  events,
  metrics,
  balances,
  demoApiKey: env.DEMO_API_KEY,
  wallet: { address: walletAddress, network: env.XRPL_NETWORK, asset: env.SETTLEMENT_ASSET },
});

const port = Number(process.env['API_PORT'] ?? 4010);
await app.listen({ port, host: '0.0.0.0' });
