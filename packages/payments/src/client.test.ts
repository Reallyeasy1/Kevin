import { describe, expect, it, vi } from 'vitest';
import type { PayAndRetryInput, SellerRequest } from '@subbuddy/contracts';
import { X402PaymentClient, classifySettlement } from './client.js';
import { validateQuote } from './quote.js';
import {
  ISSUER,
  RLUSD_HEX,
  SELLER,
  expected,
  mockLedger,
  offer,
  rawRequirement,
} from './fixtures.test-helper.js';

const request: SellerRequest = {
  offerId: offer.offerId,
  endpoint: offer.endpoint,
  requestId: 'req-1',
  prompt: 'hello',
  promptHash: 'a'.repeat(64),
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const paymentRequired = (accepts = [rawRequirement()]) => ({
  x402Version: 2,
  resource: { url: offer.endpoint },
  accepts,
  error: 'PAYMENT-SIGNATURE header is required',
});

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');

const client = (fetchImpl: typeof fetch, ledger = mockLedger()) =>
  new X402PaymentClient({
    ledger: ledger.handle,
    registry: { listActiveOffers: async () => [offer], registryVersion: 'test' },
    expected,
    fetchImpl,
    sleep: async () => undefined,
  });

const requirement = validateQuote(rawRequirement(), {
  offer,
  expected,
  resource: offer.endpoint,
  receivedAt: new Date(),
});
const paid: PayAndRetryInput = {
  request,
  requirement,
  signed: {
    signedTxBlob: 'DEADBEEF',
    transactionHash: 'F'.repeat(64),
    payerAddress: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
    sequence: 42,
    lastLedgerSequence: 5020,
  },
};

describe('obtainRequirement (FR-050)', () => {
  it('sends the request once, expects 402 and returns the validated requirement', async () => {
    const fetchImpl = vi.fn(async () => json(402, paymentRequired()));
    const req = await client(fetchImpl as unknown as typeof fetch).obtainRequirement(request);
    expect(req).toMatchObject({
      payTo: SELLER,
      amount: '0.006200',
      invoiceId: 'inv-123',
      asset: RLUSD_HEX,
      issuer: ISSUER,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ requestId: 'req-1', prompt: 'hello' });
    expect(init.headers).not.toHaveProperty('PAYMENT-SIGNATURE');
  });

  it('aborts a streamed body past maxResponseBytes before buffering it (SEC-004)', async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const small = new X402PaymentClient({
      ledger: mockLedger().handle,
      registry: { listActiveOffers: async () => [offer], registryVersion: 'test' },
      expected,
      fetchImpl: async () => new Response(stream, { status: 402 }),
      maxResponseBytes: 4096,
    });
    await expect(small.obtainRequirement(request)).rejects.toMatchObject({
      code: 'SELLER_MISCONFIGURED',
    });
    expect(pulls).toBeLessThan(10);
  });

  it('treats 200 before payment as seller misconfiguration', async () => {
    await expect(
      client(async () => json(200, { ok: true })).obtainRequirement(request),
    ).rejects.toMatchObject({
      code: 'SELLER_MISCONFIGURED',
    });
  });

  it('refuses endpoints that are not the registry endpoint for the offer (SEC-003)', async () => {
    const fetchImpl = vi.fn();
    await expect(
      client(fetchImpl as unknown as typeof fetch).obtainRequirement({
        ...request,
        endpoint: 'http://evil.example/x',
      }),
    ).rejects.toMatchObject({ code: 'ENDPOINT_NOT_ALLOWED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects when no accepts entry passes validation, with the safe reason', async () => {
    await expect(
      client(async () =>
        json(402, paymentRequired([rawRequirement({ payTo: paid.signed.payerAddress })])),
      ).obtainRequirement(request),
    ).rejects.toMatchObject({
      code: 'QUOTE_REJECTED',
      publicReason: 'destination does not match registry',
    });
  });
});

describe('payAndRetry (FR-070/071)', () => {
  const okBody = {
    requestId: 'req-1',
    offerId: offer.offerId,
    modelId: 'model-x',
    content: 'hi',
    usage: { inputTokens: 1, outputTokens: 1 },
    providerLatencyMs: 10,
  };

  it('INV-011: a transient verify error resends the identical PAYMENT-SIGNATURE and never re-signs', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json(503, { retryable: true, phase: 'verify', settlementAttempted: false, retryAfter: 1 }),
      )
      .mockResolvedValueOnce(
        json(200, okBody, {
          'PAYMENT-RESPONSE': b64({
            success: true,
            transaction: paid.signed.transactionHash,
            network: 'xrpl:1',
            payer: paid.signed.payerAddress,
          }),
        }),
      );
    const out = await client(fetchImpl as unknown as typeof fetch).payAndRetry(paid);
    expect(out.result.content).toBe('hi');
    expect(out.paymentResponse).toEqual({
      success: true,
      transactionHash: paid.signed.transactionHash,
      network: 'xrpl:1',
      payer: paid.signed.payerAddress,
    });
    const headers = fetchImpl.mock.calls.map(
      (c) => (c as unknown as [string, RequestInit])[1].headers as Record<string, string>,
    );
    expect(headers).toHaveLength(2);
    expect(headers[0]?.['PAYMENT-SIGNATURE']).toBe(headers[1]?.['PAYMENT-SIGNATURE']);
    const sent = JSON.parse(
      Buffer.from(headers[0]?.['PAYMENT-SIGNATURE'] as string, 'base64').toString(),
    );
    expect(sent).toMatchObject({
      x402Version: 2,
      accepted: {
        scheme: 'exact',
        network: 'xrpl:1',
        asset: RLUSD_HEX,
        payTo: SELLER,
        amount: '0.006200',
        extra: { invoiceId: 'inv-123', issuer: ISSUER },
      },
      payload: { signedTxBlob: 'DEADBEEF', invoiceId: 'inv-123' },
    });
  });

  it('AT-006: a lost response yields OUTCOME_UNKNOWN carrying the known hash', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('timeout', 'TimeoutError');
    });
    await expect(
      client(fetchImpl as unknown as typeof fetch).payAndRetry(paid),
    ).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
      transactionHash: paid.signed.transactionHash,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a rejected paid request is PAYMENT_FAILED but still carries the hash for ledger resolution', async () => {
    await expect(
      client(async () => json(402, paymentRequired())).payAndRetry(paid),
    ).rejects.toMatchObject({
      code: 'PAYMENT_FAILED',
      transactionHash: paid.signed.transactionHash,
    });
  });
});

