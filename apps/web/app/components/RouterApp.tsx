'use client';

import type {
  RouteEvent,
  RouteRequest,
  RouteResponse,
  RouteState,
  WalletResponse,
} from '@subbuddy/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiRequestError,
  EXPLORER_BASE,
  api,
  backoffMs,
  isRouteState,
  subscribeEvents,
  type OffersView,
  type RouteDetail,
} from '../../src/lib/api';
import {
  deriveEvidence,
  deriveSelected,
  isTerminal,
  stepStatuses,
  uiStateFor,
  type UiState,
} from '../../src/lib/route-ui';
import { CandidateTable } from './CandidateTable';
import { Composer } from './Composer';
import { Answer, FailurePanel, PaymentEvidence, ReceiptDetails, SelectedOfferCard } from './Result';
import { Timeline } from './Timeline';
import { WalletBar } from './WalletBar';

const SETTLED_UI: ReadonlySet<UiState> = new Set([
  'idle',
  'succeeded',
  'failed_before_payment',
  'paid_execution_failed',
]);

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      resolve();
    });
  });

/** Maps a pre-payment API error code onto the route state whose failure copy fits (§13.4). */
function stateForError(code: ApiRequestError['code']): RouteState {
  switch (code) {
    case 'NO_ELIGIBLE_OFFER':
      return 'NO_ELIGIBLE_OFFER';
    case 'POLICY_REJECTED':
    case 'SPEND_CAP_REACHED':
    case 'MANDATE_EXPIRED':
      return 'POLICY_REJECTED';
    case 'PAYMENT_FAILED':
      return 'PAYMENT_FAILED';
    case 'PAID_EXECUTION_FAILED':
      return 'PAID_EXECUTION_FAILED';
    default:
      return 'FAILED';
  }
}

