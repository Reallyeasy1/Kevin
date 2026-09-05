import type { AddressInfo } from 'node:net';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  buildPaymentSignatureHeaderForSignedBlob,
  decodePaymentResponseHeader,
  paymentRequiredFromWire,
} from 'x402-xrpl';
import {
  MergedRegistry,
  XrplAiHubRegistry,
  buildCuratedOffers,
  loadSellerEnv,
} from '@subbuddy/config';
import { SellerInferenceResponse } from '@subbuddy/contracts';
import { createApp, toDrops } from './app.js';
import { mockUpstream, openAiCompatibleUpstream, type UpstreamModel } from './upstream.js';

const RLUSD_HEX = '524C555344000000000000000000000000000000';
const ISSUER = 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV';
const SELLER = 'rhaDe3NBxgUSLL12N5Sxpii2xy8vSyXNG6';
const PAYER = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';
const TX = 'AB'.repeat(32);

const env = loadSellerEnv({
  APP_ENV: 'hackathon',
  XRPL_NETWORK: 'xrpl:1',
  XRPL_WSS_URL: 'wss://s.altnet.rippletest.net:51233',
  XRPL_EXPLORER_BASE: 'https://testnet.xrpl.org/transactions/',
  SETTLEMENT_ASSET: 'RLUSD',
  RLUSD_ISSUER: ISSUER,
  RLUSD_CURRENCY_HEX: RLUSD_HEX,
  FACILITATOR_URL: 'http://facilitator.test',
  SELLER_BASE_URL: 'http://127.0.0.1:4020',
  SELLER_PAYTO_ADDRESS: SELLER,
  SELLER_UPSTREAM_PROVIDER: 'mock',
});

const okVerify = async () => ({ isValid: true, payer: PAYER });
const okSettle = async () => ({ success: true, transaction: TX, network: 'xrpl:1', payer: PAYER });
const facilitator = { verify: vi.fn(okVerify), settle: vi.fn(okSettle) };
let modelCalls = 0;
let failUpstream = false;
const inner = mockUpstream();
const upstream: UpstreamModel = {
  async complete(input) {
    modelCalls++;
    if (failUpstream) throw new Error('boom');
    return inner.complete(input);
  },
};

/** A hub-discovered listing (FR-021) served by this seller, as the dummy hub publishes it. */
const hubListing = {
  hubServiceId: 'hub-greenhead-chat',
  hubUrl: 'http://localhost:4030/listing/hub-greenhead-chat',
  displayName: 'Greenhead AI Chat (Testnet)',
  endpoint: 'http://127.0.0.1:4020/v1/inference/hub-greenhead-chat',
  payTo: SELLER,
  network: 'xrpl:1',
  asset: 'RLUSD',
  price: '0.003000',
  capabilities: ['general_chat', 'summarization'],
};

let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let url: string;

beforeAll(async () => {
  server = createApp({
    registry: new MergedRegistry(
      buildCuratedOffers(env),
      new XrplAiHubRegistry(env, [hubListing], () => {}, { source: 'live' }),
    ),
    upstream,
    facilitator,
    logger: pino({ level: 'silent' }),
  }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  modelCalls = 0;
  failUpstream = false;
  facilitator.verify.mockReset().mockImplementation(okVerify);
  facilitator.settle.mockReset().mockImplementation(okSettle);
});

const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; retryable: boolean } }).error;

const post = (offerId: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${url}/v1/inference/${offerId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

/** Unpaid request -> 402; returns the exact requirement and a PAYMENT-SIGNATURE for it. */
async function quote(offerId: string, body: unknown) {
  const res = await post(offerId, body);
  expect(res.status).toBe(402);
  const required = paymentRequiredFromWire(await res.json());
  const req = required.accepts[0]!;
  const invoiceId = req.extra!['invoiceId'] as string;
  const sig = buildPaymentSignatureHeaderForSignedBlob({
    req,
    signedTxBlob: 'DEADBEEF',
    invoiceId,
  });
  return { required, req, invoiceId, sig };
}

describe('seller /health', () => {
  it('responds ok over HTTP', async () => {
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'seller' });
  });
});