describe('getBalances (§11.7)', () => {
  it('reads XRP and the configured IOU in asset units, 6 dp', async () => {
    const ledger = mockLedger({ xrpBalanceDrops: '12345678', iouBalance: '5' });
    await expect(client(fetch, ledger).getBalances(SELLER)).resolves.toEqual([
      { asset: 'RLUSD', amount: '5.000000' },
      { asset: 'XRP', amount: '12.345678' },
    ]);
  });
});

describe('resolveTransaction (FR-072, INV-009)', () => {
  const txResult = (TransactionResult: string, validated = true) => ({
    result: {
      hash: paid.signed.transactionHash,
      validated,
      ledger_index: 5010,
      close_time_iso: '2026-09-05T10:00:05Z',
      meta: {
        TransactionResult,
        delivered_amount: { currency: RLUSD_HEX, issuer: ISSUER, value: '0.0062' },
      },
      tx_json: {
        TransactionType: 'Payment',
        Destination: SELLER,
        Amount: { currency: RLUSD_HEX, issuer: ISSUER, value: '0.0062' },
      },
    },
  });

  it('settles only on a validated tesSUCCESS', async () => {
    const ok = await client(fetch, mockLedger({ tx: txResult('tesSUCCESS') })).resolveTransaction(
      paid.signed.transactionHash,
    );
    expect(ok).toMatchObject({
      status: 'validated',
      success: true,
      ledgerIndex: 5010,
      destination: SELLER,
      amount: '0.0062',
      asset: RLUSD_HEX,
    });
    expect(classifySettlement(ok, 5020)).toBe('SETTLED');

    const failed = await client(
      fetch,
      mockLedger({ tx: txResult('tecPATH_DRY') }),
    ).resolveTransaction(paid.signed.transactionHash);
    expect(failed).toMatchObject({
      status: 'validated',
      success: false,
      resultCode: 'tecPATH_DRY',
    });
    expect(classifySettlement(failed, 5020)).toBe('VALIDATED_FAILED');

    const pending = await client(
      fetch,
      mockLedger({ tx: txResult('tesSUCCESS', false), validatedIndex: 5015 }),
    ).resolveTransaction(paid.signed.transactionHash);
    expect(pending).toEqual({
      status: 'not_found',
      transactionHash: paid.signed.transactionHash,
      currentLedgerIndex: 5015,
    });
    expect(classifySettlement(pending, 5020)).toBe('PENDING');
  });

  it('passes the ledger range and reports "unknown" when the node did not search it all', async () => {
    const range = { minLedger: 5000, maxLedger: 5020 };
    const partial = mockLedger({ validatedIndex: 5030, searchedAll: false });
    const unknown = await client(fetch, partial).resolveTransaction(
      paid.signed.transactionHash,
      range,
    );
    expect(unknown).toEqual({ status: 'unknown', transactionHash: paid.signed.transactionHash });
    expect(classifySettlement(unknown, 5020)).toBe('PENDING');
    expect(partial.request).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'tx', min_ledger: 5000, max_ledger: 5020 }),
    );

    const full = mockLedger({ validatedIndex: 5030, searchedAll: true });
    const gone = await client(fetch, full).resolveTransaction(paid.signed.transactionHash, range);
    expect(gone).toMatchObject({ status: 'not_found', currentLedgerIndex: 5030 });
    expect(classifySettlement(gone, 5020)).toBe('VALIDATED_FAILED');
  });

  it('not found past LastLedgerSequence is a failed payment; before it is pending', async () => {
    const gone = await client(fetch, mockLedger({ validatedIndex: 5021 })).resolveTransaction(
      paid.signed.transactionHash,
    );
    expect(gone).toEqual({
      status: 'not_found',
      transactionHash: paid.signed.transactionHash,
      currentLedgerIndex: 5021,
    });
    expect(classifySettlement(gone, 5020)).toBe('VALIDATED_FAILED');
    expect(
      classifySettlement(
        {
          status: 'not_found',
          transactionHash: paid.signed.transactionHash,
          currentLedgerIndex: 5019,
        },
        5020,
      ),
    ).toBe('PENDING');
  });
});
