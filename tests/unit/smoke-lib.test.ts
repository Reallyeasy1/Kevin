import { describe, expect, it, vi } from 'vitest';
import type { PaymentReceipt } from '../../packages/contracts/src/index.js';
import {
  compareReceiptToLedger,
  decimalLt,
  dropsToXrp,
  evidenceRows,
  fetchLedgerTx,
  fundingProblems,
  normalizeDecimal,
  parseArgs,
} from '../../scripts/smoke-lib.js';

const RLUSD_HEX = '524C555344000000000000000000000000000000';
const ISSUER = 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV';
const SELLER = 'rhaDe3NBxgUSLL12N5Sxpii2xy8vSyXNG6';
const HASH = 'E3FE6EA3D48F0C2B14E4B4F5C3A6B2D5E7F8091A2B3C4D5E6F708192A3B4C5D6';
const asset = { code: 'RLUSD', currencyHex: RLUSD_HEX, issuer: ISSUER } as const;

const receipt: PaymentReceipt = {
  status: 'SETTLED',
  payerAddress: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
  destination: SELLER,
  amount: '0.006200',
  assetCode: 'RLUSD',
  transactionHash: HASH,
  explorerUrl: `https://testnet.xrpl.org/transactions/${HASH}`,
  ledgerIndex: 1234,
  validatedAt: '2026-09-05T10:00:00.000Z',
  failureCode: null,
};

const txResponse = (over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
  result: {
    validated: true,
    ledger_index: 1234,
    meta: {
      TransactionResult: 'tesSUCCESS',
      delivered_amount: { value: '0.0062', currency: RLUSD_HEX, issuer: ISSUER },
      ...meta,
    },
    tx_json: { Destination: SELLER, InvoiceID: 'AB'.repeat(32), ...over },
  },
});

describe('parseArgs', () => {
  it('reads maxCost and flags', () => {
    const a = parseArgs(['0.020000', '--api', 'http://h:1/', '--prompt', 'hi']);
    expect(a).toMatchObject({ maxCost: '0.020000', apiBase: 'http://h:1', prompt: 'hi' });
  });
  it('rejects missing, zero, or non-decimal maxCost and unknown flags', () => {
    expect(() => parseArgs([])).toThrow(/usage/);
    expect(() => parseArgs(['0.000'])).toThrow(/usage/);
    expect(() => parseArgs(['1e-3'])).toThrow(/usage/);
    expect(() => parseArgs(['0.01', '--nope'])).toThrow(/unknown flag/);
  });
});

describe('decimal helpers', () => {
  it('normalise and convert without number arithmetic', () => {
    expect(normalizeDecimal('0.0200')).toBe('0.02');
    expect(normalizeDecimal('007')).toBe('7');
    expect(dropsToXrp('20000')).toBe('0.02');
    expect(dropsToXrp('1000000')).toBe('1');
    expect(dropsToXrp('123456789')).toBe('123.456789');
    expect(decimalLt('1.5', '2')).toBe(true);
    expect(decimalLt('2', '1.999999')).toBe(false);
    expect(decimalLt('0.020000', '0.02')).toBe(false);
  });
});

describe('fetchLedgerTx + compareReceiptToLedger (AT-011)', () => {
  it('matches a validated tesSUCCESS RLUSD payment', async () => {
    const request = vi.fn(async () => txResponse());
    const tx = await fetchLedgerTx({ request }, HASH);
    expect(request).toHaveBeenCalledWith({ command: 'tx', transaction: HASH });
    expect(tx.invoiceIdHash).toBe('AB'.repeat(32));
    expect(compareReceiptToLedger(receipt, tx, asset)).toEqual([]);
  });
  it('flags destination, amount, result, issuer and validation mismatches', async () => {
    const bad = await fetchLedgerTx(
      {
        request: async () =>
          txResponse(
            { Destination: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH' },
            {
              TransactionResult: 'tecPATH_DRY',
              delivered_amount: { value: '0.0061', currency: RLUSD_HEX, issuer: SELLER },
            },
          ),
      },
      HASH,
    );
    const errs = compareReceiptToLedger(receipt, bad, asset);
    expect(errs.join('\n')).toMatch(/destination/);
    expect(errs.join('\n')).toMatch(/amount/);
    expect(errs.join('\n')).toMatch(/tecPATH_DRY/);
    expect(errs.join('\n')).toMatch(/issuer/);

    const unvalidated = await fetchLedgerTx(
      { request: async () => ({ result: { ...txResponse().result, validated: false } }) },
      HASH,
    );
    expect(compareReceiptToLedger(receipt, unvalidated, asset)).toContain(
      'ledger: transaction is not in a validated ledger',
    );
  });
  it('compares XRP settlement in drops and rejects asset mix-ups', async () => {
    const xrpTx = await fetchLedgerTx(
      { request: async () => txResponse({}, { delivered_amount: '6200' }) },
      HASH,
    );
    const xrpReceipt = { ...receipt, amount: '0.006200', assetCode: 'XRP' as const };
    const xrpAsset = { code: 'XRP', currencyHex: null, issuer: null } as const;
    expect(compareReceiptToLedger(xrpReceipt, xrpTx, xrpAsset)).toEqual([]);
    expect(compareReceiptToLedger(receipt, xrpTx, asset)).toContain(
      'asset: ledger delivered XRP but receipt says RLUSD',
    );
  });
});

describe('fundingProblems', () => {
  const s = { address: 'rAgent', xrp: '25', rlusd: '5', issuer: ISSUER };
  it('passes a funded RLUSD wallet', () => {
    expect(fundingProblems(s, 'RLUSD', '0.02')).toEqual([]);
  });
  it('names the XRP faucet, the RLUSD faucet, and the trust line', () => {
    expect(fundingProblems({ ...s, xrp: '1.5' }, 'RLUSD', '0.02')[0]).toMatch(/faucet.altnet/);
    expect(fundingProblems({ ...s, rlusd: '0.01' }, 'RLUSD', '0.02')[0]).toMatch(/tryrlusd\.com/);
    expect(fundingProblems({ ...s, rlusd: null }, 'RLUSD', '0.02')[0]).toMatch(/trust line/);
    expect(fundingProblems({ ...s, xrp: '5' }, 'XRP', '10')[0]).toMatch(/maxCost 10/);
  });
});

describe('evidenceRows', () => {
  it('emits two EVIDENCE.md table rows', () => {
    const rows = evidenceRows({
      dateIso: '2026-09-05T10:00:00.000Z',
      routeId: 'route_1',
      invoiceIdHash: 'AB'.repeat(32),
      hash: HASH,
      ledgerIndex: 1234,
      amount: '0.006200',
      asset: 'RLUSD',
      explorerUrl: `https://testnet.xrpl.org/transactions/${HASH}`,
    }).split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('| 1 | 2026-09-05 10:00:00 UTC |');
    expect(rows[0]).toContain(HASH);
    expect(rows[0]).toContain('| 1234 | 0.006200 | RLUSD | `tesSUCCESS` |');
    expect(rows[1]).toContain('Duplicate execute (AT-005)');
  });
});
