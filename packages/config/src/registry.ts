/**
 * Curated offer registry (FR-020, FR-021 P0 part, INV-010). The seed is version-controlled here; the
 * network/asset/endpoint/payTo fields come from validated env so nothing is hand-typed twice.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { InferenceOffer, type OfferAsset, type ProviderRegistry } from '@subbuddy/contracts';
import { ConfigError } from './env.js';
import type { SharedEnv } from './env.js';

type SeedOffer = Omit<InferenceOffer, 'endpoint' | 'payTo' | 'network' | 'asset' | 'source'>;

// ponytail: static seed; a JSON file adds an import step for no gain while the seller is one process.
const SEED: readonly SeedOffer[] = [
  {
    offerId: 'fast-text-v1',
    sellerId: 'demo-seller-a',
    displayName: 'Fast Text',
    modelId: 'demo/fast-text',
    capabilities: ['general_chat', 'summarization', 'extraction'],
    contextWindow: 32_768,
    supportsTools: false,
    advertisedPrice: '0.002000',
    p50LatencyMs: 1500,
    reliability: 0.98,
    qualityByTask: { general_chat: 0.78, summarization: 0.86, extraction: 0.9 },
    enabled: true,
  },
  {
    offerId: 'fast-code-v1',
    sellerId: 'demo-seller-b',
    displayName: 'Fast Code',
    modelId: 'demo/fast-code',
    capabilities: ['coding', 'general_chat', 'extraction'],
    contextWindow: 65_536,
    supportsTools: true,
    advertisedPrice: '0.006000',
    p50LatencyMs: 1800,
    reliability: 0.97,
    qualityByTask: { coding: 0.88, general_chat: 0.75, extraction: 0.8 },
    enabled: true,
  },
  {
    offerId: 'deep-reasoning-v1',
    sellerId: 'demo-seller-c',
    displayName: 'Deep Reasoning',
    modelId: 'demo/deep-reasoning',
    capabilities: [
      'mathematical_reasoning',
      'coding',
      'long_context_analysis',
      'creative_writing',
      'general_chat',
    ],
    contextWindow: 200_000,
    supportsTools: true,
    advertisedPrice: '0.015000',
    p50LatencyMs: 6000,
    reliability: 0.95,
    qualityByTask: {
      mathematical_reasoning: 0.94,
      coding: 0.92,
      long_context_analysis: 0.9,
      creative_writing: 0.85,
      general_chat: 0.88,
    },
    enabled: true,
  },
];

/** Settlement asset as carried on offers, from env (DEC-004, DEC-005). */
export function settlementAsset(env: SharedEnv): OfferAsset {
  if (env.SETTLEMENT_ASSET === 'XRP')
    return { code: 'XRP', currencyHex: null, issuer: null, decimals: 6 };
  // loadBuyerEnv/loadSellerEnv already require both for RLUSD; this guard only narrows the types.
  if (!env.RLUSD_ISSUER || !env.RLUSD_CURRENCY_HEX)
    throw new ConfigError('RLUSD_ISSUER and RLUSD_CURRENCY_HEX are required');
  return {
    code: 'RLUSD',
    currencyHex: env.RLUSD_CURRENCY_HEX,
    issuer: env.RLUSD_ISSUER,
    decimals: 6,
  };
}

/** Three RLUSD Testnet offers, all served by the one demo seller at SELLER_BASE_URL (§11.8 path shape). */
export function buildCuratedOffers(env: SharedEnv): InferenceOffer[] {
  const asset = settlementAsset(env);
  const base = env.SELLER_BASE_URL.replace(/\/+$/, '');
  return SEED.map((o) => ({
    ...o,
    endpoint: `${base}/v1/inference/${o.offerId}`,
    payTo: env.SELLER_PAYTO_ADDRESS,
    network: env.XRPL_NETWORK,
    asset,
    source: 'curated',
  }));
}

const OfferList = z.array(InferenceOffer).superRefine((offers, ctx) => {
  const seen = new Set<string>();
  offers.forEach((o, i) => {
    if (seen.has(o.offerId))
      ctx.addIssue({
        code: 'custom',
        path: [i, 'offerId'],
        message: `duplicate offerId ${o.offerId}`,
      });
    seen.add(o.offerId);
  });
});

export class CuratedRegistry implements ProviderRegistry {
  private readonly offers: readonly InferenceOffer[];
  readonly registryVersion: string;

  /** Validates at construction: an invalid record is a startup error naming the record and field (FR-020). */
  constructor(records: unknown[]) {
    const result = OfferList.safeParse(records);
    if (!result.success) {
      const lines = result.error.issues.map((issue) => {
        const [idx, ...rest] = issue.path;
        const rec = records[Number(idx)] as { offerId?: unknown } | undefined;
        const id = typeof rec?.offerId === 'string' ? rec.offerId : `#${String(idx)}`;
        return `  - offer ${id} ${rest.join('.')}: ${issue.message}`;
      });
      throw new ConfigError(`Invalid offer registry (FR-020):\n${lines.join('\n')}`);
    }
    // Sorted by offerId so identical inputs hash and order identically (INV-010).
    this.offers = [...result.data].sort((a, b) => a.offerId.localeCompare(b.offerId));
    this.registryVersion = createHash('sha256')
      .update(JSON.stringify(this.offers))
      .digest('hex')
      .slice(0, 16);
  }

  async listActiveOffers(): Promise<InferenceOffer[]> {
    return this.offers.filter((o) => o.enabled);
  }

  /** Every validated record, disabled included (used by MergedRegistry to dedupe by endpoint). */
  allOffers(): InferenceOffer[] {
    return [...this.offers];
  }

  getOffer(offerId: string): InferenceOffer | undefined {
    return this.offers.find((o) => o.offerId === offerId && o.enabled);
  }

  /**
   * SEC-003 / FR-020 allowlist: true only when an enabled offer carries exactly this endpoint and payTo.
   * Every outbound URL and every quote destination must pass this before use.
   */
  isAllowlisted(offerId: string, endpoint: string, payTo: string): boolean {
    const o = this.getOffer(offerId);
    return o !== undefined && o.endpoint === endpoint && o.payTo === payTo;
  }
}
