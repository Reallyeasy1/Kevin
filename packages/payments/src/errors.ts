/** Package-level error. `publicReason` is safe to surface in the API/UI (§13.4); never carries raw payloads or secrets. */
export type PaymentErrorCode =
  | 'QUOTE_REJECTED'
  | 'ENDPOINT_NOT_ALLOWED'
  | 'SELLER_UNAVAILABLE'
  | 'SELLER_MISCONFIGURED'
  | 'INSUFFICIENT_BALANCE'
  | 'SIGNER_UNAVAILABLE'
  | 'PAYMENT_FAILED'
  | 'PAID_EXECUTION_FAILED'
  /** Paid request response lost; `transactionHash` is set. Resolve by hash, never re-sign (FR-071). */
  | 'OUTCOME_UNKNOWN';

export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  readonly publicReason: string;
  readonly retryable: boolean;
  /** Known signed-tx hash when money may have moved. */
  readonly transactionHash: string | null;

  constructor(
    code: PaymentErrorCode,
    publicReason: string,
    opts: { retryable?: boolean; transactionHash?: string; cause?: unknown } = {},
  ) {
    super(`${code}: ${publicReason}`, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'PaymentError';
    this.code = code;
    this.publicReason = publicReason;
    this.retryable = opts.retryable ?? false;
    this.transactionHash = opts.transactionHash ?? null;
  }
}
