/**
 * NFR-005 / INV-010: identical routing input + registry version yields identical rank (PRD §16, §9.3). Issue #80.
 * The snapshot pins the candidate ordering and scores per mode; a change to scoring or the seed must update it
 * deliberately. Uses the fake PaymentClient so no quote walk perturbs the ordering.
 */
import { describe, expect, it } from 'vitest';
import { ROUTING_MODES } from '../../packages/contracts/src/index.js';
import { CuratedRegistry, buildCuratedOffers } from '../../packages/config/src/index.js';
import { sharedEnv } from '../fakes/env.js';
import { createHarness } from '../fakes/harness.js';

type Cand = {
  offerId: string;
  eligibility: string;
  finalScore: string | null;
  rejectionReasons: string[];
};
const rank = (candidates: Cand[]) =>
  candidates.map((c) => ({
    offerId: c.offerId,
    eligibility: c.eligibility,
    finalScore: c.finalScore,
    rejectionReasons: c.rejectionReasons,
  }));

const PROMPTS = {
  coding: 'Implement Dijkstra in typescript and explain its complexity.',
  math: 'Prove that the sum of the first n odd numbers equals n^2.',
  summary: 'Summarize the key points of this meeting transcript.',
  chat: 'What should I cook tonight?',
} as const;

describe('NFR-005: Deterministic candidate ranking', () => {
  it('snapshot: candidate order and scores per prompt class and mode', async () => {
    const h = await createHarness({ payments: 'fake' });
    const out: Record<string, ReturnType<typeof rank>> = {};
    for (const [label, prompt] of Object.entries(PROMPTS))
      for (const mode of ROUTING_MODES) {
        const res = await h.route({ prompt, mode });
        expect(res.statusCode).toBe(201);
        out[`${label}/${mode}`] = rank(res.json().candidates);
      }
    expect(out).toMatchSnapshot();
  });

  it('two processes with the same registry produce the same registryVersion and identical ordering', async () => {
    const a = await createHarness({ payments: 'fake' });
    const b = await createHarness({ payments: 'fake' });
    // registryVersion hashes the offer set (endpoints included), so two registries from one env must agree.
    const env = sharedEnv(a.seller.url);
    const va = new CuratedRegistry(buildCuratedOffers(env)).registryVersion;
    const vb = new CuratedRegistry(buildCuratedOffers(env)).registryVersion;
    expect(va).toBe(vb);
    expect(va).toBe(a.registry.registryVersion);
    for (const mode of ROUTING_MODES) {
      const ra = rank((await a.route({ mode })).json().candidates);
      const rb = rank((await b.route({ mode })).json().candidates);
      const ra2 = rank((await a.route({ mode })).json().candidates); // same process, second time
      expect(rb).toEqual(ra);
      expect(ra2).toEqual(ra);
    }
  });

  it('mode guarantees hold on the seed: cheapest picks the lowest price, fastest the lowest p50 among eligible', async () => {
    const h = await createHarness({ payments: 'fake' });
    const cheapest = (await h.route({ mode: 'cheapest' })).json();
    const fastest = (await h.route({ mode: 'fastest' })).json();
    const eligible = (await h.registry.listActiveOffers()).filter((o) =>
      o.capabilities.includes('coding'),
    );
    const minPrice = eligible.reduce((m, o) => (o.advertisedPrice < m.advertisedPrice ? o : m));
    const minLatency = eligible.reduce((m, o) => (o.p50LatencyMs < m.p50LatencyMs ? o : m));
    expect(cheapest.selected.offerId).toBe(minPrice.offerId);
    expect(fastest.selected.offerId).toBe(minLatency.offerId);
  });
});
