import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Wallet, decode, hashes } from 'xrpl';
import type { ExactPayment } from '@subbuddy/contracts';
import { PaymentError } from './errors.js';
import { XrplWalletSigner } from './signer.js';
import { ISSUER, RLUSD_HEX, SELLER, mockLedger } from './fixtures.test-helper.js';

const SEED_VAR = 'TEST_XRPL_SEED';
const wallet = Wallet.generate();

const exact: ExactPayment = {
  destination: SELLER,
  amount: '0.006200',
  asset: RLUSD_HEX,
  issuer: ISSUER,
  network: 'xrpl:1',
  invoiceId: 'inv-123',
};

beforeEach(() => {
  process.env[SEED_VAR] = wallet.seed;
});
afterEach(() => {
  delete process.env[SEED_VAR];
});

const signer = (ledger = mockLedger()) =>
  new XrplWalletSigner({ ledger: ledger.handle, network: 'xrpl:1', seedEnvVar: SEED_VAR });

describe('XrplWalletSigner (FR-070)', () => {
  it('builds an exact Payment with InvoiceID, SourceTag, bounded LastLedgerSequence, no partial flag, no Paths', async () => {
    const ledger = mockLedger({ validatedIndex: 5000 });
    const signed = await signer(ledger).signExactPayment(exact);
    const tx = decode(signed.signedTxBlob);

    expect(tx).toMatchObject({
      TransactionType: 'Payment',
      Account: wallet.classicAddress,
      Destination: SELLER,
      Amount: { currency: RLUSD_HEX, issuer: ISSUER, value: '0.0062' },
      InvoiceID: createHash('sha256').update('inv-123').digest('hex').toUpperCase(),
      SourceTag: 804681468,
      LastLedgerSequence: 5020,
      Sequence: 42,
    });
    expect(tx['Flags'] ?? 0).toBe(0);
    expect(tx).not.toHaveProperty('Paths');
    expect(signed).toMatchObject({
      payerAddress: wallet.classicAddress,
      sequence: 42,
      lastLedgerSequence: 5020,
    });
    expect(signed.transactionHash).toBe(hashes.hashSignedTx(signed.signedTxBlob));
  });

  it('signs XRP as a drops string without SendMax', async () => {
    const signed = await signer().signExactPayment({
      ...exact,
      asset: 'XRP',
      issuer: null,
      amount: '1000',
    });
    const tx = decode(signed.signedTxBlob);
    expect(tx['Amount']).toBe('1000');
    expect(tx).not.toHaveProperty('SendMax');
  });

  it('serialises concurrent signing (one autofill at a time, in order)', async () => {
    const ledger = mockLedger();
    let inFlight = 0;
    let maxInFlight = 0;
    ledger.autofill.mockImplementation(async (tx: Record<string, unknown>) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { ...tx, Sequence: 42, Fee: '12', NetworkID: undefined };
    });
    const s = signer(ledger);
    await Promise.all([
      s.signExactPayment(exact),
      s.signExactPayment({ ...exact, invoiceId: 'inv-2' }),
    ]);
    expect(maxInFlight).toBe(1);
  });

  it('stops before signing on insufficient balance (§14)', async () => {
    const ledger = mockLedger({ iouBalance: '0.001' });
    await expect(signer(ledger).signExactPayment(exact)).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
    });
    expect(ledger.autofill).not.toHaveBeenCalled();

    const xrp = mockLedger({ xrpBalanceDrops: '1200000', ownerCount: 1 }); // 1.2 XRP reserve
    await expect(
      xrp.handle &&
        signer(xrp).signExactPayment({ ...exact, asset: 'XRP', issuer: null, amount: '1' }),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
    });
  });

  it('stops when the seed is missing or the fields disagree with configuration (SEC-005)', async () => {
    const ledger = mockLedger();
    delete process.env[SEED_VAR];
    await expect(signer(ledger).signExactPayment(exact)).rejects.toMatchObject({
      code: 'SIGNER_UNAVAILABLE',
    });
    process.env[SEED_VAR] = wallet.seed;
    await expect(
      signer(ledger).signExactPayment({ ...exact, network: 'xrpl:2' }),
    ).rejects.toBeInstanceOf(PaymentError);
    await expect(signer(ledger).signExactPayment({ ...exact, amount: '0' })).rejects.toMatchObject({
      code: 'QUOTE_REJECTED',
    });
    await expect(signer(ledger).signExactPayment({ ...exact, issuer: null })).rejects.toMatchObject(
      { code: 'QUOTE_REJECTED' },
    );
    expect(ledger.autofill).not.toHaveBeenCalled();
  });

  it('never exposes the seed on the signer instance', async () => {
    const s = signer();
    expect(JSON.stringify(s)).not.toContain(wallet.seed as string);
    expect(await s.getAddress()).toBe(wallet.classicAddress);
  });
});
