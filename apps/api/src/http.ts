/**
 * SEC-004: every outbound HTTP call (seller quote/paid request, classifier) gets a deadline and a body cap.
 * Wraps `fetch` so the adapters keep their own error mapping: a timeout surfaces as an AbortError and an
 * oversized body as ResponseTooLargeError, both of which the callers already turn into safe public codes
 * (SELLER_UNAVAILABLE / OUTCOME_UNKNOWN; classifier falls back).
 */
export class ResponseTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`response exceeded ${limit} bytes`);
    this.name = 'ResponseTooLargeError';
  }
}

export interface GuardedFetchOptions {
  timeoutMs: number;
  maxResponseBytes: number;
}

export function guardedFetch(opts: GuardedFetchOptions, base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const signal = init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(opts.timeoutMs)])
      : AbortSignal.timeout(opts.timeoutMs);
    const res = await base(input, { ...init, signal });
    const declared = Number(res.headers.get('content-length'));
    if (declared > opts.maxResponseBytes) {
      await res.body?.cancel().catch(() => {});
      throw new ResponseTooLargeError(opts.maxResponseBytes);
    }
    // Null-body statuses reject a body in the Response constructor; nothing to cap anyway.
    if (!res.body || [101, 204, 205, 304].includes(res.status)) return res;
    // Stream with a running byte count so an unbounded body is cut off, not buffered.
    let seen = 0;
    const reader = res.body.getReader();
    const capped = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) return controller.close();
        seen += value.byteLength;
        if (seen > opts.maxResponseBytes) {
          await reader.cancel().catch(() => {});
          controller.error(new ResponseTooLargeError(opts.maxResponseBytes));
          return;
        }
        controller.enqueue(value);
      },
      cancel: (reason) => reader.cancel(reason),
    });
    return new Response(capped, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
}
