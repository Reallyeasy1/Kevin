import { describe, expect, it } from 'vitest';
import { Wallet } from 'xrpl';
import { XRPL_NETWORKS } from '@subbuddy/contracts';
import {
  HUB_LISTINGS,
  MergedRegistry,
  XrplAiHubRegistry,
  buildCuratedOffers,
  buildMergedRegistry,
  loadBuyerEnv,
} from './index.js';

const buyer = {
  APP_ENV: 'hackathon',
  XRPL_NETWORK: XRPL_NETWORKS.testnet,
  XRPL_WSS_URL: 'wss://s.altnet.rippletest.net:51233',
  XRPL_EXPLORER_BASE: 'https://testnet.xrpl.org/transactions/',
  SETTLEMENT_ASSET: 'RLUSD',
  RLUSD_ISSUER: 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV',
  RLUSD_CURRENCY_HEX: '524C555344000000000000000000000000000000',
  FACILITATOR_URL: 'https://xrpl-facilitator-testnet.t54.ai',
  SELLER_BASE_URL: 'http://localhost:4020',
  SELLER_PAYTO_ADDRESS: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
  AGENT_WALLET_SEED: Wallet.generate().seed as string,
  DEMO_API_KEY: 'a-long-random-demo-key-0123456789',
  HOURLY_SPEND_CAP: '1.000000',
  MANDATE_TTL_SECONDS: '300',
  DATABASE_URL: 'postgresql://subbuddy:subbuddy@localhost:5432/subbuddy',
  CLASSIFIER_PROVIDER: 'mock',
};
const env = loadBuyerEnv(buyer);
const curated = buildCuratedOffers(env);
const noop = () => {};

/** A hub listing that is eligible on Testnet/RLUSD. */
const testnetListing = {
  hubServiceId: 'demo/testnet-chat',
  hubUrl: 'https://xrpl-ai.org/',
  displayName: 'Testnet Chat',
  endpoint: 'https://hub-seller.example/v1/chat',
  payTo: 'rUjBK34fKyMstVePdZwhfJhoQuz4U6wLDL',
  network: XRPL_NETWORKS.testnet,
  asset: 'RLUSD',
  price: '0.004',
  capabilities: ['general_chat'],
};

