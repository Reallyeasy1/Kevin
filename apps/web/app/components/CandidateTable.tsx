import type { CandidateEligibility, RouteCandidateView } from '@subbuddy/contracts';

const STATUS: Record<CandidateEligibility, { label: string; cls: string }> = {
  selected: { label: 'Selected', cls: 'bg-indigo-100 text-indigo-800' },
  eligible: { label: 'Eligible', cls: 'bg-emerald-100 text-emerald-800' },
  ineligible: { label: 'Ineligible', cls: 'bg-neutral-200 text-neutral-700' },
  quote_rejected: { label: 'Quote rejected', cls: 'bg-red-100 text-red-800' },
  not_quoted: { label: 'Not quoted', cls: 'bg-amber-100 text-amber-800' },
};

const ORDER: Record<CandidateEligibility, number> = {
  selected: 0,
  quote_rejected: 1,
  eligible: 2,
  not_quoted: 3,
  ineligible: 4,
};

function Num({ v }: { v: string | null }) {
  return <td className="px-2 py-1 text-right font-mono text-xs">{v ?? '—'}</td>;
}

/** FR-092 / §13.3: estimated and quoted prices carry distinct labels; unquoted rows never look authoritative. */
export function CandidateTable({
  candidates,
  asset,
}: {
  candidates: RouteCandidateView[];
  asset: string;
}) {
  if (candidates.length === 0) return null;
  const rows = [...candidates].sort(
    (a, b) =>
      ORDER[a.eligibility] - ORDER[b.eligibility] ||
      (b.finalScore ?? '').localeCompare(a.finalScore ?? ''),
  );
  return (
    <section
      aria-label="Candidate comparison"
      className="rounded-lg border border-neutral-200 bg-white p-4"
    >
      <h2 className="mb-2 text-sm font-semibold">Candidates considered</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm" data-testid="candidates">
          <thead className="text-left text-xs text-neutral-500">
            <tr>
              <th className="px-2 py-1">Offer</th>
              <th className="px-2 py-1 text-right">Task quality</th>
              <th className="px-2 py-1 text-right">Price ({asset})</th>
              <th className="px-2 py-1 text-right">Latency</th>
              <th className="px-2 py-1 text-right">Reliability</th>
              <th className="px-2 py-1 text-right">Score</th>
              <th className="px-2 py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.offerId} className="border-t border-neutral-100">
                <td className="px-2 py-1">
                  <span className="font-medium">{c.displayName}</span>
                  {c.rejectionReasons.length > 0 && (
                    <span className="block text-xs text-neutral-500">
                      {c.rejectionReasons.join(', ')}
                    </span>
                  )}
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
