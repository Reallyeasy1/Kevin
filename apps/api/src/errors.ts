/**
 * §11.1 error envelope. `ApiError` carries a safe public message; anything else that reaches the handler
 * becomes INTERNAL_ERROR with a generic message (no stack traces, no provider payloads).
 */
import type { ErrorCode, ApiError as Envelope } from '@subbuddy/contracts';
import { PaymentError } from '@subbuddy/payments';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 400,
  PROMPT_TOO_LARGE: 413,
  NO_ELIGIBLE_OFFER: 422,
  QUOTE_REJECTED: 502,
  POLICY_REJECTED: 403,
  SPEND_CAP_REACHED: 429,
  MANDATE_EXPIRED: 410,
  PROMPT_MISMATCH: 409,
  PAYMENT_FAILED: 502,
  PAID_EXECUTION_FAILED: 502,
  SELLER_UNAVAILABLE: 503,
  SELLER_MISCONFIGURED: 502,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly opts: { retryable?: boolean; routeId?: string; cause?: unknown } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'ApiError';
    this.status = STATUS[code];
  }

  envelope(): Envelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.opts.retryable ?? false,
        ...(this.opts.routeId ? { routeId: this.opts.routeId } : {}),
      },
    };
  }
}

/** PaymentError codes with a public ErrorCode twin keep it; the rest map to their nearest public code. */
export function fromPaymentError(err: PaymentError, routeId?: string): ApiError {
  const code: ErrorCode =
    err.code === 'ENDPOINT_NOT_ALLOWED'
      ? 'SELLER_MISCONFIGURED'
      : err.code === 'INSUFFICIENT_BALANCE' || err.code === 'SIGNER_UNAVAILABLE'
        ? 'POLICY_REJECTED'
        : err.code === 'OUTCOME_UNKNOWN'
          ? 'PAYMENT_FAILED'
          : err.code;
  return new ApiError(code, err.publicReason, {
    retryable: err.retryable,
    cause: err,
    ...(routeId ? { routeId } : {}),
  });
}

export function toApiError(err: unknown, routeId?: string): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof PaymentError) return fromPaymentError(err, routeId);
  return new ApiError('INTERNAL_ERROR', 'An internal error occurred.', {
    cause: err,
    ...(routeId ? { routeId } : {}),
  });
}
