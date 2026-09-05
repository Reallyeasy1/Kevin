import { describe, expect, it } from 'vitest';
import {
  DecimalString,
  FALLBACK_TASK_PROFILE,
  InferenceOffer,
  PaymentRequirement,
  TaskProfile,
  XrplNetworkId,
} from './index.js';

// PRD §8 FR-020 sample offer, with placeholders replaced by wire-valid values.
const offer = {
  offerId: 'fast-text-v1',
  sellerId: 'seller-a',
  displayName: 'Fast Text',
  modelId: 'provider/model-name',
  endpoint: 'https://seller.example/infer/fast-text-v1',
  payTo: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
  network: 'xrpl:1',
  asset: {
    code: 'RLUSD',
    currencyHex: '524C555344000000000000000000000000000000',
    issuer: 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV',
    decimals: 6,
  },
  capabilities: ['general_chat', 'summarization', 'extraction'],
  contextWindow: 32768,
  supportsTools: false,
  advertisedPrice: '0.002',
  p50LatencyMs: 1500,
  reliability: 0.98,
  qualityByTask: { general_chat: 0.78, summarization: 0.86, extraction: 0.9 },
  enabled: true,
};

describe('contracts', () => {
  it('parses the FR-020 sample offer and defaults source to curated', () => {
    const parsed = InferenceOffer.parse(offer);
    expect(parsed.source).toBe('curated');
    expect(parsed.advertisedPrice).toBe('0.002');
  });

  it('rejects the literal xrpl:testnet network (FR-020)', () => {
    expect(XrplNetworkId.safeParse('xrpl:testnet').success).toBe(false);
    expect(XrplNetworkId.safeParse('xrpl:1').success).toBe(true);
    expect(InferenceOffer.safeParse({ ...offer, network: 'xrpl:testnet' }).success).toBe(false);
  });

  it('rejects numbers and signed or exponent strings as money (INV-006)', () => {
    expect(DecimalString.safeParse(0.002).success).toBe(false);
    expect(DecimalString.safeParse('-0.002').success).toBe(false);
    expect(DecimalString.safeParse('2e-3').success).toBe(false);
    expect(DecimalString.safeParse('0.020000').success).toBe(true);
  });

  it('accepts the FR-010 fallback profile and rejects unknown task types', () => {
    expect(TaskProfile.parse(FALLBACK_TASK_PROFILE)).toEqual(FALLBACK_TASK_PROFILE);
    expect(TaskProfile.safeParse({ ...FALLBACK_TASK_PROFILE, taskType: 'vision' }).success).toBe(
      false,
    );
  });

  it('requires scheme exact and an invoice id on a payment requirement (FR-051)', () => {
    const req = {
      scheme: 'exact',
      network: 'xrpl:1',
      asset: '524C555344000000000000000000000000000000',
      issuer: 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV',
      payTo: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
      amount: '0.006200',
      invoiceId: 'inv_123',
      resource: 'https://seller.example/v1/inference/fast-text-v1',
      maxTimeoutSeconds: 60,
      expiresAt: '2026-09-04T18:05:00Z',
      requirementHash: 'a'.repeat(64),
    };
    expect(PaymentRequirement.safeParse(req).success).toBe(true);
    expect(PaymentRequirement.safeParse({ ...req, scheme: 'upto' }).success).toBe(false);
    expect(PaymentRequirement.safeParse({ ...req, invoiceId: '' }).success).toBe(false);
  });
});
