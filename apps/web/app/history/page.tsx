'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { loadHistory, type HistoryEntry } from '../../src/lib/history';

/** US-010: completed routes seen in this browser. Each links back to the read-only route view. */
export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  useEffect(() => setEntries(loadHistory()), []);
  return (
    <main className="mx-auto w-full max-w-4xl p-3 sm:p-6">
      <h1 className="text-xl font-semibold">Route history</h1>
      {entries === null ? (
        <p className="mt-2 text-sm text-neutral-500">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">
          No completed routes yet.{' '}
          <Link href="/" className="text-indigo-700 underline">
            Route a prompt
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
          {entries.map((e) => (
            <li key={e.routeId}>
              <Link
                href={`/?route=${encodeURIComponent(e.routeId)}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm hover:bg-neutral-50 focus:outline-2 focus:outline-indigo-600"
              >
                <code className="font-mono text-xs">{e.routeId}</code>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">{e.state}</span>
                <span className="capitalize text-neutral-600">{e.mode}</span>
                {e.sellerName && <span className="text-neutral-600">{e.sellerName}</span>}
                <time dateTime={e.at} className="ml-auto text-xs text-neutral-500">
                  {new Date(e.at).toLocaleString()}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
