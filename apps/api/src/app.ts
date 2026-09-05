/**
 * Fastify buyer API (PRD §11). Auth on every /v1 route (SEC-011), §11.1 envelope on every error, Pino
 * redaction for secrets/prompts/signatures (SEC-001, SEC-008), requestId on every log line (NFR-006, §19).
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ExecuteRequest,
  RouteRequest,
  isTerminalRouteState,
  type RouteEvent,
  type SettlementAssetCode,
  type XrplNetworkId,
} from '@subbuddy/contracts';
import type { CuratedRegistry } from '@subbuddy/config';
import type { BalanceReader } from './balances.js';
import { ApiError, toApiError } from './errors.js';
import type { RouteEvents } from './events.js';
import type { Metrics } from './metrics.js';
import { RouteService, type ServiceDeps } from './service.js';

/** SEC-001 / SEC-008 / SEC-009: nothing here ever reaches a log line. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["payment-signature"]',
  'req.headers["payment-response"]',
  'req.headers["x-api-key"]',
  'prompt',
  '*.prompt',
  'content',
  '*.content',
  'seed',
  '*.seed',
  'secret',
  '*.secret',
  'token',
  '*.token',
  'apiKey',
  '*.apiKey',
  'authorization',
  '*.authorization',
  'signedTxBlob',
  '*.signedTxBlob',
  'signature',
  '*.signature',
];

export interface AppOptions {
  /** Everything the service needs except `log`, which the app supplies. */
  deps: Omit<ServiceDeps, 'log'>;
  registry: CuratedRegistry;
  events: RouteEvents;
  metrics: Metrics;
  balances: BalanceReader;
  demoApiKey: string;
  wallet: { address: string; network: XrplNetworkId; asset: SettlementAssetCode };
  logger?: boolean;
}

const RouteListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(64).optional(),
});

function bearerMatches(header: string | undefined, key: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sseFrame(e: RouteEvent): string {
  return `id: ${e.eventId}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
}

export async function buildApp(
  opts: AppOptions,
): Promise<FastifyInstance & { service: RouteService }> {
  const app = Fastify({
    logger:
      opts.logger === false ? false : { redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } },
    // Correlation id on every request log line; the service child logger adds routeId/offerId/etc (§19).
    genReqId: () => randomUUID(),
    // FR-001 prompts cap at 32k chars (<=128 KiB UTF-8); anything larger is not a legitimate request.
    bodyLimit: 512 * 1024,
  });
  await app.register(cors, { origin: true });
  const service = new RouteService({ ...opts.deps, log: app.log as FastifyBaseLogger });
  const { events, metrics, registry } = opts;

  // SEC-011: demo key on every route; /health stays open for liveness probes.
  app.addHook('onRequest', async (req) => {
    if (req.url === '/health') return;
    if (!bearerMatches(req.headers.authorization, opts.demoApiKey))
      throw new ApiError('UNAUTHORIZED', 'A valid demo API key is required.');
  });

  // §11.1: one envelope for every failure. Fastify's own 4xx (bad JSON, body too large) become VALIDATION_ERROR.
  app.setErrorHandler((err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode;
    const api =
      err instanceof ApiError
        ? err
        : status !== undefined && status >= 400 && status < 500
          ? new ApiError('VALIDATION_ERROR', 'The request could not be parsed.')
          : toApiError(err);
    if (api.status >= 500) req.log.error({ err, code: api.code }, 'request failed');
    else req.log.info({ code: api.code }, 'request rejected');
    void reply.status(api.status).send(api.envelope());
  });
  app.setNotFoundHandler((_req, reply) => {
    void reply.status(404).send(new ApiError('NOT_FOUND', 'No such endpoint.').envelope());
  });

  app.get('/health', async () => ({ status: 'ok', service: 'api' }));
  // §19 metrics: Prometheus text by default (auth-protected like every non-/health route); JSON on request.
  app.get('/metrics', async (req, reply) => {
    if (req.headers.accept?.includes('application/json')) return metrics.snapshot();
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(metrics.toPrometheus());
  });

  // US-010: completed routes, newest first. `cursor` is the previous page's nextCursor.
  app.get<{ Querystring: { limit?: string; cursor?: string } }>('/v1/routes', async (req) => {
    const parsed = RouteListQuery.safeParse(req.query);
    if (!parsed.success) throw new ApiError('VALIDATION_ERROR', 'Invalid limit or cursor.');
    return service.listRoutes(parsed.data.limit, parsed.data.cursor);
  });

  // §11.2
  app.post('/v1/routes', async (req, reply) => {
    const parsed = RouteRequest.safeParse(req.body);
    if (!parsed.success) {
      const tooBig = parsed.error.issues.some(
        (i) => i.code === 'too_big' && i.path[0] === 'prompt',
      );
      throw tooBig
        ? new ApiError('PROMPT_TOO_LARGE', 'Prompt exceeds the 32,000 character limit.')
        : new ApiError('VALIDATION_ERROR', 'Request body is invalid.');
    }
    const body = await service.createRoute(parsed.data, req.id);
    return reply.status(201).send(body);
  });

  // §11.3
  app.post<{ Params: { routeId: string } }>('/v1/routes/:routeId/execute', async (req, reply) => {
    const parsed = ExecuteRequest.safeParse(req.body);
    if (!parsed.success) throw new ApiError('VALIDATION_ERROR', 'Request body is invalid.');
    const { status, body } = await service.execute(req.params.routeId, parsed.data.prompt, req.id);
    return reply.status(status).send(body);
  });

  // §11.4
  app.get<{ Params: { routeId: string } }>('/v1/routes/:routeId', async (req) =>
    service.getReceipt(req.params.routeId),
  );

  // §11.5: replay history, then stream until the route is terminal. Client disconnect never affects the route.
  app.get<{ Params: { routeId: string } }>('/v1/routes/:routeId/events', async (req, reply) => {
    const { routeId } = req.params;
    await service.getReceipt(routeId); // NOT_FOUND envelope before we commit to a stream
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    let closed = false;
    let unsubscribe = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const end = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      raw.end();
    };
    // Terminal state_changed is followed synchronously by route.failed / execution.completed; give it a tick.
    const send = (e: RouteEvent) => {
      if (closed) return;
      raw.write(sseFrame(e));
      if (isTerminalRouteState(e.state)) setTimeout(end, 50);
    };
    const history = events.replay(routeId);
    for (const e of history) raw.write(sseFrame(e));
    if (history.some((e) => isTerminalRouteState(e.state))) return end();
    unsubscribe = events.subscribe(routeId, send);
    heartbeat = setInterval(() => !closed && raw.write(': ping\n\n'), 15_000);
    req.raw.on('close', end);
  });

  // §11.6: offer records carry no secrets by construction (FR-020). Every record, disabled included, with
  // its `enabled` state (#60) and `source`; a hub-backed registry (FR-021 MergedRegistry) also exposes
  // `hubStatus` for the discovery notice.
  app.get('/v1/offers', async () => {
    const hubStatus = (registry as { hubStatus?: unknown }).hubStatus;
    return {
      registryVersion: registry.registryVersion,
      offers: registry.allOffers(),
      ...(hubStatus !== undefined ? { hubStatus } : {}),
    };
  });

  // §11.7: address and balances only (INV-007).
  app.get('/v1/wallet', async () => ({
    address: opts.wallet.address,
    network: opts.wallet.network,
    balances: await opts.balances.getBalances(opts.wallet.address),
  }));

  return Object.assign(app, { service }) as FastifyInstance & { service: RouteService };
}
