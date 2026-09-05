/**
 * x402-protected inference seller (PRD §11.8, FR-050, FR-080, FR-081, AT-012).
 *
 * The x402-xrpl Express middleware handles the 402 body, PAYMENT-SIGNATURE decoding, facilitator verify +
 * settle and the PAYMENT-RESPONSE header. It issues a context-free random invoice id and consumes it after
 * settlement, so this module wraps it per request: the invoice id is bound to (offerId, requestId, promptHash)
 * (SEC-006), the price comes from the offer, and paid replays are answered from the execution cache before
 * the middleware would reject the consumed invoice (FR-080 idempotency).
 */
import { createHash, randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import pino, { type Logger } from 'pino';
import {
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  decodePaymentSignatureHeader,
  type FacilitatorClient,
  type PaymentRequirements,
} from 'x402-xrpl';
import { requireX402, type InvoiceStore } from 'x402-xrpl/express';
import type { CuratedRegistry } from '@subbuddy/config';
import {
  SellerInferenceRequest,
  type ApiError,
  type ErrorCode,
  type InferenceOffer,
  type SellerInferenceResponse,
} from '@subbuddy/contracts';
import type { UpstreamModel } from './upstream.js';

/** The two facilitator calls the middleware makes; tests pass a fake, index.ts a real FacilitatorClient. */
export type Facilitator = Pick<FacilitatorClient, 'verify' | 'settle'>;

export interface SellerAppOptions {
  registry: CuratedRegistry;
  upstream: UpstreamModel;
  facilitator: Facilitator;
  logger: Logger;
  /** Invoice and quote lifetime; also the 402 `maxTimeoutSeconds`. Default 600. */
  invoiceTtlSeconds?: number;
}

/** SEC-001 redaction. Prompts and model output are never logged at all (SEC-008). */
export function createSellerLogger(level = 'info'): Logger {
  return pino({
    level,
    redact: {
      paths: [
        '*.seed',
        '*.secret',
        '*.token',
        '*.authorization',
        '*.apiKey',
        '*.signedTxBlob',
        '*["payment-signature"]',
        'req.headers.authorization',
        'req.headers["payment-signature"]',
      ],
      censor: '[REDACTED]',
    },
  });
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** XRP travels as whole drops (x402-xrpl README); IOU values as decimal strings. String math only (INV-006). */
export function toDrops(xrp: string): string {
  const [int = '0', frac = ''] = xrp.split('.');
  if (frac.length > 6) throw new Error(`XRP amount ${xrp} has more than 6 decimal places`);
  return `${int}${frac.padEnd(6, '0')}`.replace(/^0+(?=\d)/, '');
}

const bindingKey = (offerId: string, requestId: string, promptHash: string): string =>
  `${offerId}\0${requestId}\0${promptHash}`;

// ponytail: in-memory; the demo runs one seller process. Move to Postgres with a unique index (SEC-007)
// if the seller is ever replicated or must survive restarts.
class Invoices implements InvoiceStore {
  private readonly reqs = new Map<string, { reqs: PaymentRequirements[]; expiresAtMs: number }>();
  private readonly idByBinding = new Map<string, string>();
  private readonly bindingById = new Map<string, string>();

  /** Create-or-retrieve: the same (offer, request, promptHash) always gets the same invoice (§11.8). */
  invoiceFor(binding: string): string {
    let id = this.idByBinding.get(binding);
    if (!id) {
      id = randomUUID().replace(/-/g, '').toUpperCase();
      this.idByBinding.set(binding, id);
      this.bindingById.set(id, binding);
    }
    return id;
  }
  bindingOf(invoiceId: string): string | undefined {
    return this.bindingById.get(invoiceId);
  }
  put(invoiceId: string, reqs: PaymentRequirements[], p: { ttlSeconds: number }): void {
    this.reqs.set(invoiceId, { reqs, expiresAtMs: Date.now() + p.ttlSeconds * 1000 });
  }
  get(invoiceId: string): PaymentRequirements[] | undefined {
    const e = this.reqs.get(invoiceId);
    if (!e) return undefined;
    if (Date.now() > e.expiresAtMs) {
      this.reqs.delete(invoiceId);
      return undefined;
    }
    return e.reqs;
  }
  consume(invoiceId: string): void {
    this.reqs.delete(invoiceId);
  }
}

interface Execution {
  /** sha256 of the PAYMENT-SIGNATURE that paid; a replay must present the same one. */
  sigHash: string;
  paymentResponse: string;
  result: Promise<SellerInferenceResponse>;
}

function fail(res: Response, status: number, code: ErrorCode, message: string): void {
  const body: ApiError = { error: { code, message, retryable: false } };
  res.status(status).json(body);
}

export function createApp(opts: SellerAppOptions) {
  const { registry, upstream, facilitator, logger } = opts;
  const invoiceTtlSeconds = opts.invoiceTtlSeconds ?? 600;
  const invoices = new Invoices();
  // FR-080: at most one upstream call per invoice; a failed execution stays failed on replay.
  const executions = new Map<string, Execution>();
  // ponytail: per-invoice lock so two concurrent paid requests cannot both reach the facilitator; the
  // middleware reads the invoice before settling and consumes it after. Postgres unique claim on
  // (invoiceId) if the seller is ever replicated.
  const inflight = new Map<string, Promise<void>>();

  const gateFor = (offer: InferenceOffer, invoiceId: string) =>
    requireX402({
      payTo: offer.payTo,
      amount: offer.asset.code === 'XRP' ? toDrops(offer.advertisedPrice) : offer.advertisedPrice,
      network: offer.network,
      asset: offer.asset.currencyHex ?? 'XRP',
      ...(offer.asset.issuer ? { issuer: offer.asset.issuer } : {}),
      maxTimeoutSeconds: invoiceTtlSeconds,
      resource: offer.endpoint,
      description: `${offer.displayName} inference`,
      facilitator: facilitator as FacilitatorClient,
      invoiceStore: invoices,
      invoiceTtlSeconds,
      invoiceIdFactory: () => invoiceId,
    });

  async function respond(res: Response, exec: Execution, log: Logger): Promise<void> {
    try {
      const r = await exec.result;
      log.info({ providerLatencyMs: r.providerLatencyMs, usage: r.usage }, 'execution delivered');
      res.json(r);
    } catch (err) {
      log.error(
        { reason: err instanceof Error ? err.message : 'unknown' },
        'upstream failed after payment',
      );
      fail(res, 502, 'PAID_EXECUTION_FAILED', 'payment settled but the upstream model failed');
    }
  }

  function inference(req: Request, res: Response, next: NextFunction): void {
    const offer = registry.getOffer(req.params['offerId'] ?? '');
    if (!offer) return fail(res, 404, 'NOT_FOUND', 'unknown offer');
    const parsed = SellerInferenceRequest.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', 'invalid request body');
    const body = parsed.data;
    const binding = bindingKey(offer.offerId, body.requestId, sha256(body.prompt));
    const log = logger.child({ requestId: body.requestId, offerId: offer.offerId });

    const sig = req.get(HEADER_PAYMENT_SIGNATURE);
    let invoiceId: string;
    if (!sig) {
      invoiceId = invoices.invoiceFor(binding);
      if (executions.has(invoiceId))
        return fail(
          res,
          409,
          'CONFLICT',
          'already paid; replay with the original PAYMENT-SIGNATURE',
        );
      log.info({ invoiceId }, 'unpaid request: issuing 402');
    } else {
      try {
        invoiceId = String(decodePaymentSignatureHeader(sig).payload['invoiceId'] ?? '');
      } catch {
        return fail(res, 400, 'PAYMENT_FAILED', 'malformed PAYMENT-SIGNATURE');
      }
      const bound = invoices.bindingOf(invoiceId);
      if (!bound) return fail(res, 400, 'PAYMENT_FAILED', 'unknown invoice');
      if (bound !== binding)
        return fail(res, 409, 'CONFLICT', 'invoice is bound to a different request');
      const id = invoiceId;
      const run = (inflight.get(id) ?? Promise.resolve()).then(
        () => new Promise<void>((release) => paid(offer, id, sig, release)),
      );
      inflight.set(id, run);
      void run.finally(() => {
        if (inflight.get(id) === run) inflight.delete(id);
      });
      return;
    }

    // The gate answers 402/400/5xx itself; it calls next() only after the facilitator settled (INV-001).
    gateFor(offer, invoiceId)(req, res, next);

    /** Runs with the per-invoice lock held; `release` must be called once the response is decided. */
    function paid(
      offer: InferenceOffer,
      invoiceId: string,
      sig: string,
      release: () => void,
    ): void {
      const done = executions.get(invoiceId);
      if (done) {
        release();
        if (done.sigHash !== sha256(sig))
          return fail(
            res,
            400,
            'PAYMENT_FAILED',
            'PAYMENT-SIGNATURE does not match the paid request',
          );
        log.info({ invoiceId }, 'idempotent replay');
        res.setHeader(HEADER_PAYMENT_RESPONSE, done.paymentResponse);
        void respond(res, done, log);
        return;
      }
      res.once('close', release); // the gate answered 402/400/5xx itself, or the client went away
      gateFor(offer, invoiceId)(req, res, (err?: unknown) => {
        release();
        if (err) return next(err);
        const settlement = (res.locals['x402'] as { settlement: { transaction: string } })
          .settlement;
        const started = Date.now();
        const result = upstream
          .complete({
            modelId: offer.modelId,
            prompt: body.prompt,
            ...(body.maxOutputTokens !== undefined
              ? { maxOutputTokens: body.maxOutputTokens }
              : {}),
          })
          .then((r): SellerInferenceResponse => ({
            requestId: body.requestId,
            offerId: offer.offerId,
            modelId: offer.modelId,
            content: r.content,
            usage: { inputTokens: r.inputTokens, outputTokens: r.outputTokens },
            providerLatencyMs: Date.now() - started,
          }));
        result.catch(() => undefined); // handled by every respond(); this only silences the "unhandled" warning
        const exec: Execution = {
          sigHash: sha256(sig),
          paymentResponse: String(res.getHeader(HEADER_PAYMENT_RESPONSE) ?? ''),
          result,
        };
        executions.set(invoiceId, exec);
        log.info(
          { invoiceId, transactionHash: settlement.transaction },
          'settled; invoking upstream once',
        );
        void respond(res, exec, log);
      });
    }
  }

  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'seller' });
  });
  app.post('/v1/inference/:offerId', inference);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if ((err as { type?: string }).type === 'entity.parse.failed')
      return fail(res, 400, 'VALIDATION_ERROR', 'invalid JSON body');
    logger.error({ reason: err instanceof Error ? err.message : 'unknown' }, 'unhandled error');
    fail(res, 500, 'INTERNAL_ERROR', 'internal error');
  });
  return app;
}
