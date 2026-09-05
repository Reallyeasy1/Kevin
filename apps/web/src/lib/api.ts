/**
 * Buyer API client (PRD §11). Browser-only. The demo key is compiled into the bundle via NEXT_PUBLIC_*,
 * a hackathon-only choice documented in .env.example (SEC-011, §15.1).
 */
import {
  ROUTE_STATES,
  ROUTING_MODES,
  type ApiError,
  type ExecuteResponse,
  type OffersResponse,
  type RouteEvent,
  type RouteRequest,
  type RouteResponse,
  type RouteState,
  type RouteView,
  type RoutingMode,
  type WalletResponse,
} from '@subbuddy/contracts';

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4010').replace(
  /\/$/,
  '',
);
export const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_XRPL_EXPLORER_BASE ?? 'https://testnet.xrpl.org/transactions/';
const DEMO_KEY = process.env.NEXT_PUBLIC_DEMO_API_KEY ?? '';

/** GET /v1/routes/:id (§11.4): receipt plus the final model result when available. */
export type RouteDetail = RouteView;

/** GET /v1/offers (§11.6) plus the FR-021 hub status; the field is absent while only the curated registry exists. */
export type OffersView = OffersResponse & {
  hubStatus?: { available: boolean; imported?: number; skipped?: number; reasons?: string[] };
};

/** One row of GET /v1/routes (US-010): completed routes, newest first. */
export interface RouteListItem {
  routeId: string;
  createdAt: string;
  state: RouteState;
  /** Absent from older API builds; the row hides the label when null. */
  taskType: string | null;
  mode: RoutingMode | null;
  sellerName: string | null;
  quotedCost: string | null;
  settledAmount: string | null;
  asset: string | null;
  transactionHash: string | null;
  explorerUrl: string | null;
}
export interface RouteList {
  routes: RouteListItem[];
  nextCursor: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

// ponytail: the list endpoint is landing in apps/api concurrently; normalise the plausible key names once here
// so the page reads one shape. Collapse to the final field names once the contract is exported.
export function normalizeRouteList(raw: unknown): RouteList {
  const o = (raw ?? {}) as Record<string, unknown>;
  const rows = (
    Array.isArray(o.routes) ? o.routes : Array.isArray(o.items) ? o.items : []
  ) as Record<string, unknown>[];
  const routes: RouteListItem[] = [];
  for (const r of rows) {
    const routeId = str(r.routeId) ?? str(r.id);
    const state = r.state;
    if (!routeId || !isRouteState(state)) continue;
    const sel = (r.selected ?? null) as Record<string, unknown> | null;
    const pay = (r.payment ?? null) as Record<string, unknown> | null;
    const tp = (r.taskProfile ?? null) as Record<string, unknown> | null;
    const mode = r.mode;
    const hash = str(r.transactionHash) ?? str(pay?.transactionHash);
    routes.push({
      routeId,
      createdAt: str(r.createdAt) ?? str(r.updatedAt) ?? '',
      state,
      taskType: str(r.taskType) ?? str(tp?.taskType),
      mode:
        typeof mode === 'string' && (ROUTING_MODES as readonly string[]).includes(mode)
          ? (mode as RoutingMode)
          : null,
      sellerName:
        str(r.sellerName) ?? str(sel?.sellerName) ?? str(r.selectedOfferId) ?? str(sel?.offerId),
      quotedCost: str(r.quotedCost) ?? str(sel?.quotedCost),
      settledAmount: str(r.settledAmount) ?? str(pay?.amount),
      asset: str(r.asset) ?? str(sel?.asset) ?? str(pay?.assetCode),
      transactionHash: hash,
      explorerUrl:
        str(r.explorerUrl) ?? str(pay?.explorerUrl) ?? (hash ? EXPLORER_BASE + hash : null),
    });
  }
  return { routes, nextCursor: str(o.nextCursor) ?? str(o.cursor) };
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiError['error']['code'] | 'NETWORK_ERROR',
    message: string,
    readonly retryable: boolean,
    readonly routeId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

function headers(json: boolean): HeadersInit {
  const h: Record<string, string> = { Authorization: `Bearer ${DEMO_KEY}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...headers(init.body !== undefined), ...(init.headers ?? {}) },
    });
  } catch (e) {
    throw new ApiRequestError(0, 'NETWORK_ERROR', `Could not reach the API at ${API_BASE}.`, true);
  }
  if (res.ok) return (await res.json()) as T;
  let env: Partial<ApiError['error']> = {};
  try {
    env = ((await res.json()) as ApiError).error ?? {};
  } catch {
    // non-JSON error body; fall through with the status text
  }
  throw new ApiRequestError(
    res.status,
    env.code ?? 'INTERNAL_ERROR',
    env.message ?? `Request failed (${res.status}).`,
    env.retryable ?? false,
    env.routeId,
  );
}

export const api = {
  wallet: () => call<WalletResponse>('/v1/wallet'),
  createRoute: (req: RouteRequest) =>
    call<RouteResponse>('/v1/routes', { method: 'POST', body: JSON.stringify(req) }),
  execute: (routeId: string, prompt: string) =>
    call<ExecuteResponse>(`/v1/routes/${encodeURIComponent(routeId)}/execute`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),
  getRoute: (routeId: string) => call<RouteDetail>(`/v1/routes/${encodeURIComponent(routeId)}`),
  offers: () => call<OffersView>('/v1/offers'),
  listRoutes: async (limit: number, cursor: string | null) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor) q.set('cursor', cursor);
    return normalizeRouteList(await call<unknown>(`/v1/routes?${q}`));
  },
};

export function isRouteState(s: unknown): s is RouteState {
  return typeof s === 'string' && (ROUTE_STATES as readonly string[]).includes(s);
}

/**
 * Subscribe to GET /v1/routes/:id/events (§11.5) with fetch + ReadableStream so the bearer header travels
 * (EventSource cannot set headers). Resolves when the stream ends; rejects on transport failure.
 */
export async function subscribeEvents(
  eventsUrl: string,
  onEvent: (ev: RouteEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const url = eventsUrl.startsWith('http') ? eventsUrl : `${API_BASE}${eventsUrl}`;
  const res = await fetch(url, {
    headers: { ...headers(false), Accept: 'text/event-stream' },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new ApiRequestError(res.status, 'INTERNAL_ERROR', 'Event stream unavailable.', true);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSse(buffer);
    buffer = rest;
    for (const ev of events) onEvent(ev);
  }
}

/** Splits complete SSE frames off `buffer`; returns parsed RouteEvents and the unread remainder. */
export function parseSse(buffer: string): { events: RouteEvent[]; rest: string } {
  const frames = buffer.split(/\r?\n\r?\n/);
  const rest = frames.pop() ?? '';
  const events: RouteEvent[] = [];
  for (const frame of frames) {
    const data = frame
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as Partial<RouteEvent>;
      if (parsed.routeId && parsed.type && isRouteState(parsed.state)) {
        events.push({ ...parsed, payload: parsed.payload ?? {} } as RouteEvent);
      }
    } catch {
      // ignore malformed frame (comments, keep-alives)
    }
  }
  return { events, rest };
}

/** Bounded exponential backoff for polling (§14): 1s, 2s, 4s, 8s, 8s, ... */
export function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000);
}
