import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { ROUTING_MODES } from '@subbuddy/contracts';
import { filterEligible } from './eligibility.js';
import { explainSelection } from './explain.js';
import { MODE_WEIGHTS, scoreOffers } from './scoring.js';
import { CODING_PROFILE, NETWORK, makeOffer } from './fixtures.js';

// Three-offer registry in the spirit of AT-001: cheap+fast+lower quality, premium, middle.
const fastCode = makeOffer({
  offerId: 'fast-code-v1',
  displayName: 'Fast Code',
  advertisedPrice: '0.006',
  p50LatencyMs: 1200,
  reliability: 0.97,
  qualityByTask: { general_chat: 0.7, coding: 0.78 },
});
const premium = makeOffer({
  offerId: 'premium-v1',
  displayName: 'Premium',
  advertisedPrice: '0.014',
  p50LatencyMs: 2600,
  reliability: 0.99,
  qualityByTask: { general_chat: 0.9, coding: 0.95 },
});
const mid = makeOffer({
  offerId: 'mid-v1',
  displayName: 'Mid',
  advertisedPrice: '0.010',
  p50LatencyMs: 1000,
  reliability: 0.95,
  qualityByTask: { general_chat: 0.8, coding: 0.8 },
});
const offers = [premium, mid, fastCode];
const ids = (r: ReturnType<typeof scoreOffers>) => r.map((c) => c.offer.offerId);

describe('scoreOffers (FR-040)', () => {
  it('weights sum to exactly 1.00 in every mode', () => {
    for (const w of Object.values(MODE_WEIGHTS)) {
      expect(
        new Decimal(w.quality).plus(w.cost).plus(w.latency).plus(w.reliability).toFixed(2),
      ).toBe('1.00');
    }
  });

  it('normalises over the eligible set and stores 4-dp scores', () => {
    const r = scoreOffers(offers, CODING_PROFILE, 'balanced');
    const byId = Object.fromEntries(r.map((c) => [c.offer.offerId, c]));
    // priciest -> cost 0; slowest -> latency 0
    expect(byId['premium-v1']).toMatchObject({ costScore: '0.0000', latencyScore: '0.0000' });
    // 1 - 0.006/0.014 = 0.5714..., 1 - 1200/2600 = 0.5384...
    expect(byId['fast-code-v1']).toMatchObject({ costScore: '0.5714', latencyScore: '0.5385' });
    // 0.45*0.78 + 0.30*0.571428 + 0.15*0.538461 + 0.10*0.97 = 0.7002...
    expect(byId['fast-code-v1']!.finalScore).toBe('0.7002');
    for (const c of r) expect(c.finalScore).toMatch(/^\d\.\d{4}$/);
  });

  it('is deterministic regardless of input order', () => {
    for (const mode of ROUTING_MODES) {
      const a = ids(scoreOffers(offers, CODING_PROFILE, mode));
      const b = ids(scoreOffers([...offers].reverse(), CODING_PROFILE, mode));
      expect(a).toEqual(b);
    }
  });

  it('every mode picks the expected winner on the three-offer registry', () => {
    expect(ids(scoreOffers(offers, CODING_PROFILE, 'balanced'))[0]).toBe('fast-code-v1');
    expect(ids(scoreOffers(offers, CODING_PROFILE, 'quality'))[0]).toBe('premium-v1');
    expect(ids(scoreOffers(offers, CODING_PROFILE, 'cheapest'))[0]).toBe('fast-code-v1');
    expect(ids(scoreOffers(offers, CODING_PROFILE, 'fastest'))[0]).toBe('mid-v1');
  });

  it('Cheapest guarantee: lowest price wins even when its weighted score would lose', () => {
    // A very cheap, low-quality, slow, unreliable offer must still win Cheapest.
    const junk = makeOffer({
      offerId: 'junk-v1',
      advertisedPrice: '0.001',
      p50LatencyMs: 9000,
      reliability: 0.5,
      qualityByTask: { coding: 0.1 },
    });
    const r = scoreOffers([...offers, junk], CODING_PROFILE, 'cheapest');
    expect(ids(r)[0]).toBe('junk-v1');
    expect(new Decimal(r[0]!.finalScore).lt(r[1]!.finalScore)).toBe(true); // score did not decide
  });

  it('maxCost 1.000000 with equal latencies still picks the cheapest (normalisation is not over maxCost)', () => {
    const equalLatency = offers.map((o) => ({ ...o, p50LatencyMs: 1500 }));
    const { eligible } = filterEligible(equalLatency, {
      profile: CODING_PROFILE,
      maxCost: '1.000000',
      network: NETWORK,
      asset: 'RLUSD',
    });
    expect(eligible).toHaveLength(3);
    const r = scoreOffers(eligible, CODING_PROFILE, 'cheapest');
    expect(ids(r)[0]).toBe('fast-code-v1');
    // The priciest eligible offer still gets cost 0 — a generous budget does not flatten differences.
    expect(r.find((c) => c.offer.offerId === 'premium-v1')!.costScore).toBe('0.0000');
  });

  it('Fastest guarantee: lowest p50 wins; score orders only latency ties', () => {
    const slowButGreat = makeOffer({
      offerId: 'slow-great',
      advertisedPrice: '0.001',
      p50LatencyMs: 1001,
      qualityByTask: { coding: 1 },
      reliability: 1,
    });
    const r = scoreOffers([...offers, slowButGreat], CODING_PROFILE, 'fastest');
    expect(ids(r)[0]).toBe('mid-v1');
    const tie = makeOffer({ ...slowButGreat, offerId: 'tie-great', p50LatencyMs: 1000 });
    expect(ids(scoreOffers([...offers, tie], CODING_PROFILE, 'fastest')).slice(0, 2)).toEqual([
      'tie-great',
      'mid-v1',
    ]);
  });

  it('single eligible offer gets cost = latency = 1', () => {
    const [c] = scoreOffers([premium], CODING_PROFILE, 'balanced');
    expect(c).toMatchObject({
      costScore: '1.0000',
      latencyScore: '1.0000',
      qualityScore: '0.9500',
    });
    // 0.45*0.95 + 0.30 + 0.15 + 0.10*0.99 = 0.9765
    expect(c!.finalScore).toBe('0.9765');
  });

  it('quality falls back to general_chat when the task is missing from qualityByTask', () => {
    const o = makeOffer({
      offerId: 'x',
      capabilities: ['coding'],
      qualityByTask: { general_chat: 0.55 },
    });
    expect(scoreOffers([o], CODING_PROFILE, 'quality')[0]!.qualityScore).toBe('0.5500');
  });

  describe('tie-breaks (equal final score)', () => {
    const base = { qualityByTask: { coding: 0.8 }, reliability: 0.9, p50LatencyMs: 1000 };
    it('1. lower advertised price', () => {
      // Quality mode: wCost = wReliability = 0.10, so a cheaper/less-reliable offer and a pricier/more-reliable
      // one land on the exact same score. Anchor fixes maxPrice at 0.010.
      const anchor = makeOffer({ ...base, offerId: 'z-anchor', advertisedPrice: '0.010' });
      const cheap = makeOffer({
        ...base,
        offerId: 'b',
        advertisedPrice: '0.005',
        reliability: 0.5,
      });
      const pricey = makeOffer({ ...base, offerId: 'a', advertisedPrice: '0.010', reliability: 1 });
      const r = scoreOffers([pricey, cheap, anchor], CODING_PROFILE, 'quality');
      expect(r[0]!.finalScore).toBe(r[1]!.finalScore);
      expect(ids(r).slice(0, 2)).toEqual(['b', 'a']); // cheaper first despite higher reliability and smaller id
    });
    it('2. higher reliability (score tie at 4 dp, same price)', () => {
      // reliability differs by 0.0001 -> weighted difference 0.00001, rounds away at 4 dp.
      const lo = makeOffer({ ...base, offerId: 'a', reliability: 0.9 });
      const hi = makeOffer({ ...base, offerId: 'b', reliability: 0.9001 });
      const r = scoreOffers([lo, hi], CODING_PROFILE, 'balanced');
      expect(r[0]!.finalScore).toBe(r[1]!.finalScore);
      expect(ids(r)).toEqual(['b', 'a']);
    });
    it('3. lexicographically smaller offerId', () => {
      const r = scoreOffers(
        [makeOffer({ ...base, offerId: 'zeta' }), makeOffer({ ...base, offerId: 'alpha' })],
        CODING_PROFILE,
        'cheapest',
      );
      expect(ids(r)).toEqual(['alpha', 'zeta']);
    });
  });
});

