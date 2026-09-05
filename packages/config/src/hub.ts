/**
 * XRPL AI Hub discovery (FR-021 P1). Build-time import of packages/config/hub-offers.json, captured from
 * https://xrpl-ai.org/. Every record is normalised into the FR-020 offer schema and validated before its
 * endpoint or payTo can reach the allowlist (SEC-003); an invalid record is skipped with a logged reason,
 * never a startup error. Only the configured network and settlement asset pass, so Mainnet listings are
 * excluded under APP_ENV=hackathon.
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

export interface HubStatus {
  available: boolean;
  imported: number;
  skipped: number;
  reasons: string[];
}

// ponytail: the hub publishes no latency/quality data; conservative defaults until FR-022 live refresh.
const HUB_DEFAULTS = {
  contextWindow: 8_192,
  supportsTools: false,
  p50LatencyMs: 4_000,
  reliability: 0.9,
} as const;

export const HUB_LISTINGS: unknown[] = hubFile.listings;

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
    this.offers = [...byId.values()];
    // Offers are already valid and unique, so this cannot throw; reuses the INV-010 sort+hash.
    this.registryVersion = new CuratedRegistry([...this.offers]).registryVersion;
    this.status = {
      available: this.offers.length > 0,
      imported: this.offers.length,
      skipped: reasons.length,
      reasons,
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
