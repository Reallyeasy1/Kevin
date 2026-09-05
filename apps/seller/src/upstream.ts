/**
 * Upstream model adapters (FR-080). Credentials arrive only through options built from seller-side env;
 * nothing here logs or returns them (INV-007, SEC-002).
 */
import { createHash } from 'node:crypto';

export interface UpstreamInput {
  modelId: string;
  prompt: string;
  maxOutputTokens?: number;
}

export interface UpstreamResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export interface UpstreamModel {
  complete(input: UpstreamInput): Promise<UpstreamResult>;
}

// ponytail: 4 chars per token is the usual estimate; the mock and a usage-less upstream both use it.
const approxTokens = (s: string): number => Math.ceil(s.length / 4);

/** Deterministic canned answer, no network. Default dev provider and the AT-012 fixture. */
export function mockUpstream(): UpstreamModel {
  return {
    async complete({ modelId, prompt }) {
      const digest = createHash('sha256').update(prompt).digest('hex').slice(0, 12);
      const content = `[mock ${modelId}] Answer for prompt ${digest}: ${prompt.slice(0, 80)}`;
      return { content, inputTokens: approxTokens(prompt), outputTokens: approxTokens(content) };
    },
  };
}

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  /** Upstream model name. Defaults to the offer modelId without its provider prefix. */
  model?: string;
  fetchImpl?: typeof fetch;
  /** SEC-004 outbound timeout. Default 60s. */
  timeoutMs?: number;
}

const MAX_UPSTREAM_BYTES = 1024 * 1024; // SEC-004

// ponytail: same as @subbuddy/payments readBodyCapped; copied because the seller must not depend on the buyer side.
async function readCapped(res: Response, max: number): Promise<string> {
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
      throw new Error('upstream response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Any `/chat/completions` server. Errors carry a status code only, never the upstream body (SEC-008). */
export function openAiCompatibleUpstream(o: OpenAiCompatibleOptions): UpstreamModel {
  const fetchImpl = o.fetchImpl ?? fetch;
  const base = o.baseUrl.replace(/\/+$/, '');
  return {
    async complete({ modelId, prompt, maxOutputTokens }) {
      const res = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
        body: JSON.stringify({
          model: o.model ?? modelId.split('/').pop(),
          messages: [{ role: 'user', content: prompt }],
          ...(maxOutputTokens !== undefined ? { max_tokens: maxOutputTokens } : {}),
        }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
      });
      const text = await readCapped(res, MAX_UPSTREAM_BYTES);
      if (!res.ok) throw new Error(`upstream http ${res.status}`);
      const json = JSON.parse(text) as {
        choices?: { message?: { content?: unknown } }[];
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('upstream response missing content');
      const count = (v: unknown, fallback: number): number =>
        typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback;
      return {
        content,
        inputTokens: count(json.usage?.prompt_tokens, approxTokens(prompt)),
        outputTokens: count(json.usage?.completion_tokens, approxTokens(content)),
      };
    },
  };
}
