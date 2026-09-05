import { describe, expect, it } from 'vitest';
import { PaymentError } from './errors.js';
import {
  assertExactMatchesRequirement,
  toExactPayment,
  validateQuote,
  type ValidateQuoteContext,
} from './quote.js';
import { OTHER, expected, offer, rawRequirement } from './fixtures.test-helper.js';

const receivedAt = new Date('2026-09-05T10:00:00Z');
const ctx = (over: Partial<ValidateQuoteContext> = {}): ValidateQuoteContext => ({
  offer,
  expected,
  resource: offer.endpoint,
  receivedAt,
  now: receivedAt,
  ...over,
});

const rejects = (fn: () => unknown, reason: string) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(PaymentError);
    expect((err as PaymentError).code).toBe('QUOTE_REJECTED');
    expect((err as PaymentError).publicReason).toBe(reason);
    return;
  }
  throw new Error('expected rejection');
};

describe('validateQuote (FR-051)', () => {
  it('accepts a matching RLUSD requirement and binds invoice, expiry and hash', () => {
    const req = validateQuote(rawRequirement(), ctx({ maxCost: '0.020000' }));
    expect(req).toMatchObject({
      scheme: 'exact',
      network: 'xrpl:1',
      asset: expected.currencyHex,
      issuer: expected.issuer,
      payTo: offer.payTo,
      amount: '0.006200',
      invoiceId: 'inv-123',
      resource: offer.endpoint,
      expiresAt: '2026-09-05T10:01:00.000Z',
    });
    expect(req.requirementHash).toMatch(/^[0-9a-f]{64}$/);
    expect(validateQuote(rawRequirement(), ctx()).requirementHash).toBe(req.requirementHash);
  });

  it('AT-003: rejects a quote above maxCost without touching the amount', () => {
    rejects(
      () => validateQuote(rawRequirement({ amount: '0.021000' }), ctx({ maxCost: '0.020000' })),
      'quote exceeds budget',
    );
  });

  it('AT-004: rejects a destination that differs from the registry', () => {
    rejects(
      () => validateQuote(rawRequirement({ payTo: OTHER }), ctx()),
      'destination does not match registry',
    );
  });

  it.each([
    [rawRequirement({ scheme: 'upto' }), {}, 'unsupported payment scheme'],
    [rawRequirement({ network: 'xrpl:0' }), {}, 'network mismatch'],
    [rawRequirement({ asset: 'USD' }), {}, 'asset not supported'],
    [rawRequirement({}, { issuer: OTHER }), {}, 'issuer mismatch'],
    [rawRequirement({}, { invoiceId: undefined }), {}, 'invoice id missing'],
    [rawRequirement(), { invoiceSeen: true }, 'invoice id already used'],
    [rawRequirement(), { resource: undefined }, 'resource binding missing'],
    [rawRequirement({ amount: '0' }), {}, 'amount must be positive'],
    [rawRequirement({ amount: '1e3' }), {}, 'invalid amount'],
    [rawRequirement({ amount: '-1' }), {}, 'invalid amount'],
    [rawRequirement(), { now: new Date(receivedAt.getTime() + 61_000) }, 'quote expired'],
    [rawRequirement({}, { crossCurrency: true }), {}, 'partial or path payments not supported'],
  ] as const)('rejects %o with "%s"', (raw, over, reason) => {
    rejects(() => validateQuote(raw, ctx(over as Partial<ValidateQuoteContext>)), reason);
  });

  it('requires whole drops for XRP and no issuer', () => {
    const xrpOffer = {
      ...offer,
      asset: { code: 'XRP' as const, currencyHex: null, issuer: null, decimals: 6 },
    };
    const xrp = rawRequirement({ asset: 'XRP', amount: '1000' }, { issuer: undefined });
    expect(validateQuote(xrp, ctx({ offer: xrpOffer })).issuer).toBeNull();
    rejects(
      () => validateQuote({ ...xrp, amount: '1000.5' }, ctx({ offer: xrpOffer })),
      'XRP amount must be whole drops',
    );
    rejects(
      () =>
        validateQuote(rawRequirement({ asset: 'XRP', amount: '1000' }), ctx({ offer: xrpOffer })),
      'issuer not allowed for XRP',
    );
  });
});

describe('assertExactMatchesRequirement (SEC-005)', () => {
  const req = validateQuote(
    rawRequirement(),
    ctx({ now: new Date(Date.now() - 1000), receivedAt: new Date() }),
  );
  it('passes for the derived exact payment', () => {
    expect(() => assertExactMatchesRequirement(toExactPayment(req), req)).not.toThrow();
  });
  it('rejects any mutated field', () => {
    rejects(
      () => assertExactMatchesRequirement({ ...toExactPayment(req), destination: OTHER }, req),
      'destination changed since quote',
    );
    rejects(
      () => assertExactMatchesRequirement({ ...toExactPayment(req), amount: '0.006201' }, req),
      'amount changed since quote',
    );
  });
});
