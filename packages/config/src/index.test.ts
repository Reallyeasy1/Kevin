import { describe, expect, it } from 'vitest';
import { XRPL_NETWORKS } from '@subbuddy/contracts';
import { CuratedRegistry, buildCuratedOffers, loadBuyerEnv, loadSellerEnv } from './index.js';

// Wire-valid Testnet values; addresses are well-known public ones, the seed is a throwaway Testnet seed.
const shared = {
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
};

const buyer = {
  ...shared,
  AGENT_WALLET_SEED: 'sEdTM1uX8pu2do5XvTnutH6HsouMaM2',
  DEMO_API_KEY: 'a-long-random-demo-key-0123456789',
  HOURLY_SPEND_CAP: '1.000000',
  MANDATE_TTL_SECONDS: '300',
  DATABASE_URL: 'postgresql://subbuddy:subbuddy@localhost:5432/subbuddy',
  CLASSIFIER_PROVIDER: 'mock',
  CLASSIFIER_API_KEY: '',
};

const seller = { ...shared, SELLER_UPSTREAM_PROVIDER: 'mock', SELLER_UPSTREAM_API_KEY: '' };

describe('env (NFR-009, SEC-010)', () => {
  it('parses a complete buyer env and coerces numbers', () => {
    const env = loadBuyerEnv(buyer);
    expect(env.MANDATE_TTL_SECONDS).toBe(300);
    expect(env.CLASSIFIER_API_KEY).toBeUndefined();
  });

  it('names every missing NFR-009 variable in one message', () => {
    const {
      XRPL_NETWORK: _n,
      RLUSD_ISSUER: _i,
      FACILITATOR_URL: _f,
      AGENT_WALLET_SEED: _s,
      ...rest
    } = buyer;
    let message = '';
    try {
      loadBuyerEnv(rest);
    } catch (e) {
      message = (e as Error).message;
    }
    for (const key of [
      'XRPL_NETWORK: missing',
      'RLUSD_ISSUER',
      'FACILITATOR_URL: missing',
      'AGENT_WALLET_SEED: missing',
    ])
      expect(message).toContain(key);
    expect(message).toContain('NFR-009');
  });

  it('rejects the .env.example placeholders for seed and issuer', () => {
    expect(() =>
      loadBuyerEnv({ ...buyer, AGENT_WALLET_SEED: 'sREPLACE_WITH_TESTNET_SEED_NEVER_COMMIT' }),
    ).toThrow(/AGENT_WALLET_SEED/);
    expect(() =>
      loadBuyerEnv({ ...buyer, RLUSD_ISSUER: 'rREPLACE_WITH_TESTNET_RLUSD_ISSUER' }),
    ).toThrow(/RLUSD_ISSUER/);
  });

  it('rejects Mainnet by network id or websocket host while APP_ENV=hackathon', () => {
    expect(() => loadBuyerEnv({ ...buyer, XRPL_NETWORK: XRPL_NETWORKS.mainnet })).toThrow(
      /SEC-010/,
    );
    expect(() => loadSellerEnv({ ...seller, XRPL_WSS_URL: 'wss://s1.ripple.com:51233' })).toThrow(
      /SEC-010/,
    );
    expect(() => loadSellerEnv({ ...seller, XRPL_WSS_URL: 'wss://xrplcluster.com' })).toThrow(
      /SEC-010/,
    );
    // The guard is scoped to the hackathon env (SEC-010 wording); development may point at Mainnet.
    expect(
      loadBuyerEnv({ ...buyer, APP_ENV: 'development', XRPL_NETWORK: XRPL_NETWORKS.mainnet })
        .XRPL_NETWORK,
    ).toBe('xrpl:0');
  });

  it('keeps buyer and seller secret sets separate (§10.1)', () => {
    const s = loadSellerEnv({ ...seller, AGENT_WALLET_SEED: buyer.AGENT_WALLET_SEED });
    expect(s).not.toHaveProperty('AGENT_WALLET_SEED');
    const b = loadBuyerEnv({ ...buyer, SELLER_UPSTREAM_API_KEY: 'sk-secret' });
    expect(b).not.toHaveProperty('SELLER_UPSTREAM_API_KEY');
    expect(() =>
      loadSellerEnv({ ...seller, SELLER_UPSTREAM_PROVIDER: 'openai-compatible' }),
    ).toThrow(/SELLER_UPSTREAM_API_KEY/);
  });

  it('allows XRP as the config-only fallback asset (DEC-005)', () => {
    const { RLUSD_ISSUER: _i, RLUSD_CURRENCY_HEX: _h, ...rest } = buyer;
    const env = loadBuyerEnv({ ...rest, SETTLEMENT_ASSET: 'XRP' });
    expect(buildCuratedOffers(env)[0]?.asset).toEqual({
      code: 'XRP',
      currencyHex: null,
      issuer: null,
      decimals: 6,
    });
  });
});

describe('CuratedRegistry (FR-020, INV-010)', () => {
  const env = loadBuyerEnv(buyer);
  const offers = buildCuratedOffers(env);

  it('seeds three distinct RLUSD Testnet offers pointing at the seller', async () => {
    const reg = new CuratedRegistry(offers);
    const active = await reg.listActiveOffers();
    expect(active.map((o) => o.offerId)).toEqual([
      'deep-reasoning-v1',
      'fast-code-v1',
      'fast-text-v1',
    ]);
    for (const o of active) {
      expect(o.network).toBe('xrpl:1');
      expect(o.asset.currencyHex).toBe(shared.RLUSD_CURRENCY_HEX);
      expect(o.endpoint).toBe(`http://localhost:4020/v1/inference/${o.offerId}`);
      expect(o.payTo).toBe(shared.SELLER_PAYTO_ADDRESS);
      expect(o.source).toBe('curated');
    }
    expect(new Set(active.map((o) => o.advertisedPrice)).size).toBe(3);
    expect(new Set(active.map((o) => o.p50LatencyMs)).size).toBe(3);
    expect(
      reg.isAllowlisted('fast-code-v1', active[1]!.endpoint, shared.SELLER_PAYTO_ADDRESS),
    ).toBe(true);
    expect(
      reg.isAllowlisted(
        'fast-code-v1',
        'http://evil.example/v1/inference/fast-code-v1',
        shared.SELLER_PAYTO_ADDRESS,
      ),
    ).toBe(false);
  });

  it('fails startup on an invalid record with the offer id and field named', () => {
    const bad = offers.map((o, i) =>
      i === 1 ? { ...o, network: 'xrpl:testnet', advertisedPrice: 0.006 } : o,
    );
    expect(() => new CuratedRegistry(bad)).toThrow(/offer fast-code-v1 network/);
    expect(() => new CuratedRegistry(bad)).toThrow(/offer fast-code-v1 advertisedPrice/);
    expect(() => new CuratedRegistry([...offers, offers[0]!])).toThrow(
      /duplicate offerId fast-text-v1/,
    );
  });

  it('excludes disabled offers and hashes the set deterministically', async () => {
    const a = new CuratedRegistry(offers);
    const b = new CuratedRegistry([...offers].reverse());
    expect(b.registryVersion).toBe(a.registryVersion);
    const disabled = offers.map((o) =>
      o.offerId === 'fast-text-v1' ? { ...o, enabled: false } : o,
    );
    const c = new CuratedRegistry(disabled);
    expect(c.registryVersion).not.toBe(a.registryVersion);
    expect((await c.listActiveOffers()).map((o) => o.offerId)).not.toContain('fast-text-v1');
    expect(c.getOffer('fast-text-v1')).toBeUndefined();
  });
});
