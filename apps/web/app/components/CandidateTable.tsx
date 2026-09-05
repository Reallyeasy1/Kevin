import type { CandidateEligibility, OfferSource, RouteCandidateView } from '@subbuddy/contracts';

/** FR-021: every candidate shows where it came from; hub offers link to their xrpl-ai.org listing. */
export function SourceLabel({ source, hubUrl }: { source: OfferSource; hubUrl?: string | null }) {
  if (source === 'xrpl-ai-hub') {
    const label = 'xrpl-ai-hub';
    return hubUrl ? (
      <a
        href={hubUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="text-xs text-indigo-700 underline focus:outline-2 focus:outline-indigo-600"
        data-testid="source"
        data-source={source}
      >
        {label}
      </a>
    ) : (
      <span className="text-xs text-indigo-700" data-testid="source" data-source={source}>
        {label}
      </span>
    );
  }
  return (
    <span className="text-xs text-neutral-500" data-testid="source" data-source={source}>
      curated
    </span>
  );
}

const STATUS: Record<CandidateEligibility, { label: string; cls: string }> = {
  selected: { label: 'Selected', cls: 'bg-indigo-100 text-indigo-800' },
  eligible: { label: 'Eligible', cls: 'bg-emerald-100 text-emerald-800' },
  ineligible: { label: 'Ineligible', cls: 'bg-neutral-200 text-neutral-700' },
  quote_rejected: { label: 'Quote rejected', cls: 'bg-red-100 text-red-800' },
  not_quoted: { label: 'Not quoted', cls: 'bg-amber-100 text-amber-800' },
};

function Num({ v }: { v: string | null }) {
  return <td className="px-2 py-1 text-right font-mono text-xs">{v ?? '—'}</td>;
}

/** FR-092 / §13.3: estimated and quoted prices carry distinct labels; unquoted rows never look authoritative. */
export function CandidateTable({
  candidates,
  asset,
  hubUrls = {},
}: {
  candidates: RouteCandidateView[];
  asset: string;
  /** offerId -> hub listing URL, from GET /v1/offers (FR-021). */
  hubUrls?: Record<string, string>;
}) {
  if (candidates.length === 0) return null;
  // US-003: the API already orders candidates by rank (scored first, ineligible last, INV-010); keep that order.
  const rows = candidates;
  return (
    <section
      aria-label="Candidate comparison"
      className="rounded-lg border border-neutral-200 bg-white p-4"
    >
      <h2 className="mb-2 text-sm font-semibold">Candidates considered</h2>
      {/* tabIndex: a scrollable region must be focusable so keyboard users can pan it at 360px (NFR-007/008). */}
      <div className="overflow-x-auto" tabIndex={0}>
        <table className="w-full min-w-[620px] text-sm" data-testid="candidates">
          <thead className="text-left text-xs text-neutral-500">
            <tr>
              <th className="px-2 py-1 text-right">#</th>
              <th className="px-2 py-1">Offer</th>
              <th className="px-2 py-1">Source</th>
              <th className="px-2 py-1 text-right">Task quality</th>
              <th className="px-2 py-1 text-right">Price ({asset})</th>
              <th className="px-2 py-1 text-right">Latency</th>
              <th className="px-2 py-1 text-right">Reliability</th>
              <th className="px-2 py-1 text-right">Score</th>
              <th className="px-2 py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={c.offerId} className="border-t border-neutral-100">
                <td className="px-2 py-1 text-right font-mono text-xs text-neutral-500">{i + 1}</td>
                <td className="px-2 py-1">
                  <span className="font-medium">{c.displayName}</span>
                  {c.rejectionReasons.length > 0 && (
                    <span className="block text-xs text-neutral-500">
                      {c.rejectionReasons.join(', ')}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1">
                  <SourceLabel source={c.source} hubUrl={hubUrls[c.offerId] ?? null} />
                </td>
                <Num v={c.qualityScore} />
                <td className="px-2 py-1 text-right font-mono text-xs">
                  <span className="block">
                    {c.estimatedCost} <span className="font-sans text-neutral-500">estimated</span>
                  </span>
                  {c.quotedCost && (
                    <span className="block font-semibold">
                      {c.quotedCost} <span className="font-sans text-indigo-700">quoted</span>
                    </span>
                  )}
                </td>
                <Num v={c.latencyScore} />
                <Num v={c.reliabilityScore} />
                <Num v={c.finalScore} />
                <td className="px-2 py-1">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[c.eligibility].cls}`}
                  >
                    {STATUS[c.eligibility].label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        Quality, latency and reliability are normalised 0–1 factor scores (FR-040). Prices marked{' '}
        <em>estimated</em> come from the registry; only the <em>quoted</em> price is an
        authoritative x402 quote.
      </p>
    </section>
  );
}