describe('XrplAiHubRegistry (FR-021)', () => {
  it('skips invalid records with a logged reason, never throws', async () => {
    const logs: string[] = [];
    const reg = new XrplAiHubRegistry(
      env,
      [
        testnetListing,
        { ...testnetListing, hubServiceId: 'bad/no-endpoint', endpoint: null },
        { ...testnetListing, hubServiceId: 'bad/payto', payTo: 'not-an-address' },
        { ...testnetListing, hubServiceId: 'bad/price', price: '0.004 XRP' },
        { ...testnetListing, hubServiceId: 'bad/caps', capabilities: ['telepathy'] },
        'garbage',
      ],
      (m) => logs.push(m),
    );
    expect((await reg.listActiveOffers()).map((o) => o.offerId)).toEqual(['hub:demo/testnet-chat']);
    expect(reg.status).toMatchObject({ available: true, imported: 1, skipped: 5 });
    expect(reg.status.reasons.join('\n')).toMatch(/bad\/no-endpoint: endpoint/);
    expect(reg.status.reasons.join('\n')).toMatch(/bad\/payto: payTo/);
    expect(reg.status.reasons.join('\n')).toMatch(/bad\/price: advertisedPrice/);
    expect(reg.status.reasons.join('\n')).toMatch(/bad\/caps: capabilities/);
    expect(reg.status.reasons.join('\n')).toMatch(/#5:/);
    expect(logs).toHaveLength(5);
  });

  it('normalises into the FR-020 schema with hub provenance and the configured asset', async () => {
    const [o] = await new XrplAiHubRegistry(env, [testnetListing], noop).listActiveOffers();
    expect(o).toMatchObject({
      source: 'xrpl-ai-hub',
      hubServiceId: 'demo/testnet-chat',
      hubUrl: 'https://xrpl-ai.org/',
      network: 'xrpl:1',
      advertisedPrice: '0.004',
      enabled: true,
    });
    expect(o!.asset.currencyHex).toBe(buyer.RLUSD_CURRENCY_HEX);
    expect(o!.asset.issuer).toBe(buyer.RLUSD_ISSUER);
  });

  it('excludes Mainnet listings under APP_ENV=hackathon and asset mismatches', () => {
    const reg = new XrplAiHubRegistry(
      env,
      [
        { ...testnetListing, hubServiceId: 'main/x', network: XRPL_NETWORKS.mainnet },
        { ...testnetListing, hubServiceId: 'xrp/x', asset: 'XRP' },
      ],
      noop,
    );
    expect(reg.status).toMatchObject({ available: false, imported: 0, skipped: 2 });
    expect(reg.status.reasons[0]).toMatch(/xrpl:0.*Mainnet excluded under APP_ENV=hackathon/);
    expect(reg.status.reasons[1]).toMatch(/asset XRP does not match.*RLUSD/);
  });

  it('the shipped hub-offers.json is all Mainnet, so it yields curated-only under hackathon', () => {
    expect(HUB_LISTINGS.length).toBeGreaterThanOrEqual(5);
    const reg = new XrplAiHubRegistry(env, HUB_LISTINGS, noop);
    expect(reg.status.available).toBe(false);
    expect(reg.status.skipped).toBe(HUB_LISTINGS.length);
  });
});

describe('MergedRegistry (FR-021, INV-010, SEC-003)', () => {
  it('empty hub file -> available:false and curated-only', async () => {
    const reg = buildMergedRegistry(env, curated, [], noop);
    expect(reg.hubStatus).toEqual({ available: false, imported: 0, skipped: 0, reasons: [] });
    expect((await reg.listActiveOffers()).map((o) => o.source)).toEqual([
      'curated',
      'curated',
      'curated',
    ]);
  });

  it('dedupes by endpoint with curated precedence and allowlists validated hub offers', async () => {
    const clash = {
      ...testnetListing,
      hubServiceId: 'clash/fast-text',
      endpoint: curated[0]!.endpoint,
      payTo: 'rUjBK34fKyMstVePdZwhfJhoQuz4U6wLDL',
      price: '9.99',
    };
    const reg = buildMergedRegistry(env, curated, [testnetListing, clash], noop);
    const active = await reg.listActiveOffers();
    expect(active).toHaveLength(4);
    const atClashEndpoint = active.filter((o) => o.endpoint === curated[0]!.endpoint);
    expect(atClashEndpoint).toHaveLength(1);
    expect(atClashEndpoint[0]).toMatchObject({ source: 'curated', payTo: curated[0]!.payTo });
    expect(reg.getOffer('hub:clash/fast-text')).toBeUndefined();
    expect(
      reg.isAllowlisted('hub:demo/testnet-chat', testnetListing.endpoint, testnetListing.payTo),
    ).toBe(true);
    // Skipped (invalid) hub records never reach the allowlist.
    const bad = buildMergedRegistry(
      env,
      curated,
      [{ ...testnetListing, payTo: 'not-an-address' }],
      noop,
    );
    expect(
      bad.isAllowlisted('hub:demo/testnet-chat', testnetListing.endpoint, 'not-an-address'),
    ).toBe(false);
    expect(bad.hubStatus.available).toBe(false);
  });

  it('version is deterministic over the merged set and changes when hub offers change', () => {
    const a = buildMergedRegistry(env, curated, [testnetListing], noop);
    const b = buildMergedRegistry(env, [...curated].reverse(), [testnetListing], noop);
    expect(a.registryVersion).toBe(b.registryVersion);
    const c = buildMergedRegistry(env, curated, [], noop);
    expect(c.registryVersion).not.toBe(a.registryVersion);
    expect(c.registryVersion).toBe(
      new MergedRegistry(curated, new XrplAiHubRegistry(env, [], noop)).registryVersion,
    );
  });
});
