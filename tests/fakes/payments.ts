/**
 * Fake WalletSigner (records every sign call; INV-011 assertions count them) and a fake PaymentClient for
 * tests where the HTTP hop is not the point (NFR-001, NFR-005). Both speak only contracts types.
 */
import type {
  ExactPayment,
  PaidSellerResponse,
  PaymentClient,
  PaymentRequirement,
  SellerRequest,
  SettlementResult,
  SignedPayment,
  WalletSigner,
} from '../../packages/contracts/src/index.js';
import type { CuratedRegistry } from '../../packages/config/src/index.js';
import { ISSUER, RLUSD_HEX, SELLER, WALLET, fakeTxHash } from './env.js';
import type { FakeLedger } from './ledger.js';

export interface FakeSigner {
  signer: WalletSigner;
  /** Every ExactPayment handed to the signer, in order. */
  calls: ExactPayment[];
  signed: SignedPayment[];
}

export function createFakeSigner(ledger: FakeLedger): FakeSigner {
  const calls: ExactPayment[] = [];
  const signed: SignedPayment[] = [];
  const signer: WalletSigner = {
    getAddress: async () => WALLET,
    signExactPayment: async (exact) => {
      calls.push({ ...exact });
      const sequence = calls.length;
      const signedTxBlob = `FAKEBLOB-${sequence}-${exact.invoiceId}`;
      const out: SignedPayment = {
        signedTxBlob,
        transactionHash: fakeTxHash(signedTxBlob),
        payerAddress: WALLET,
        sequence,
        lastLedgerSequence: ledger.validatedIndex + 20,
      };
      signed.push(out);
      return out;
    },
  };
  return { signer, calls, signed };
}

export interface FakePaymentClient extends PaymentClient {
  quotes: SellerRequest[];
  paid: SellerRequest[];
}

/** No HTTP: quotes the registry price, "pays" instantly, settles in the fake ledger. */
export function createFakePaymentClient(
  registry: CuratedRegistry,
  ledger: FakeLedger,
): FakePaymentClient {
  const quotes: SellerRequest[] = [];
  const paid: SellerRequest[] = [];
  return {
    quotes,
    paid,
    async obtainRequirement(request: SellerRequest): Promise<PaymentRequirement> {
      quotes.push(request);
      const offer = registry.getOffer(request.offerId);
      if (!offer) throw new Error(`fake payments: unknown offer ${request.offerId}`);
      return {
        scheme: 'exact',
        network: 'xrpl:1',
        asset: RLUSD_HEX,
        issuer: ISSUER,
        payTo: SELLER,
        amount: offer.advertisedPrice,
        invoiceId: `inv-${request.offerId}-${request.requestId}`,
        resource: request.endpoint,
        maxTimeoutSeconds: 600,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        requirementHash: 'a'.repeat(64),
      };
    },
    async payAndRetry({ request, requirement, signed }): Promise<PaidSellerResponse> {
      paid.push(request);
      const offer = registry.getOffer(request.offerId);
      ledger.settle(signed.transactionHash, {
        destination: requirement.payTo,
        amount: requirement.amount,
        asset: requirement.asset,
      });
      return {
        result: {
          requestId: request.requestId,
          offerId: request.offerId,
          modelId: offer?.modelId ?? 'demo/unknown',
          content: 'canned answer',
          usage: { inputTokens: 20, outputTokens: 40 },
          providerLatencyMs: 900,
        },
        paymentResponse: {
          success: true,
          transactionHash: signed.transactionHash,
          network: 'xrpl:1',
          payer: WALLET,
        },
      };
    },
    async resolveTransaction(hash: string): Promise<SettlementResult> {
      const fact = ledger.txs.get(hash);
      if (!fact)
        return {
          status: 'not_found',
          transactionHash: hash,
          currentLedgerIndex: ledger.validatedIndex,
        };
      return {
        status: 'validated',
        transactionHash: hash,
        success: fact.resultCode === 'tesSUCCESS',
        resultCode: fact.resultCode,
        ledgerIndex: fact.ledgerIndex,
        validatedAt: fact.validatedAt,
        destination: fact.destination,
        amount: fact.amount,
        asset: fact.asset as 'XRP' | typeof RLUSD_HEX,
      };
    },
  };
}
