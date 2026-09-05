import {
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  buildPaymentSignatureHeaderForSignedBlob,
  decodePaymentResponseHeader,
  paymentRequiredFromWire,
} from 'x402-xrpl';
import { Decimal } from 'decimal.js';
import type { Payment, TransactionMetadata, TxResponse } from 'xrpl';
import {
  SellerInferenceResponse,
  type CurrencyHex,
  type InferenceOffer,
  type LedgerRange,
  type PaidSellerResponse,
  type PayAndRetryInput,
  type PaymentClient,
  type PaymentRequirement,
  type PaymentResponseMeta,
  type ProviderRegistry,
  type SellerRequest,
  type SettlementAssetCode,
  type SettlementResult,
  type XrplAddress,
} from '@subbuddy/contracts';
import { PaymentError } from './errors.js';
import {
  asClient,
  assertNotMainnet,
  validatedLedgerIndex,
  withBackoff,
  type LedgerHandle,
} from './ledger.js';
import {
  DEFAULT_SOURCE_TAG,
  toRawRequirement,
  validateQuote,
  type ExpectedSettlement,
  type RawRequirement,
} from './quote.js';

export interface PaymentClientOptions {
  ledger: LedgerHandle;
  /** Offer lookup: payTo/asset/network/endpoint come from here, never from the caller (SEC-003, FR-051). */
  registry: ProviderRegistry;
  expected: ExpectedSettlement;
  fetchImpl?: typeof fetch;
  /** Outbound HTTP timeout (SEC-004). Default 30s for the quote, 120s for the paid request. */
  quoteTimeoutMs?: number;
  paidTimeoutMs?: number;
  /** Response body cap in bytes (SEC-004). Default 1 MiB. */
  maxResponseBytes?: number;
  /** FR-051 "not previously seen"; usually a DB lookup. */
  invoiceSeen?: (invoiceId: string) => Promise<boolean>;
  sourceTag?: number;
  /** Identical-blob resends on typed transient verify errors (INV-011). Default 2. */
  transientRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

type Body = { status: number; headers: Headers; json: unknown };

/** SEC-004: read at most `max` bytes; cancel the stream and throw past the cap instead of buffering it all. */
export async function readBodyCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new RangeError('response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Classify a ledger fact against the persisted LastLedgerSequence (§9.2). */
export function classifySettlement(
  result: SettlementResult,
  lastLedgerSequence: number,
): 'SETTLED' | 'VALIDATED_FAILED' | 'PENDING' {
  if (result.status === 'validated') return result.success ? 'SETTLED' : 'VALIDATED_FAILED';
  if (result.status === 'unknown') return 'PENDING';
  return result.currentLedgerIndex > lastLedgerSequence ? 'VALIDATED_FAILED' : 'PENDING';
}

/** Standard 3-char ISO code to its 160-bit hex form; passes 40-hex through. */
function currencyToHex(code: string): 'XRP' | string {
  if (code === 'XRP') return 'XRP';
  if (/^[0-9A-Fa-f]{40}$/.test(code)) return code.toUpperCase();
  return Buffer.from(code, 'ascii').toString('hex').toUpperCase().padStart(30, '0').padEnd(40, '0');
}

export class X402PaymentClient implements PaymentClient {
  private readonly opts: Required<Omit<PaymentClientOptions, 'invoiceSeen'>> &
    Pick<PaymentClientOptions, 'invoiceSeen'>;

  constructor(opts: PaymentClientOptions) {
    assertNotMainnet(opts.expected.network);
    this.opts = {
      fetchImpl: fetch,
      quoteTimeoutMs: 30_000,
      paidTimeoutMs: 120_000,
      maxResponseBytes: 1024 * 1024,
      sourceTag: DEFAULT_SOURCE_TAG,
      transientRetries: 2,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => new Date(),
      ...opts,
    };
  }

  /** SEC-003: the endpoint must be the registry's endpoint for this offer. */
  private async allowedOffer(request: SellerRequest): Promise<InferenceOffer> {
    const offer = (await this.opts.registry.listActiveOffers()).find(
      (o) => o.offerId === request.offerId,
    );
    if (!offer || offer.endpoint !== request.endpoint || !offer.enabled)
      throw new PaymentError('ENDPOINT_NOT_ALLOWED', 'seller endpoint is not in the registry');
    return offer;
  }

  private async post(
    request: SellerRequest,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<Body> {
    const body = JSON.stringify({
      requestId: request.requestId,
      prompt: request.prompt,
      ...(request.maxOutputTokens !== undefined
        ? { maxOutputTokens: request.maxOutputTokens }
        : {}),
    });
    const res = await this.opts.fetchImpl(request.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let text: string;
    try {
      text = await readBodyCapped(res, this.opts.maxResponseBytes);
    } catch (err) {
      if (err instanceof RangeError)
        throw new PaymentError('SELLER_MISCONFIGURED', 'seller response too large');
      throw err;
    }
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, json };
  }

  // FR-050 / FR-051
  async obtainRequirement(request: SellerRequest): Promise<PaymentRequirement> {
    const offer = await this.allowedOffer(request);
    let res: Body;
    try {
      res = await this.post(request, {}, this.opts.quoteTimeoutMs);
    } catch (cause) {
      if (cause instanceof PaymentError) throw cause; // e.g. oversized body (SEC-004)
      throw new PaymentError('SELLER_UNAVAILABLE', 'seller did not respond', {
        retryable: true,
        cause,
      });
    }
    const receivedAt = this.opts.now();
    if (res.status >= 500)
      throw new PaymentError('SELLER_UNAVAILABLE', 'seller error', { retryable: true });
    if (res.status !== 402)
      throw new PaymentError(
        'SELLER_MISCONFIGURED',
        `seller answered ${res.status} instead of 402 before payment`,
      );

    let accepts: RawRequirement[];
    let resource: string | undefined;
    try {
      const required = paymentRequiredFromWire(res.json);
      accepts = required.accepts;
      resource = required.resource.url;
    } catch {
      throw new PaymentError('QUOTE_REJECTED', 'malformed payment requirement');
    }

    const exact = accepts.filter((a) => a.scheme === 'exact');
    if (exact.length === 0) throw new PaymentError('QUOTE_REJECTED', 'unsupported payment scheme');
    let firstError: PaymentError | undefined;
    for (const raw of exact) {
      try {
        const invoiceId =
          typeof raw.extra?.['invoiceId'] === 'string' ? raw.extra['invoiceId'] : '';
        const invoiceSeen =
          invoiceId && this.opts.invoiceSeen ? await this.opts.invoiceSeen(invoiceId) : false;
        return validateQuote(raw, {
          offer,
          expected: this.opts.expected,
          resource,
          receivedAt,
          now: receivedAt,
          invoiceSeen,
        });
      } catch (err) {
        if (!(err instanceof PaymentError)) throw err;
        firstError ??= err;
      }
    }
    throw firstError as PaymentError;
  }

  // FR-070 / FR-071: resend the identical blob only; never sign here.
  async payAndRetry(input: PayAndRetryInput): Promise<PaidSellerResponse> {
    const { request, requirement, signed } = input;
    await this.allowedOffer(request);
    const hash = signed.transactionHash;
    const header = buildPaymentSignatureHeaderForSignedBlob({
      req: toRawRequirement(requirement, this.opts.sourceTag),
      signedTxBlob: signed.signedTxBlob,
      invoiceId: requirement.invoiceId,
    });

    for (let attempt = 0; ; attempt++) {
      let res: Body;
      try {
        res = await this.post(
          request,
          { [HEADER_PAYMENT_SIGNATURE]: header },
          this.opts.paidTimeoutMs,
        );
      } catch (cause) {
        // Lost response: the seller may have submitted. Resolve by hash (AT-006).
        throw new PaymentError('OUTCOME_UNKNOWN', 'paid request response lost', {
          transactionHash: hash,
          cause,
        });
      }

      if (res.status === 200) {
        const parsed = SellerInferenceResponse.safeParse(res.json);
        if (!parsed.success)
          throw new PaymentError('PAID_EXECUTION_FAILED', 'seller returned a malformed response', {
            transactionHash: hash,
          });
        if (parsed.data.requestId !== request.requestId || parsed.data.offerId !== request.offerId)
          throw new PaymentError(
            'PAID_EXECUTION_FAILED',
            'seller response does not match request',
            { transactionHash: hash },
          );
        return { result: parsed.data, paymentResponse: this.parsePaymentResponse(res.headers) };
      }

      const body = (res.json ?? {}) as Record<string, unknown>;
      const transientVerify =
        res.status === 503 && body['retryable'] === true && body['settlementAttempted'] === false;
      if (transientVerify && attempt < this.opts.transientRetries) {
        const retryAfter =
          typeof body['retryAfter'] === 'number' ? body['retryAfter'] * 1000 : 1000;
        await this.opts.sleep(Math.min(retryAfter, 5_000) * 2 ** attempt);
        continue;
      }
      if (res.status === 402 || res.status === 400)
        // Seller/facilitator rejected the paid request. Caller still checks the hash on ledger (§14).
        throw new PaymentError('PAYMENT_FAILED', 'payment was not accepted', {
          transactionHash: hash,
        });
      // 5xx (verify/settle upstream error, settlement_status_unknown): only the ledger can say what happened.
      throw new PaymentError('OUTCOME_UNKNOWN', 'payment outcome unknown', {
        transactionHash: hash,
      });
    }
  }

  private parsePaymentResponse(headers: Headers): PaymentResponseMeta | null {
    const raw = headers.get(HEADER_PAYMENT_RESPONSE);
    if (!raw) return null;
    try {
      const s = decodePaymentResponseHeader(raw);
      return {
        success: s.success,
        transactionHash: s.transaction || null,
        network: s.network,
        payer: (s.payer as XrplAddress | null | undefined) || null,
      };
    } catch {
      return null;
    }
  }

  // FR-072 / INV-009: SETTLED only on validated tesSUCCESS.
  async resolveTransaction(hash: string, range?: LedgerRange): Promise<SettlementResult> {
    const client = await asClient(this.opts.ledger);
    type NotFound = { data?: { error?: string; searched_all?: boolean } };
    const isNotFound = (err: unknown): err is NotFound =>
      typeof err === 'object' && err !== null && (err as NotFound).data?.error === 'txnNotFound';

    let tx: TxResponse<Payment> | null;
    try {
      tx = await withBackoff(
        () =>
          client.request({
            command: 'tx',
            transaction: hash,
            ...(range ? { min_ledger: range.minLedger, max_ledger: range.maxLedger } : {}),
          }) as Promise<TxResponse<Payment>>,
        {
          retryOn: (err) => !isNotFound(err),
        },
      );
    } catch (err) {
      if (!isNotFound(err)) throw err;
      // With a range, rippled reports whether it searched every ledger in it. A node lacking history
      // must not turn a live payment into VALIDATED_FAILED (INV-009).
      if (range && err.data?.searched_all === false)
        return { status: 'unknown', transactionHash: hash };
      tx = null;
    }

    if (!tx || tx.result.validated !== true) {
      return {
        status: 'not_found',
        transactionHash: hash,
        currentLedgerIndex: await withBackoff(() => validatedLedgerIndex(client)),
      };
    }
    const meta = tx.result.meta as TransactionMetadata<Payment> | undefined;
    const resultCode = typeof meta === 'object' && meta ? meta.TransactionResult : 'unknown';
    const delivered =
      (typeof meta === 'object' && meta?.delivered_amount) || tx.result.tx_json.Amount;
    const amount =
      typeof delivered === 'string' ? delivered : 'value' in delivered ? delivered.value : '0';
    const asset =
      typeof delivered === 'string'
        ? 'XRP'
        : 'currency' in delivered
          ? currencyToHex(delivered.currency)
          : 'XRP';
    return {
      status: 'validated',
      transactionHash: hash,
      success: resultCode === 'tesSUCCESS',
      resultCode,
      ledgerIndex: tx.result.ledger_index ?? 0,
      validatedAt: tx.result.close_time_iso ?? new Date().toISOString(),
      destination: tx.result.tx_json.Destination as XrplAddress,
      amount,
      asset: asset as 'XRP' | CurrencyHex,
    };
  }

  /** §11.7 / FR-060: XRP and the configured IOU balance in asset units, 6 dp. Reads only; never the seed. */
  async getBalances(address: string): Promise<{ asset: SettlementAssetCode; amount: string }[]> {
    const client = await asClient(this.opts.ledger);
    const { issuer, currencyHex } = this.opts.expected;
    const [info, lines] = await withBackoff(() =>
      Promise.all([
        client.request({ command: 'account_info', account: address, ledger_index: 'validated' }),
        client.request({
          command: 'account_lines',
          account: address,
          peer: issuer,
          ledger_index: 'validated',
        }),
      ]),
    );
    const line = lines.result.lines.find((l) => l.currency.toUpperCase() === currencyHex);
    return [
      { asset: 'RLUSD', amount: new Decimal(line?.balance ?? '0').toFixed(6) },
      {
        asset: 'XRP',
        amount: new Decimal(info.result.account_data.Balance).div(1_000_000).toFixed(6),
      },
    ];
  }
}
