'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  ExecutionReceipt,
  RouteResponse,
  RouteState,
  RoutingMode,
  TaskProfile,
} from '@subbuddy/contracts';
import { useState } from 'react';
import type { RouteDetail } from '../../src/lib/api';
import {
  classifierLabel,
  failureCopy,
  networkLabel,
  shortHash,
  type EvidenceView,
  type FailureCode,
  type SelectedView,
  type UiState,
} from '../../src/lib/route-ui';

const card = 'rounded-lg border border-neutral-200 bg-white p-4';

/** FR-010 task type plus, when the API reports it, which classifier produced it. */
export function TaskLabel({
  taskProfile,
  classifierSource,
}: {
  taskProfile: TaskProfile;
  classifierSource: unknown;
}) {
  const cls = classifierLabel(classifierSource);
  return (
    <span data-testid="task-type">
      {taskProfile.taskType} · {taskProfile.reasoningLevel} reasoning
      {cls && (
        <span className="ml-1 text-xs text-neutral-500" data-testid="classifier-source">
          ({cls})
        </span>
      )}
    </span>
  );
}

export function SelectedOfferCard({
  selected,
  route,
  mode,
  taskProfile,
  classifierSource,
}: {
  selected: SelectedView;
  route: RouteResponse | null;
  mode: RoutingMode | null;
  taskProfile: TaskProfile | null;
  classifierSource: unknown;
}) {
  return (
    <section aria-label="Selected offer" className={card} data-testid="selected-offer">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Selected offer</h2>
        {mode && (
          <span
            className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium capitalize text-indigo-800"
            data-testid="routing-mode"
          >
            {mode} mode
          </span>
        )}
      </div>
      <p className="mt-1 text-base font-medium">
        {selected.sellerName}
        {selected.modelId && (
          <span className="ml-2 font-mono text-xs text-neutral-500">{selected.modelId}</span>
        )}
      </p>
      {taskProfile && (
        <p className="mt-1 text-sm text-neutral-700">
          Task: <TaskLabel taskProfile={taskProfile} classifierSource={classifierSource} />
        </p>
      )}
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <dt className="text-neutral-500">Score</dt>
        <dd className="font-mono">{selected.score ?? '—'}</dd>
        <dt className="text-neutral-500">Estimated</dt>
        <dd className="font-mono">
          {selected.estimatedCost} {selected.asset}
        </dd>
        <dt className="text-neutral-500">Quoted</dt>
        <dd className="font-mono font-semibold" data-testid="quoted-cost">
          {selected.quotedCost ? `${selected.quotedCost} ${selected.asset}` : 'pending'}
        </dd>
        {route && (
          <>
            <dt className="text-neutral-500">Mandate</dt>
            <dd className="font-mono text-xs">
              ≤ {route.mandate.maxCost} {route.mandate.asset} ·{' '}
              {networkLabel(route.mandate.network)}
            </dd>
          </>
        )}
      </dl>
      {selected.reason && <p className="mt-2 text-sm text-neutral-700">{selected.reason}</p>}
    </section>
  );
}