describe('explainSelection (FR-041)', () => {
  it('builds the explanation from cost and quality deltas versus the highest-quality offer', () => {
    const ranked = scoreOffers(offers, CODING_PROFILE, 'balanced');
    const e = explainSelection(ranked, CODING_PROFILE, 'balanced', '0.006200');
    expect(e).toMatchObject({
      taskType: 'coding',
      mode: 'balanced',
      selectedOfferId: 'fast-code-v1',
      finalScore: '0.7002',
      estimatedCost: '0.006',
      quotedCost: '0.006200',
      factors: { quality: '0.7800', cost: '0.5714', latency: '0.5385', reliability: '0.9700' },
      deltas: {
        highestQualityOfferId: 'premium-v1',
        costSavingPct: '57.1429',
        qualityGapPts: '17.0000',
      },
    });
    expect(e.explanation).toBe(
      'Selected Fast Code because it had the highest Balanced score for a coding task. It was estimated to cost 57% less than the highest-quality eligible offer (Premium) while remaining within 17 percentage points of its coding quality score.',
    );
  });

  it('cheapest/fastest wording and the single-offer and best-quality cases', () => {
    expect(
      explainSelection(scoreOffers(offers, CODING_PROFILE, 'cheapest'), CODING_PROFILE, 'cheapest')
        .explanation,
    ).toMatch(
      /^Selected Fast Code because it had the lowest advertised price \(0\.006 RLUSD\) among 3 eligible offers/,
    );
    expect(
      explainSelection(scoreOffers(offers, CODING_PROFILE, 'fastest'), CODING_PROFILE, 'fastest')
        .explanation,
    ).toMatch(/lowest p50 latency \(1000 ms\)/);
    const single = explainSelection(
      scoreOffers([premium], CODING_PROFILE, 'quality'),
      CODING_PROFILE,
      'quality',
    );
    expect(single.explanation).toMatch(/It was the only eligible offer\.$/);
    expect(single.deltas).toBeNull();
    const best = explainSelection(
      scoreOffers(offers, CODING_PROFILE, 'quality'),
      CODING_PROFILE,
      'quality',
    );
    expect(best.explanation).toMatch(
      /It also had the highest coding quality score \(0\.9500\) among the 3 eligible offers\.$/,
    );
  });
});
