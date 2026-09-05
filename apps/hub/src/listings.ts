/**
 * Listings the dummy hub publishes, in the record shape of packages/config/hub-offers.json (what
 * XrplAiHubRegistry validates). Every Testnet listing points at the demo seller so it is purchasable end to
 * end; one deliberately Mainnet record exercises the FR-021 skip path (SEC-010) on the consumer side.
 */
export interface HubListing {
  hubServiceId: string;
  hubUrl: string;
  displayName: string;
  endpoint: string;
  payTo: string;
  network: string;
  asset: 'XRP' | 'RLUSD';
  price: string;
  capabilities: string[];
}

export interface HubEnv {
  /** Where the buyer reaches the seller; hub endpoints are `${SELLER_BASE_URL}/v1/inference/<id>`. */
  SELLER_BASE_URL: string;
  SELLER_PAYTO_ADDRESS: string;
  /** Public base of this hub, used for hubUrl links (default http://localhost:<HUB_PORT>). */
  HUB_URL?: string | undefined;
  HUB_PORT?: string | undefined;
}

export const DEFAULT_HUB_PORT = 4030;

// ponytail: static demo catalogue; a real hub would read a database. Prices are 6-dp RLUSD strings.
const TESTNET: ReadonlyArray<
  Pick<HubListing, 'hubServiceId' | 'displayName' | 'price' | 'capabilities'>
> = [
  {
    hubServiceId: 'hub-greenhead-chat',
    displayName: 'Greenhead AI Chat (Testnet)',
    price: '0.003000',
    capabilities: ['general_chat', 'summarization'],
  },
  {
    hubServiceId: 'hub-swarm-research',
    displayName: 'Swarm Research Brief',
    price: '0.009000',
    capabilities: ['summarization', 'long_context_analysis'],
  },
  {
    hubServiceId: 'hub-clawbank-story',
    displayName: 'Clawbank Story Studio',
    price: '0.004000',
    capabilities: ['creative_writing', 'general_chat'],
  },
  {
    hubServiceId: 'hub-sciphr-verify',
    displayName: 'Sciphr Credential Verify',
    price: '0.012000',
    capabilities: ['extraction'],
  },
];

/** Mainnet record (a real xrpl-ai.org listing): the consumer must skip it under APP_ENV=hackathon. */
export const MAINNET_LISTING_ID = 'hub-greenhead-mainnet';

export function hubBaseUrl(env: HubEnv): string {
  return (env.HUB_URL ?? `http://localhost:${env.HUB_PORT || DEFAULT_HUB_PORT}`).replace(
    /\/+$/,
    '',
  );
}

export function buildListings(env: HubEnv): HubListing[] {
  const seller = env.SELLER_BASE_URL.replace(/\/+$/, '');
  const hub = hubBaseUrl(env);
  const testnet = TESTNET.map((l) => ({
    ...l,
    hubUrl: `${hub}/listing/${l.hubServiceId}`,
    endpoint: `${seller}/v1/inference/${l.hubServiceId}`,
    payTo: env.SELLER_PAYTO_ADDRESS,
    network: 'xrpl:1',
    asset: 'RLUSD' as const,
  }));
  return [
    ...testnet,
    {
      hubServiceId: MAINNET_LISTING_ID,
      hubUrl: `${hub}/listing/${MAINNET_LISTING_ID}`,
      displayName: 'Greenhead AI Chat (Mainnet)',
      endpoint: 'https://x402.greenhead.io/v1/ai/chat',
      payTo: 'rnPmtGgU7fMKrud7m1oK7E1ogN35qDbKV1',
      network: 'xrpl:0',
      asset: 'XRP',
      price: '0.05',
      capabilities: ['general_chat'],
    },
  ];
}
