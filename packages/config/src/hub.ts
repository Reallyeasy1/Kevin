/**
 * XRPL AI Hub discovery (FR-021 P1). Two sources for the raw listings, one validation path:
 *  - live: when HUB_URL is set, `${HUB_URL}/api/listings` is fetched once at startup (3 s deadline, 256 KB
 *    body cap, SEC-004); in the demo apps/hub stands in for https://xrpl-ai.org/.
 *  - import: packages/config/hub-offers.json, captured from the hub; also the fallback when the live fetch
 *    fails, in which case hubStatus.available=false and the reason is reported.
 * Every record is normalised into the FR-020 offer schema and validated before its endpoint or payTo can
 * reach the allowlist (SEC-003); an invalid record is skipped with a logged reason, never a startup error.
 * Only the configured network and settlement asset pass, so Mainnet listings are excluded under
 * APP_ENV=hackathon.
 */
import { InferenceOffer, XRPL_NETWORKS, type ProviderRegistry } from '@subbuddy/contracts';
import { z } from 'zod';
import hubFile from '../hub-offers.json' with { type: 'json' };
import { CuratedRegistry, settlementAsset } from './registry.js';
import type { SharedEnv } from './env.js';

/** Raw hub listing as captured; nulls (unknowns) fail here and the record is skipped. */
const HubRecord = z.object({
  hubServiceId: z.string().min(1),
  hubUrl: z.url(),
  displayName: z.string().min(1),
  endpoint: z.url(),
  payTo: z.string().min(1),
  network: z.string().min(1),
  asset: z.enum(['XRP', 'RLUSD']),
  price: z.string().min(1),
  capabilities: z.array(z.string()).min(1),
});

export type HubSource = 'live' | 'import';

export interface HubStatus {
  available: boolean;
  imported: number;
  skipped: number;
  reasons: string[];
  source: HubSource;
}

/** Raw listings plus where they came from; `fallbackReason` is set when live fetch failed and the import stands in. */
export interface HubListings {
  records: unknown[];
  source: HubSource;
  fallbackReason?: string;
}

// ponytail: the hub publishes no latency/quality data; conservative defaults until FR-022 live refresh.
const HUB_DEFAULTS = {
  contextWindow: 8_192,
  supportsTools: false,
  p50LatencyMs: 4_000,
  reliability: 0.9,
} as const;

export const HUB_LISTINGS: unknown[] = hubFile.listings;

/** SEC-004 bounds on the live hub fetch; overridable only by tests. */
export const HUB_FETCH_LIMITS = { timeoutMs: 3_000, maxBytes: 256 * 1024 } as const;

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (Number(res.headers.get('content-length')) > maxBytes)
    throw new Error(`body exceeds ${maxBytes} bytes`);
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Raw hub listings: live from `${hubUrl}/api/listings` when a hub URL is configured, else the build-time
 * import. Any live failure (network, timeout, non-2xx, oversize, non-array body) falls back to the import
 * and is reported in `fallbackReason`; this never throws.
 */
export async function fetchHubListings(
  hubUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
  limits: { timeoutMs: number; maxBytes: number } = HUB_FETCH_LIMITS,
): Promise<HubListings> {
  if (!hubUrl) return { records: HUB_LISTINGS, source: 'import' };
  const url = `${hubUrl.replace(/\/+$/, '')}/api/listings`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(limits.timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: unknown = JSON.parse(await readCapped(res, limits.maxBytes));
    if (!Array.isArray(body)) throw new Error('body is not a JSON array');
    return { records: body, source: 'live' };
  } catch (err) {
    const why =
      err instanceof Error
        ? err.name === 'TimeoutError'
          ? `timed out after ${limits.timeoutMs} ms`
          : err.cause instanceof Error
            ? `${err.message}: ${err.cause.message}` // undici hides ECONNREFUSED etc. in cause
            : err.message
        : String(err);
    return {
      records: HUB_LISTINGS,
      source: 'import',
      fallbackReason: `live hub ${url} unavailable (${why}); using the hub-offers.json import`,
    };
  }
}

function issues(err: z.ZodError): string {
  return err.issues.map((is) => `${is.path.join('.')} ${is.message}`).join('; ');
}

export class XrplAiHubRegistry implements ProviderRegistry {
  /** Validated, network- and asset-filtered hub offers (all enabled). */
  readonly offers: readonly InferenceOffer[];
  readonly registryVersion: string;
  readonly status: HubStatus;

