'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, type RouteListItem } from '../../src/lib/api';
import { shortHash } from '../../src/lib/route-ui';

const PAGE = 20;

const STATE_TONE: Partial<Record<string, string>> = {
  SUCCEEDED: 'bg-emerald-100 text-emerald-800',
  PAID_EXECUTION_FAILED: 'bg-amber-100 text-amber-800',
};

/** US-010: completed routes from GET /v1/routes, newest first. Each row links to the read-only route view. */
export default function HistoryPage() {
  const [rows, setRows] = useState<RouteListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(after: string | null): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const page = await api.listRoutes(PAGE, after);
      setRows((prev) => (after ? [...prev, ...page.routes] : page.routes));
      setCursor(page.nextCursor);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load history.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load(null);
  }, []);

  return (
    <main className="mx-auto w-full max-w-4xl p-3 sm:p-6">
      <h1 className="text-xl font-semibold">Route history</h1>
      {error && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          {error}
        </p>
      )}
      {loaded && rows.length === 0 && !error && (
        <p className="mt-2 text-sm text-neutral-500">
          No completed routes yet.{' '}
          <Link
            href="/"
            className="text-indigo-700 underline focus:outline-2 focus:outline-indigo-600"
          >
            Route a prompt
          </Link>
          .
        </p>
      )}
      {rows.length > 0 && (
        <ul
          className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white"
          data-testid="history"
        >
          {rows.map((r) => (
            <li
              key={r.routeId}
              className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:gap-x-4"
            >
              <span
                className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${STATE_TONE[r.state] ?? 'bg-neutral-100 text-neutral-700'}`}
                data-testid="history-state"
              >
                {r.state}
              </span>
              <Link
                href={`/?route=${encodeURIComponent(r.routeId)}`}
                className="font-medium text-indigo-700 underline focus:outline-2 focus:outline-indigo-600"
              >
                {r.sellerName ?? r.routeId}
              </Link>
              <span className="font-mono text-xs text-neutral-700">
                {r.quotedCost ? `${r.quotedCost} quoted` : 'not quoted'}
                {' · '}
                {r.settledAmount
                  ? `${r.settledAmount} ${r.asset ?? ''} settled`
                  : 'nothing settled'}
              </span>
              {r.transactionHash &&
                (r.explorerUrl ? (
                  <a
                    href={r.explorerUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={r.transactionHash}
                    className="font-mono text-xs text-indigo-700 underline focus:outline-2 focus:outline-indigo-600"
                    data-testid="history-tx"
                  >
                    {shortHash(r.transactionHash)}
                  </a>
                ) : (
                  <code className="font-mono text-xs" title={r.transactionHash}>
                    {shortHash(r.transactionHash)}
                  </code>
                ))}
              {r.createdAt && (
                <time dateTime={r.createdAt} className="text-xs text-neutral-500 sm:ml-auto">
                  {new Date(r.createdAt).toLocaleString()}
                </time>
              )}
            </li>
          ))}
        </ul>
      )}
      {loading && (
        <p className="mt-2 text-sm text-neutral-500" role="status">
          Loading…
        </p>
      )}
      {cursor && !loading && (
        <button
          type="button"
          onClick={() => void load(cursor)}
          className="mt-3 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 focus:outline-2 focus:outline-indigo-600"
        >
          Load more
        </button>
      )}
    </main>
  );
}