describe('POST /v1/inference/:offerId (AT-012)', () => {
  const body = { requestId: 'req_1', prompt: 'Summarise the XRPL consensus protocol.' };

  it('402 gates the model, a paid retry runs it exactly once, and a replay is served from cache', async () => {
    const { required, req, invoiceId, sig } = await quote('fast-text-v1', body);
    expect(modelCalls).toBe(0);
    expect(req).toMatchObject({
      scheme: 'exact',
      network: 'xrpl:1',
      asset: RLUSD_HEX,
      payTo: SELLER,
      amount: '0.002000',
      maxTimeoutSeconds: 600,
    });
    expect(req.extra).toMatchObject({ issuer: ISSUER });
    expect(required.resource.url).toBe('http://127.0.0.1:4020/v1/inference/fast-text-v1');

    // Same unpaid request retrieves the same invoice (§11.8 create-or-retrieve, SEC-006).
    expect((await quote('fast-text-v1', body)).invoiceId).toBe(invoiceId);
    expect(modelCalls).toBe(0);

    const paid = await post('fast-text-v1', body, { [HEADER_PAYMENT_SIGNATURE]: sig });
    expect(paid.status).toBe(200);
    const result = SellerInferenceResponse.parse(await paid.json());
    expect(result).toMatchObject({
      requestId: 'req_1',
      offerId: 'fast-text-v1',
      modelId: 'demo/fast-text',
    });
    expect(result.content).toContain('[mock demo/fast-text]');
    const pr = decodePaymentResponseHeader(paid.headers.get(HEADER_PAYMENT_RESPONSE)!);
    expect(pr).toMatchObject({ success: true, transaction: TX, network: 'xrpl:1' });
    expect(modelCalls).toBe(1);
    expect(facilitator.verify).toHaveBeenCalledTimes(1);
    expect(facilitator.settle).toHaveBeenCalledTimes(1);

    // Idempotent replay (FR-080): same result, same PAYMENT-RESPONSE, no second model call or settlement.
    const replay = await post('fast-text-v1', body, { [HEADER_PAYMENT_SIGNATURE]: sig });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    expect(replay.headers.get(HEADER_PAYMENT_RESPONSE)).toBe(
      paid.headers.get(HEADER_PAYMENT_RESPONSE),
    );
    expect(modelCalls).toBe(1);
    expect(facilitator.settle).toHaveBeenCalledTimes(1);

    // An unpaid re-request of a paid invoice must not mint a fresh 402 for the same invoice id.
    expect((await post('fast-text-v1', body)).status).toBe(409);
  });

  it('serialises concurrent paid requests per invoice: one settlement, one model call, identical replies (FR-080)', async () => {
    const b = { requestId: 'req_race', prompt: 'race me' };
    const { sig } = await quote('fast-text-v1', b);
    // Slow facilitator so both requests are in flight before either settles.
    facilitator.verify.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ isValid: true, payer: PAYER }), 50)),
    );
    const [a, c] = await Promise.all([
      post('fast-text-v1', b, { [HEADER_PAYMENT_SIGNATURE]: sig }),
      post('fast-text-v1', b, { [HEADER_PAYMENT_SIGNATURE]: sig }),
    ]);
    expect(a.status).toBe(200);
    expect(c.status).toBe(200);
    expect(await c.json()).toEqual(await a.json());
    expect(a.headers.get(HEADER_PAYMENT_RESPONSE)).toBeTruthy();
    expect(c.headers.get(HEADER_PAYMENT_RESPONSE)).toBe(a.headers.get(HEADER_PAYMENT_RESPONSE));
    expect(modelCalls).toBe(1);
    expect(facilitator.verify).toHaveBeenCalledTimes(1);
    expect(facilitator.settle).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed PAYMENT-SIGNATURE without touching the facilitator or the model', async () => {
    const res = await post('fast-text-v1', body, { [HEADER_PAYMENT_SIGNATURE]: 'not-base64-json' });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('PAYMENT_FAILED');
    expect(facilitator.verify).not.toHaveBeenCalled();
    expect(modelCalls).toBe(0);
  });

  it('rejects an invoice presented with a different prompt or request (SEC-006)', async () => {
    const { sig } = await quote('fast-text-v1', { requestId: 'req_2', prompt: 'original prompt' });
    const swapped = await post(
      'fast-text-v1',
      { requestId: 'req_2', prompt: 'swapped prompt' },
      {
        [HEADER_PAYMENT_SIGNATURE]: sig,
      },
    );
    expect(swapped.status).toBe(409);
    const otherOffer = await post(
      'fast-code-v1',
      { requestId: 'req_2', prompt: 'original prompt' },
      {
        [HEADER_PAYMENT_SIGNATURE]: sig,
      },
    );
    expect(otherOffer.status).toBe(409);
    expect(modelCalls).toBe(0);
  });

  it('keeps the model idle when the facilitator rejects the payment', async () => {
    const { sig } = await quote('fast-code-v1', { requestId: 'req_3', prompt: 'hello' });
    facilitator.verify.mockResolvedValueOnce({ isValid: false, payer: PAYER });
    const res = await post(
      'fast-code-v1',
      { requestId: 'req_3', prompt: 'hello' },
      { [HEADER_PAYMENT_SIGNATURE]: sig },
    );
    expect(res.status).toBe(402);
    expect(facilitator.settle).not.toHaveBeenCalled();
    expect(modelCalls).toBe(0);
  });

  it('returns a normalised PAID_EXECUTION_FAILED when the upstream fails, and does not retry the model (FR-081)', async () => {
    const b = { requestId: 'req_4', prompt: 'will fail' };
    const { sig } = await quote('deep-reasoning-v1', b);
    failUpstream = true;
    const res = await post('deep-reasoning-v1', b, { [HEADER_PAYMENT_SIGNATURE]: sig });
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toMatchObject({ code: 'PAID_EXECUTION_FAILED', retryable: false });
    expect(res.headers.get(HEADER_PAYMENT_RESPONSE)).toBeTruthy();
    failUpstream = false;
    const replay = await post('deep-reasoning-v1', b, { [HEADER_PAYMENT_SIGNATURE]: sig });
    expect(replay.status).toBe(502);
    expect(modelCalls).toBe(1);
  });

  it('quotes a hub-discovered offer at the listing price and runs the same upstream once paid (FR-021)', async () => {
    const b = { requestId: 'req_hub', prompt: 'hello from the hub' };
    const { required, req, sig } = await quote('hub-greenhead-chat', b);
    expect(req).toMatchObject({
      payTo: SELLER,
      amount: '0.003000',
      asset: RLUSD_HEX,
      network: 'xrpl:1',
    });
    expect(required.resource.url).toBe(hubListing.endpoint);
    expect(modelCalls).toBe(0);
    const paid = await post('hub-greenhead-chat', b, { [HEADER_PAYMENT_SIGNATURE]: sig });
    expect(paid.status).toBe(200);
    const result = SellerInferenceResponse.parse(await paid.json());
    // offerId is the registry id the buyer routed with (payments client checks it), modelId the hub service id.
    expect(result).toMatchObject({
      offerId: 'hub:hub-greenhead-chat',
      modelId: 'hub-greenhead-chat',
    });
    expect(result.content).toContain('[mock hub-greenhead-chat]');
    expect(modelCalls).toBe(1);
  });

  it('validates shape and offer before quoting', async () => {
    expect((await post('fast-text-v1', { prompt: 'no requestId' })).status).toBe(400);
    expect((await post('nope-v9', body)).status).toBe(404);
    expect(modelCalls).toBe(0);
  });
});