  constructor(
    env: SharedEnv,
    records: unknown[] = HUB_LISTINGS,
    log: (msg: string) => void = (m) => console.warn(m),
    origin: Pick<HubListings, 'source' | 'fallbackReason'> = { source: 'import' },
  ) {
    const asset = settlementAsset(env);
    const byId = new Map<string, InferenceOffer>();
    const reasons: string[] = [];
    records.forEach((raw, i) => {
      const rawId = (raw as { hubServiceId?: unknown } | null)?.hubServiceId;
      const id = typeof rawId === 'string' ? rawId : `#${i}`;
      const skip = (why: string) => reasons.push(`hub listing ${id}: ${why}`);
      const rec = HubRecord.safeParse(raw);
      if (!rec.success) return skip(issues(rec.error));
      const r = rec.data;
      if (r.network !== env.XRPL_NETWORK) {
        const mainnet =
          r.network === XRPL_NETWORKS.mainnet && env.APP_ENV === 'hackathon'
            ? ' (Mainnet excluded under APP_ENV=hackathon, SEC-010)'
            : '';
        return skip(`network ${r.network} is not the configured ${env.XRPL_NETWORK}${mainnet}`);
      }
      if (r.asset !== asset.code)
        return skip(`asset ${r.asset} does not match configured settlement asset ${asset.code}`);
      const offer = InferenceOffer.safeParse({
        offerId: `hub:${r.hubServiceId}`,
        sellerId: new URL(r.endpoint).host,
        displayName: r.displayName,
        modelId: r.hubServiceId,
        endpoint: r.endpoint,
        payTo: r.payTo,
        network: r.network,
        asset,
        capabilities: r.capabilities,
        advertisedPrice: r.price,
        qualityByTask: Object.fromEntries(r.capabilities.map((c) => [c, 0.7])),
        enabled: true,
        source: 'xrpl-ai-hub',
        hubServiceId: r.hubServiceId,
        hubUrl: r.hubUrl,
        ...HUB_DEFAULTS,
      });
      if (!offer.success) return skip(issues(offer.error));
      if (byId.has(offer.data.offerId)) return skip('duplicate hubServiceId');
      byId.set(offer.data.offerId, offer.data);
    });
    for (const r of reasons) log(`FR-021 skipped ${r}`);
    if (origin.fallbackReason) log(`FR-021 ${origin.fallbackReason}`);
    this.offers = [...byId.values()];
    // Offers are already valid and unique, so this cannot throw; reuses the INV-010 sort+hash.
    this.registryVersion = new CuratedRegistry([...this.offers]).registryVersion;
    this.status = {
      // A failed live fetch means discovery is unavailable even if the import fallback yielded offers.
      available: this.offers.length > 0 && origin.fallbackReason === undefined,
      imported: this.offers.length,
      skipped: reasons.length,
      reasons: origin.fallbackReason ? [origin.fallbackReason, ...reasons] : reasons,
      source: origin.source,
    };
  }

  async listActiveOffers(): Promise<InferenceOffer[]> {
    return [...this.offers];
  }
}

/**
 * CuratedRegistry ∪ XrplAiHubRegistry deduplicated by endpoint, curated fields win (FR-021). The version
 * hashes the merged set (INV-010). Extends CuratedRegistry so existing consumers keep compiling.
 */
export class MergedRegistry extends CuratedRegistry {
  readonly hubStatus: HubStatus;

  constructor(curatedRecords: unknown[], hub: XrplAiHubRegistry) {
    const curated = new CuratedRegistry(curatedRecords).allOffers();
    const taken = new Set(curated.map((o) => o.endpoint));
    super([...curated, ...hub.offers.filter((o) => !taken.has(o.endpoint))]);
    this.hubStatus = hub.status;
  }
}

/** Curated seed records plus the imported hub file, in one call for the apps. */
export function buildMergedRegistry(
  env: SharedEnv,
  curatedRecords: unknown[],
  hubRecords: unknown[] = HUB_LISTINGS,
  log?: (msg: string) => void,
): MergedRegistry {
  return new MergedRegistry(curatedRecords, new XrplAiHubRegistry(env, hubRecords, log));
}

/** Startup entry for api and seller: live hub listings when `hubUrl` is set, import otherwise or on failure. */
export async function loadMergedRegistry(
  env: SharedEnv,
  curatedRecords: unknown[],
  opts: {
    hubUrl?: string | undefined;
    fetchImpl?: typeof fetch;
    log?: (msg: string) => void;
    limits?: { timeoutMs: number; maxBytes: number };
  } = {},
): Promise<MergedRegistry> {
  const hub = await fetchHubListings(opts.hubUrl, opts.fetchImpl, opts.limits);
  return new MergedRegistry(curatedRecords, new XrplAiHubRegistry(env, hub.records, opts.log, hub));
}
