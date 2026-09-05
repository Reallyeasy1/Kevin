import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHubServer } from './app.js';
import { MAINNET_LISTING_ID, buildListings } from './listings.js';

const SELLER = 'rhaDe3NBxgUSLL12N5Sxpii2xy8vSyXNG6';
const listings = buildListings({
  SELLER_BASE_URL: 'http://127.0.0.1:4120/',
  SELLER_PAYTO_ADDRESS: SELLER,
  HUB_URL: 'http://localhost:4030',
});

let server: ReturnType<typeof createHubServer>;
let url: string;
beforeAll(async () => {
  server = createHubServer(listings).listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('dummy XRPL AI Hub (FR-021 live discovery source)', () => {
  it('GET /health', async () => {
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'hub' });
  });

  it('GET /api/listings: Testnet listings point at the seller, one Mainnet record for the skip path', async () => {
    const res = await fetch(`${url}/api/listings`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as typeof listings;
    expect(body).toEqual(listings);
    const testnet = body.filter((l) => l.network === 'xrpl:1');
    expect(testnet).toHaveLength(4);
    for (const l of testnet) {
      expect(l.endpoint).toBe(`http://127.0.0.1:4120/v1/inference/${l.hubServiceId}`);
      expect(l.payTo).toBe(SELLER);
      expect(l.asset).toBe('RLUSD');
      expect(l.price).toMatch(/^\d+\.\d{6}$/);
      expect(l.hubUrl).toBe(`http://localhost:4030/listing/${l.hubServiceId}`);
    }
    expect(new Set(testnet.map((l) => l.price)).size).toBe(testnet.length); // distinct prices
    const mainnet = body.filter((l) => l.network !== 'xrpl:1');
    expect(mainnet).toHaveLength(1);
    expect(mainnet[0]).toMatchObject({ hubServiceId: MAINNET_LISTING_ID, network: 'xrpl:0' });
  });

  it('GET /listing/<id> renders HTML; unknown ids and other methods are rejected', async () => {
    const ok = await fetch(`${url}/listing/hub-greenhead-chat`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toMatch(/text\/html/);
    const html = await ok.text();
    expect(html).toContain('Greenhead AI Chat (Testnet)');
    expect(html).toContain('/v1/inference/hub-greenhead-chat');
    expect((await fetch(`${url}/listing/nope`)).status).toBe(404);
    expect((await fetch(`${url}/api/listings`, { method: 'POST' })).status).toBe(405);
  });
});
