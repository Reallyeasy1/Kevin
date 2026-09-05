// Test fixtures shared by the routing specs. Not a test file itself.
import { FALLBACK_TASK_PROFILE, type InferenceOffer, type TaskProfile } from '@subbuddy/contracts';

export const NETWORK = 'xrpl:1';

export function makeOffer(over: Partial<InferenceOffer> & { offerId: string }): InferenceOffer {
  return {
    sellerId: `seller-${over.offerId}`,
    displayName: over.offerId,
    modelId: `provider/${over.offerId}`,
    endpoint: `https://seller.example/infer/${over.offerId}`,
    payTo: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
    network: NETWORK,
    asset: {
      code: 'RLUSD',
      currencyHex: '524C555344000000000000000000000000000000',
      issuer: 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV',
      decimals: 6,
    },
    capabilities: ['general_chat', 'coding'],
    contextWindow: 32768,
    supportsTools: false,
    advertisedPrice: '0.002',
    p50LatencyMs: 1500,
    reliability: 0.98,
    qualityByTask: { general_chat: 0.8, coding: 0.8 },
    enabled: true,
    source: 'curated',
    ...over,
  };
}

export const CODING_PROFILE: TaskProfile = { ...FALLBACK_TASK_PROFILE, taskType: 'coding' };
