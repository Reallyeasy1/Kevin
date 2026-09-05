/**
 * @subbuddy/payments — xrpl.js + x402-xrpl adapter (PRD §8.6–8.8, §9.2, §10.3).
 * Nothing from xrpl.js or x402-xrpl is re-exported; callers see only contracts types plus these classes.
 */
export { PaymentError, type PaymentErrorCode } from './errors.js';
export {
  createLedgerClient,
  withBackoff,
  type BackoffOptions,
  type LedgerHandle,
} from './ledger.js';
export {
  DEFAULT_SOURCE_TAG,
  assertExactMatchesRequirement,
  toExactPayment,
  validateQuote,
  type ExpectedSettlement,
  type RawRequirement,
  type ValidateQuoteContext,
} from './quote.js';
export { XrplWalletSigner, type WalletSignerOptions } from './signer.js';
export { X402PaymentClient, classifySettlement, type PaymentClientOptions } from './client.js';
