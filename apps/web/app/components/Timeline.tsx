import type { RouteResponse, RouteState } from '@subbuddy/contracts';
import {
  STEPS,
  STEP_LABEL,
  failureCopy,
  networkLabel,
  shortHash,
  type EvidenceView,
  type SelectedView,
  type Step,
  type StepStatus,
  type UiState,
} from '../../src/lib/route-ui';

const ICON: Record<StepStatus, string> = {
  pending: '○',
  active: '◔',
  done: '●',
  failed: '✕',
  warning: '!',
};
const COLOR: Record<StepStatus, string> = {
  pending: 'text-neutral-400',
  active: 'text-indigo-600 animate-pulse',
  done: 'text-emerald-600',
  failed: 'text-red-600',
  warning: 'text-amber-600',
};

/** §13.2 required presentation per state, as one status line. */
function statusText(
  ui: UiState,
  routeState: RouteState | null,
  route: RouteResponse | null,
  selected: SelectedView | null,
  evidence: EvidenceView | null,
  elapsedMs: number,
): string {
  const seller = selected?.sellerName ?? 'the selected seller';
  switch (ui) {
    case 'idle':
      return 'Ready. Enter a prompt and a budget, then press Route and Run.';
    case 'classifying':
      return 'Analysing the task…';
    case 'routing':
      return route
        ? `Comparing ${route.candidates.length} registry offers…`
        : 'Filtering and scoring registry offers…';
    case 'quoting':
      return `Requesting an x402 quote from ${seller}…`;
    case 'quoted':
      return `Quoted ${selected?.quotedCost ?? '?'} ${selected?.asset ?? ''} from ${seller}. Mandate: max ${route?.mandate.maxCost ?? '?'} ${route?.mandate.asset ?? ''} on ${networkLabel(route?.mandate.network ?? '')}, expires ${route ? new Date(route.mandate.expiresAt).toLocaleTimeString() : '?'}.`;
    case 'payment_pending': {
      const base = `Paying ${evidence?.amount ?? selected?.quotedCost ?? '?'} ${evidence?.asset ?? selected?.asset ?? ''} to ${seller} on ${networkLabel(route?.mandate.network ?? 'xrpl:1')}… pending`;
      if (routeState === 'OUTCOME_UNKNOWN') {
        return `${base}. Outcome unknown: resolving by transaction hash on the ledger. No second payment will be sent.`;
      }
      if (routeState === 'VERIFYING') return `${base}. Confirming the transaction on the ledger.`;
      return base;
    }
    case 'settled':
      return `Payment validated on the XRP Ledger${evidence?.hash ? ` — tx ${shortHash(evidence.hash)}` : ''}. Waiting for the seller to run inference.`;
    case 'executing':
      return `Running ${selected?.modelId ?? 'the selected model'} — ${(elapsedMs / 1000).toFixed(0)} s elapsed.`;
    case 'succeeded':
      return 'Done. Answer and receipt below.';
    case 'failed_before_payment':
      return failureCopy(routeState ?? 'FAILED').title;
    case 'paid_execution_failed':
      return failureCopy('PAID_EXECUTION_FAILED').title;
  }
}

export function Timeline({
  ui,
  routeState,
  steps,
  route,
  selected,
  evidence,
  elapsedMs,
}: {
  ui: UiState;
  routeState: RouteState | null;
  steps: Record<Step, StepStatus>;
  route: RouteResponse | null;
  selected: SelectedView | null;
  evidence: EvidenceView | null;
  elapsedMs: number;
}) {
  return (
    <section
      aria-label="Execution timeline"
      className="rounded-lg border border-neutral-200 bg-white p-4"
    >
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Steps">
        {STEPS.map((step) => (
          <li key={step} className="flex items-center gap-1.5 text-sm">
            <span aria-hidden className={`font-mono ${COLOR[steps[step]]}`}>
              {ICON[steps[step]]}
            </span>
            <span className={steps[step] === 'pending' ? 'text-neutral-400' : ''}>
              {STEP_LABEL[step]}
            </span>
            <span className="sr-only">{steps[step]}</span>
          </li>
        ))}
      </ol>
      <p
        role="status"
        aria-live="polite"
        data-testid="status"
        data-ui-state={ui}
        className="mt-3 text-sm text-neutral-800"
      >
        {statusText(ui, routeState, route, selected, evidence, elapsedMs)}
      </p>
    </section>
  );
}