describe('helpers', () => {
  it('toDrops shifts six places with string math', () => {
    expect(toDrops('0.002000')).toBe('2000');
    expect(toDrops('1')).toBe('1000000');
    expect(toDrops('12.5')).toBe('12500000');
    expect(() => toDrops('0.0000001')).toThrow();
  });

  it('openai-compatible adapter aborts a streamed body past the size cap (SEC-004)', async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(256 * 1024));
      },
    });
    const up = openAiCompatibleUpstream({
      baseUrl: 'https://llm.test/v1',
      apiKey: 'k',
      fetchImpl: async () => new Response(stream, { status: 200 }),
    });
    await expect(up.complete({ modelId: 'm', prompt: 'p' })).rejects.toThrow(/too large/);
    expect(pulls).toBeLessThan(10);
  });

  it('openai-compatible adapter maps the wire shape and sends the key only in the header', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init!.headers as Record<string, string>)['authorization']).toBe('Bearer k-secret');
      expect(JSON.parse(init!.body as string)).toMatchObject({ model: 'gpt-x', max_tokens: 50 });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hi' } }],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        }),
        { status: 200 },
      );
    });
    const up = openAiCompatibleUpstream({
      baseUrl: 'https://llm.test/v1/',
      apiKey: 'k-secret',
      fetchImpl,
    });
    const r = await up.complete({ modelId: 'provider/gpt-x', prompt: 'hey', maxOutputTokens: 50 });
    expect(r).toEqual({ content: 'hi', inputTokens: 3, outputTokens: 1 });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://llm.test/v1/chat/completions');
  });
});
