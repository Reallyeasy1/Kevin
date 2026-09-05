import { CuratedRegistry, buildCuratedOffers, loadSellerEnv } from '@subbuddy/config';
import { FacilitatorClient } from 'x402-xrpl';
import { createApp, createSellerLogger } from './app.js';
import { mockUpstream, openAiCompatibleUpstream } from './upstream.js';

const env = loadSellerEnv(); // SEC-010 and NFR-009 enforced here
const logger = createSellerLogger(process.env['LOG_LEVEL'] ?? 'info');

function upstreamFromEnv() {
  if (env.SELLER_UPSTREAM_PROVIDER === 'mock') return mockUpstream();
  if (!env.SELLER_UPSTREAM_BASE_URL || !env.SELLER_UPSTREAM_API_KEY)
    throw new Error('SELLER_UPSTREAM_BASE_URL and SELLER_UPSTREAM_API_KEY are required');
  const model = process.env['SELLER_UPSTREAM_MODEL'];
  return openAiCompatibleUpstream({
    baseUrl: env.SELLER_UPSTREAM_BASE_URL,
    apiKey: env.SELLER_UPSTREAM_API_KEY,
    ...(model ? { model } : {}),
  });
}

const app = createApp({
  registry: new CuratedRegistry(buildCuratedOffers(env)),
  upstream: upstreamFromEnv(),
  facilitator: new FacilitatorClient({ baseUrl: env.FACILITATOR_URL }),
  logger,
});

const port = Number(process.env['SELLER_PORT'] || new URL(env.SELLER_BASE_URL).port || 4020);
app.listen(port, () => {
  logger.info(
    {
      port,
      network: env.XRPL_NETWORK,
      asset: env.SETTLEMENT_ASSET,
      payTo: env.SELLER_PAYTO_ADDRESS,
      upstream: env.SELLER_UPSTREAM_PROVIDER,
    },
    'seller listening',
  );
});
