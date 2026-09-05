/**
 * Fake x402 seller over real HTTP (PRD §10.1: the buyer must never call a seller in-process).
 * Speaks the §11.8 wire contract: 402 with an x402 v2 body on the unpaid request, PAYMENT-SIGNATURE decode
 * and PAYMENT-RESPONSE on the paid one, invoice bound to (offerId, requestId, promptHash), at most one
 * "upstream model" invocation per invoice (FR-080). Knobs inject the AT-003/004/006/007 and NFR-004 faults.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { InferenceOffer } from '../../packages/contracts/src/index.js';
import { ISSUER, NETWORK, RLUSD_HEX, WALLET, fakeTxHash, sha256 } from './env.js';
import type { FakeLedger } from './ledger.js';

export interface FakeSellerOptions {
  ledger: FakeLedger;
  /** Quote amount per offerId; defaults to the offer's advertisedPrice. */
  prices?: Record<string, string>;
  /** Destination advertised in every 402 (AT-004); defaults to the offer's payTo. */
  payTo?: string;
  /** Offers whose endpoint answers 500 to everything (NFR-004 "one seller failure"). */
  failOffers?: string[];
  /** Upstream model fails after settlement (AT-007). */
  upstreamFails?: boolean;
  /** Paid request: settle (or not) and then drop the connection (AT-006). */
  dropPaidResponse?: 'after-settle' | 'before-settle';
  /** Quote lifetime in seconds; default 600. */
  maxTimeoutSeconds?: number;
}

export interface FakeSeller {
  url: string;
  setOffers(offers: InferenceOffer[]): void;
  /** Requests answered 402 (no PAYMENT-SIGNATURE). */
  unpaidRequests: { offerId: string; requestId: string; invoiceId: string }[];
  /** Requests carrying PAYMENT-SIGNATURE, with the raw header so a test can replay it (AT-012). */
  paidRequests: { offerId: string; invoiceId: string; header: string; transactionHash: string }[];
  /** "Upstream model" invocation counter (AT-012). */
  modelInvocations: number;
  close(): Promise<void>;
}

interface Execution {
  transactionHash: string;
  ok: boolean;
  body: unknown;
}

const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64');
const readJson = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (text += c));
    req.on('end', () => {
      try {
        resolve(text ? JSON.parse(text) : null);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
const send = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};
const fail = (res: ServerResponse, status: number, code: string, message: string): void =>
  send(res, status, { error: { code, message, retryable: false } });

export async function startFakeSeller(opts: FakeSellerOptions): Promise<FakeSeller> {
  let offers: InferenceOffer[] = [];
  const invoiceByBinding = new Map<string, string>();
  const bindingByInvoice = new Map<string, string>();
  const executions = new Map<string, Execution>();
  const seller: FakeSeller = {
    url: '',
    setOffers: (o) => void (offers = o),
    unpaidRequests: [],
    paidRequests: [],
    modelInvocations: 0,
    close: async () => undefined,
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const m = /^\/v1\/inference\/([^/?]+)$/.exec(req.url ?? '');
    if (req.method !== 'POST' || !m) return fail(res, 404, 'NOT_FOUND', 'no such endpoint');
    const offer = offers.find((o) => o.offerId === m[1]);
    if (!offer) return fail(res, 404, 'NOT_FOUND', 'unknown offer');
    if (opts.failOffers?.includes(offer.offerId))
      return fail(res, 500, 'INTERNAL_ERROR', 'seller is down');
    const body = (await readJson(req)) as { requestId?: string; prompt?: string } | null;
    if (!body?.requestId || !body.prompt)
      return fail(res, 400, 'VALIDATION_ERROR', 'invalid request body');

    const binding = `${offer.offerId}\0${body.requestId}\0${sha256(body.prompt)}`;
    const payTo = opts.payTo ?? offer.payTo;
    const amount = opts.prices?.[offer.offerId] ?? offer.advertisedPrice;
    const sig = req.headers['payment-signature'];

    if (typeof sig !== 'string') {
      let invoiceId = invoiceByBinding.get(binding);
      if (!invoiceId) {
        invoiceId = `inv-${sha256(binding).slice(0, 24)}`;
        invoiceByBinding.set(binding, invoiceId);
        bindingByInvoice.set(invoiceId, binding);
      }
      seller.unpaidRequests.push({ offerId: offer.offerId, requestId: body.requestId, invoiceId });
      // INV-001: the model is not touched here. x402 v2 body as x402-xrpl's paymentRequiredFromWire reads it.
      return send(res, 402, {
        x402Version: 2,
        resource: { url: offer.endpoint },
        accepts: [
          {
            scheme: 'exact',
            network: NETWORK,
            asset: RLUSD_HEX,
            payTo,
            amount,
            maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 600,
            extra: { invoiceId, issuer: ISSUER, sourceTag: 804681468 },
          },
        ],
        error: 'PAYMENT-SIGNATURE header is required',
      });
    }

    let payload: { invoiceId?: string; signedTxBlob?: string };
    try {
      payload = (
        JSON.parse(Buffer.from(sig, 'base64').toString('utf8')) as { payload: typeof payload }
      ).payload;
    } catch {
      return fail(res, 400, 'PAYMENT_FAILED', 'malformed PAYMENT-SIGNATURE');
    }
    const invoiceId = payload.invoiceId ?? '';
    if (bindingByInvoice.get(invoiceId) !== binding)
      return fail(res, 400, 'PAYMENT_FAILED', 'unknown invoice or wrong binding');
    const transactionHash = fakeTxHash(payload.signedTxBlob ?? '');
    seller.paidRequests.push({ offerId: offer.offerId, invoiceId, header: sig, transactionHash });

    if (opts.dropPaidResponse === 'before-settle') {
      req.socket.destroy();
      return;
    }

    // "Facilitator settle": same blob, same hash; a replay finds the execution and never re-settles.
    let exec = executions.get(invoiceId);
    if (!exec) {
      opts.ledger.settle(transactionHash, { destination: payTo, amount, asset: RLUSD_HEX });
      seller.modelInvocations += 1; // FR-080: once per invoice, only after settlement (INV-001)
      exec = {
        transactionHash,
        ok: !opts.upstreamFails,
        body: {
          requestId: body.requestId,
          offerId: offer.offerId,
          modelId: offer.modelId,
          content: `answer from ${offer.modelId}`,
          usage: { inputTokens: 20, outputTokens: 40 },
          providerLatencyMs: 900,
        },
      };
      executions.set(invoiceId, exec);
    }
    if (opts.dropPaidResponse === 'after-settle') {
      req.socket.destroy();
      return;
    }

    const paymentResponse = b64({
      success: true,
      transaction: exec.transactionHash,
      network: NETWORK,
      payer: WALLET,
    });
    if (!exec.ok)
      return send(
        res,
        502,
        { error: { code: 'PAID_EXECUTION_FAILED', message: 'upstream failed', retryable: false } },
        { 'payment-response': paymentResponse },
      );
    send(res, 200, exec.body, { 'payment-response': paymentResponse });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => fail(res, 500, 'INTERNAL_ERROR', 'fake seller crashed'));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  seller.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  seller.close = () => new Promise((r) => server.close(() => r()));
  return seller;
}