export function PaymentEvidence({ evidence }: { evidence: EvidenceView }) {
  const [copied, setCopied] = useState(false);
  const tone =
    evidence.status === 'Validated'
      ? 'bg-emerald-100 text-emerald-800'
      : evidence.status === 'Failed'
        ? 'bg-red-100 text-red-800'
        : evidence.status === 'Not attempted'
          ? 'bg-slate-100 text-slate-700'
          : 'bg-amber-100 text-amber-800';
  async function copy() {
    if (!evidence.hash) return;
    try {
      await navigator.clipboard.writeText(evidence.hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; the full hash is in the title attribute
    }
  }
  return (
    <section aria-label="Payment evidence" className={card} data-testid="payment-evidence">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">XRPL payment</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
          data-testid="payment-status"
        >
          {evidence.status}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-neutral-500">Amount</dt>
        <dd className="font-mono">
          {evidence.amount ?? '—'} {evidence.asset ?? ''}
        </dd>
        <dt className="text-neutral-500">Seller</dt>
        <dd>{evidence.sellerName ?? '—'}</dd>
        <dt className="text-neutral-500">Transaction</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {evidence.hash ? (
            <>
              <code className="font-mono text-xs" title={evidence.hash} data-testid="tx-hash">
                {shortHash(evidence.hash)}
              </code>
              <button
                type="button"
                onClick={copy}
                className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 focus:outline-2 focus:outline-indigo-600"
                aria-label="Copy transaction hash"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
              {evidence.explorerUrl && (
                <a
                  href={evidence.explorerUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs text-indigo-700 underline focus:outline-2 focus:outline-indigo-600"
                  data-testid="explorer-link"
                >
                  View on explorer
                </a>
              )}
            </>
          ) : (
            <span className="text-neutral-500">not yet submitted</span>
          )}
        </dd>
        {evidence.ledgerIndex !== null && (
          <>
            <dt className="text-neutral-500">Ledger</dt>
            <dd className="font-mono text-xs">{evidence.ledgerIndex}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

export function FailurePanel({
  state,
  message,
  code = null,
  onRouteAgain,
  onRetryDelivery,
}: {
  state: RouteState;
  message: string | null;
  code?: FailureCode | null;
  onRouteAgain: () => void;
  onRetryDelivery?: () => void;
}) {
  const copy = failureCopy(state, message, code);
  const paid = copy.moneyMoved;
  return (
    <section
      role="alert"
      aria-label={paid ? 'Paid execution failed' : 'Route failed'}
      data-testid="failure"
      className={`rounded-lg border p-4 ${
        paid ? 'border-amber-400 bg-amber-50' : 'border-red-300 bg-red-50'
      }`}
    >
      <h2 className={`text-base font-semibold ${paid ? 'text-amber-900' : 'text-red-900'}`}>
        {paid ? '⚠ ' : ''}
        {copy.title}
      </h2>
      <p className="mt-1 text-sm">{copy.body}</p>
      <p className="mt-2 text-xs font-medium">
        Money moved: {paid ? 'yes — one validated payment' : 'no'}. Retrying{' '}
        {copy.retrySafe
          ? 'cannot create another payment on this route.'
          : 'reuses the paid entitlement; a new purchase needs a new route.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {paid && onRetryDelivery && (
          <button
            type="button"
            onClick={onRetryDelivery}
            className="rounded-md border border-amber-600 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 focus:outline-2 focus:outline-indigo-600"
          >
            Retry delivery (no new payment)
          </button>
        )}
        <button
          type="button"
          onClick={onRouteAgain}
          className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
        >
          {paid ? 'Start a new route (new payment)' : 'Route again'}
        </button>
      </div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string | number | null | undefined }) {
  return (
    <>
      <dt className="text-neutral-500">{k}</dt>
      <dd className="break-all font-mono text-xs">{v === null || v === undefined ? '—' : v}</dd>
    </>
  );
}

/** FR-090 economic receipt. Public fields only; the API already strips blobs and secrets (SEC-009). */
export function ReceiptDetails({
  detail,
  evidence,
  classifierSource,
}: {
  detail: RouteDetail;
  evidence: EvidenceView | null;
  classifierSource: unknown;
}) {
  const sel = detail.candidates.find((c) => c.offerId === detail.selectedOfferId);
  return (
    <details className={card} data-testid="receipt">
      <summary className="cursor-pointer text-sm font-semibold focus:outline-2 focus:outline-indigo-600">
        Economic receipt
      </summary>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <Row k="Route" v={detail.routeId} />
        <Row k="Prompt hash" v={detail.promptHash} />
        <Row
          k="Task"
          v={`${detail.taskProfile.taskType} · ${detail.taskProfile.reasoningLevel} reasoning · confidence ${detail.taskProfile.confidence}${
            classifierLabel(classifierSource) ? ` · ${classifierLabel(classifierSource)}` : ''
          }`}
        />
        <Row k="Mode" v={detail.mode} />
        <Row k="State" v={detail.state} />
        <Row
          k="Candidates"
          v={detail.candidates.map((c) => `${c.displayName}: ${c.eligibility}`).join(' · ')}
        />
        <Row
          k="Selected"
          v={
            sel
              ? `${sel.displayName} (quality ${sel.qualityScore ?? '—'}, cost ${sel.costScore ?? '—'}, latency ${sel.latencyScore ?? '—'}, reliability ${sel.reliabilityScore ?? '—'}, final ${sel.finalScore ?? '—'})`
              : null
          }
        />
        <Row k="Registry estimate" v={detail.estimatedCost} />
        <Row k="Authoritative quote" v={detail.quotedCost} />
        <Row
          k="Policy"
          v={
            detail.policyDecision
              ? `${detail.policyDecision.approved ? 'approved' : 'rejected'} — ${detail.policyDecision.checks
                  .map((c) => `${c.name}:${c.passed ? 'ok' : 'fail'}`)
                  .join(', ')}`
              : null
          }
        />
        <Row
          k="Payment"
          v={`${detail.payment.status}${detail.payment.failureCode ? ` (${detail.payment.failureCode})` : ''}`}
        />
        <Row k="Tx hash" v={detail.payment.transactionHash} />
        <Row k="Explorer" v={evidence?.explorerUrl ?? null} />
        <Row
          k="Execution"
          v={`${detail.execution.status}${detail.execution.latencyMs !== null ? ` · ${detail.execution.latencyMs} ms` : ''}${detail.execution.failureCode ? ` (${detail.execution.failureCode})` : ''}`}
        />
        <Row k="Created" v={detail.createdAt} />
        <Row k="Updated" v={detail.updatedAt} />
      </dl>
    </details>
  );
}

/** Markdown element styling for the purchased answer (models reply in markdown). react-markdown escapes raw HTML. */
const MD: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  h1: (p) => <h3 className="mt-4 text-base font-semibold" {...p} />,
  h2: (p) => <h3 className="mt-4 text-base font-semibold" {...p} />,
  h3: (p) => <h4 className="mt-3 text-sm font-semibold" {...p} />,
  p: (p) => <p className="mt-2 break-words" {...p} />,
  ul: (p) => <ul className="mt-2 list-disc space-y-1 pl-5" {...p} />,
  ol: (p) => <ol className="mt-2 list-decimal space-y-1 pl-5" {...p} />,
  a: (p) => <a className="underline" target="_blank" rel="noreferrer" {...p} />,
  pre: (p) => (
    <pre
      className="mt-2 overflow-x-auto rounded bg-neutral-900 p-3 font-mono text-xs text-neutral-100 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit [&_code]:text-xs"
      {...p}
    />
  ),
  code: ({ className, children, ...rest }) =>
    className ? (
      <code className={className} {...rest}>
        {children}
      </code>
    ) : (
      <code className="rounded bg-neutral-100 px-1 font-mono text-[0.85em]" {...rest}>
        {children}
      </code>
    ),
  table: (p) => (
    <div className="mt-2 overflow-x-auto">
      <table className="text-xs" {...p} />
    </div>
  ),
  th: (p) => <th className="border-b px-2 py-1 text-left font-semibold" {...p} />,
  td: (p) => <td className="border-b px-2 py-1" {...p} />,
  blockquote: (p) => <blockquote className="mt-2 border-l-2 pl-3 text-neutral-600" {...p} />,
};

export function Answer({
  content,
  ui,
  execution,
}: {
  content: string | null;
  ui: UiState;
  execution: ExecutionReceipt | null;
}) {
  // US-005: usage and provider latency from the execution receipt (§12.5); each is null when the seller omitted it.
  const usage = execution
    ? [
        execution.inputTokens !== null ? `${execution.inputTokens} input tokens` : null,
        execution.outputTokens !== null ? `${execution.outputTokens} output tokens` : null,
        execution.latencyMs !== null ? `${execution.latencyMs} ms provider latency` : null,
      ].filter((s): s is string => s !== null)
    : [];
  return (
    <section aria-label="Answer" className={card} data-testid="answer">
      <h2 className="text-sm font-semibold">Answer</h2>
      {content ? (
        <>
          <div className="mt-2 text-sm leading-6" data-testid="answer-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>
              {content}
            </ReactMarkdown>
          </div>
          {usage.length > 0 && (
            <p className="mt-2 font-mono text-xs text-neutral-500" data-testid="usage">
              {usage.join(' · ')}
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-neutral-500" role="status">
          {ui === 'succeeded' ? 'Retrieving the result…' : 'Waiting for the seller…'}
        </p>
      )}
    </section>
  );
}
