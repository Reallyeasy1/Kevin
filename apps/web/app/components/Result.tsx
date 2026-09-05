'use client';

import type { RouteResponse, RouteState } from '@subbuddy/contracts';
import { useState } from 'react';
import type { RouteDetail } from '../../src/lib/api';
import {
  failureCopy,
  networkLabel,
  shortHash,
  type EvidenceView,
  type SelectedView,
  type UiState,
} from '../../src/lib/route-ui';

const card = 'rounded-lg border border-neutral-200 bg-white p-4';

export function SelectedOfferCard({
  selected,
  route,
}: {
  selected: SelectedView;
  route: RouteResponse | null;
}) {
  return (
    <section aria-label="Selected offer" className={card} data-testid="selected-offer">
      <h2 className="text-sm font-semibold">Selected offer</h2>
      <p className="mt-1 text-base font-medium">
        {selected.sellerName}
        {selected.modelId && (
          <span className="ml-2 font-mono text-xs text-neutral-500">{selected.modelId}</span>
        )}
      </p>
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
  onRouteAgain,
  onRetryDelivery,
}: {
  state: RouteState;
  message: string | null;
  onRouteAgain: () => void;
  onRetryDelivery?: () => void;
}) {
  const copy = failureCopy(state, message);
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
}: {
  detail: RouteDetail;
  evidence: EvidenceView | null;
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
          v={`${detail.taskProfile.taskType} · ${detail.taskProfile.reasoningLevel} reasoning · confidence ${detail.taskProfile.confidence}`}
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

export function Answer({ content, ui }: { content: string | null; ui: UiState }) {
  return (
    <section aria-label="Answer" className={card} data-testid="answer">
      <h2 className="text-sm font-semibold">Answer</h2>
      {content ? (
        <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">{content}</pre>
      ) : (
        <p className="mt-2 text-sm text-neutral-500" role="status">
          {ui === 'succeeded' ? 'Retrieving the result…' : 'Waiting for the seller…'}
        </p>
      )}
    </section>
  );
}