export function RouterApp() {
  const router = useRouter();
  const viewRouteId = useSearchParams().get('route');

  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [offers, setOffers] = useState<OffersView | null>(null);
  const [routeState, setRouteState] = useState<RouteState | null>(null);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [detail, setDetail] = useState<RouteDetail | null>(null);
  const [events, setEvents] = useState<RouteEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const lastPrompt = useRef('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    api
      .wallet()
      .then(setWallet)
      .catch((e: unknown) =>
        setWalletError(e instanceof Error ? e.message : 'Wallet unavailable.'),
      );
  }, []);

  // FR-021: source labels need each offer's hub listing URL; the notice needs hubStatus. Best effort only.
  useEffect(() => {
    api
      .offers()
      .then(setOffers)
      .catch(() => setOffers(null));
  }, []);
  const hubUrls = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of offers?.offers ?? []) if (o.hubUrl) m[o.offerId] = o.hubUrl;
    return m;
  }, [offers]);
  const hubUnavailable = offers?.hubStatus?.available === false;

  // History view (US-010): /?route=<id> renders a completed route read-only.
  useEffect(() => {
    if (!viewRouteId) return;
    api
      .getRoute(viewRouteId)
      .then((d) => {
        setDetail(d);
        setRouteState(d.state);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Route not found.'));
  }, [viewRouteId]);

  const seen = useMemo(() => {
    const s = new Set(events.map((e) => e.type));
    if (detail?.payment.status === 'SETTLED') s.add('payment.validated');
    return s;
  }, [events, detail]);
  const ui = uiStateFor(routeState, seen);
  const steps = stepStatuses(ui, routeState);
  const selected = deriveSelected(route, detail);
  const evidence = deriveEvidence(detail, events, selected, EXPLORER_BASE);
  const busy = !SETTLED_UI.has(ui);
  const candidates = route?.candidates ?? detail?.candidates ?? [];
  const asset = wallet?.balances[0]?.asset ?? route?.mandate.asset ?? 'RLUSD';

  const startedAt = events.find((e) => e.type === 'execution.started')?.timestamp;
  useEffect(() => {
    if (ui !== 'executing') return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ui]);
  const elapsedMs = startedAt ? Math.max(0, now - Date.parse(startedAt)) : 0;

  async function loadFinal(routeId: string): Promise<void> {
    try {
      const d = await api.getRoute(routeId);
      setDetail(d);
      setRouteState(d.state);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the receipt.');
    }
  }

  /** Follow SSE until a terminal state; fall back to polling with bounded backoff (§14) if the stream ends first. */
  async function follow(routeId: string, eventsUrl: string | null): Promise<void> {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    let terminal = false;
    if (eventsUrl) {
      try {
        await subscribeEvents(
          eventsUrl,
          (ev) => {
            setEvents((prev) => [...prev, ev]);
            setRouteState(ev.state);
            if (isTerminal(ev.state)) {
              terminal = true;
              ac.abort();
            }
          },
          ac.signal,
        );
      } catch {
        // aborted on terminal, or stream unavailable: polling below decides.
      }
    }
    for (let attempt = 0; !terminal && !ac.signal.aborted; attempt++) {
      await sleep(backoffMs(attempt), ac.signal);
      if (ac.signal.aborted) return;
      try {
        const d = await api.getRoute(routeId);
        setDetail(d);
        setRouteState(d.state);
        terminal = isTerminal(d.state);
      } catch {
        // transient; keep polling
      }
    }
    if (!ac.signal.aborted || terminal) await loadFinal(routeId);
  }

  async function submit(req: RouteRequest): Promise<void> {
    if (viewRouteId) router.replace('/');
    setError(null);
    setRoute(null);
    setDetail(null);
    setEvents([]);
    setRouteState('CLASSIFYING'); // synchronous first state update (NFR-002)
    lastPrompt.current = req.prompt;

    let created: RouteResponse;
    try {
      created = await api.createRoute(req);
    } catch (e) {
      const err = e instanceof ApiRequestError ? e : null;
      setError(err?.message ?? 'Unexpected error.');
      setRouteState(stateForError(err?.code ?? 'INTERNAL_ERROR'));
      if (err?.routeId) void loadFinal(err.routeId);
      return;
    }
    setRoute(created);
    setRouteState(created.state);
    if (created.state !== 'QUOTED') {
      if (isTerminal(created.state)) void loadFinal(created.routeId);
      return;
    }
    await execute(created.routeId, req.prompt);
  }

  /** POST /execute is idempotent by routeId (§11.3): the same call serves first run and retry-delivery. */
  async function execute(routeId: string, prompt: string): Promise<void> {
    try {
      const ex = await api.execute(routeId, prompt);
      // ponytail: §11.3's example state PAYMENT_PENDING is not a §9.1 route state; use the first post-approval state.
      setRouteState(isRouteState(ex.state) ? ex.state : 'POLICY_APPROVED');
      await follow(routeId, ex.eventsUrl);
    } catch (e) {
      const err = e instanceof ApiRequestError ? e : null;
      setError(err?.message ?? 'Unexpected error.');
      if (err && err.status >= 400 && err.status < 500 && err.code !== 'NETWORK_ERROR') {
        // The server refused before signing; no money moved.
        setRouteState(stateForError(err.code));
        void loadFinal(routeId);
        return;
      }
      // 5xx or transport loss after the server may have paid: never claim failure, resolve by polling (NFR-003).
      setRouteState('OUTCOME_UNKNOWN');
      await follow(routeId, null);
    }
  }

  function routeAgain(): void {
    abort.current?.abort();
    setRouteState(null);
    setRoute(null);
    setDetail(null);
    setEvents([]);
    setError(null);
    if (viewRouteId) router.replace('/');
  }

  const failed = ui === 'failed_before_payment' || ui === 'paid_execution_failed';

  return (
    <div className="flex flex-col gap-4">
      <WalletBar wallet={wallet} error={walletError} />
      {hubUnavailable && (
        <p
          role="status"
          data-testid="hub-notice"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          Hub discovery unavailable: routing over the curated registry only (FR-021).
        </p>
      )}
      <Composer asset={asset} disabled={busy} onSubmit={(req) => void submit(req)} />
      <Timeline
        ui={ui}
        routeState={routeState}
        steps={steps}
        route={route}
        selected={selected}
        evidence={evidence}
        elapsedMs={elapsedMs}
      />
      {failed && routeState && (
        <FailurePanel
          state={routeState}
          message={error}
          onRouteAgain={routeAgain}
          {...(ui === 'paid_execution_failed' && lastPrompt.current && route
            ? { onRetryDelivery: () => void execute(route.routeId, lastPrompt.current) }
            : {})}
        />
      )}
      {!failed && error && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          {error}
        </p>
      )}
      {selected && <SelectedOfferCard selected={selected} route={route} />}
      {evidence && <PaymentEvidence evidence={evidence} />}
      {(ui === 'succeeded' || ui === 'executing' || ui === 'settled') && (
        <Answer content={detail?.result ?? null} ui={ui} />
      )}
      {detail && <ReceiptDetails detail={detail} evidence={evidence} />}
      <CandidateTable candidates={candidates} asset={selected?.asset ?? asset} hubUrls={hubUrls} />
    </div>
  );
}
