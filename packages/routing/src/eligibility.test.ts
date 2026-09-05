import { describe, expect, it } from 'vitest';
import { type EligibilityContext, filterEligible, rejectionReasons } from './eligibility.js';
import { CODING_PROFILE, NETWORK, makeOffer } from './fixtures.js';

const ctx: EligibilityContext = {
  profile: CODING_PROFILE,
  maxCost: '0.020000',
  network: NETWORK,
  asset: 'RLUSD',
};

describe('filterEligible (FR-030)', () => {
  it('keeps a matching offer with no reasons', () => {
    expect(rejectionReasons(makeOffer({ offerId: 'ok' }), ctx)).toEqual([]);
  });

  it('emits one machine-readable reason per failed condition', () => {
    const cases: [Parameters<typeof makeOffer>[0], string][] = [
      [{ offerId: 'a', enabled: false }, 'OFFER_DISABLED'],
      [{ offerId: 'b', capabilities: ['summarization'] }, 'CAPABILITY_MISSING'],
      [{ offerId: 'c', contextWindow: 2048 }, 'CONTEXT_WINDOW_TOO_SMALL'],
      [{ offerId: 'd', network: 'xrpl:0' }, 'NETWORK_MISMATCH'],
      [
        { offerId: 'e', asset: { code: 'XRP', currencyHex: null, issuer: null, decimals: 6 } },
        'ASSET_MISMATCH',
      ],
      [{ offerId: 'f', advertisedPrice: '0.020001' }, 'ESTIMATED_COST_EXCEEDS_MAX'],
    ];
    for (const [over, reason] of cases) {
      expect(rejectionReasons(makeOffer(over), ctx)).toEqual([reason]);
    }
  });

  it('tool calling and allowlists', () => {
    const tools = { ...ctx, profile: { ...CODING_PROFILE, toolCallingRequired: true } };
    expect(rejectionReasons(makeOffer({ offerId: 'a' }), tools)).toEqual([
      'TOOL_CALLING_UNSUPPORTED',
    ]);
    expect(rejectionReasons(makeOffer({ offerId: 'a', supportsTools: true }), tools)).toEqual([]);

    const allow = {
      ...ctx,
      allowedSellerIds: new Set(['seller-a']),
      allowedPayTo: new Set(['rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe']),
    };
    expect(rejectionReasons(makeOffer({ offerId: 'a' }), allow)).toEqual([]);
    expect(
      rejectionReasons(
        makeOffer({ offerId: 'b', payTo: 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV' }),
        allow,
      ),
    ).toEqual(['SELLER_NOT_ALLOWLISTED', 'DESTINATION_NOT_ALLOWLISTED']);
  });

  it('compares cost as decimals, not floats, and accumulates several reasons', () => {
    // 0.1 + 0.2 style trap: price equal to maxCost is allowed; a hair above is not.
    expect(rejectionReasons(makeOffer({ offerId: 'a', advertisedPrice: '0.02' }), ctx)).toEqual([]);
    const r = filterEligible(
      [
        makeOffer({ offerId: 'ok' }),
        makeOffer({
          offerId: 'bad',
          enabled: false,
          advertisedPrice: '0.3',
          capabilities: ['extraction'],
        }),
      ],
      ctx,
    );
    expect(r.eligible.map((o) => o.offerId)).toEqual(['ok']);
    expect(r.rejected).toEqual([
      {
        offer: expect.objectContaining({ offerId: 'bad' }),
        reasons: ['OFFER_DISABLED', 'CAPABILITY_MISSING', 'ESTIMATED_COST_EXCEEDS_MAX'],
      },
    ]);
  });
});
