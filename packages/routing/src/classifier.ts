/**
 * Prompt classification (PRD FR-010, FR-011, DEC-014).
 *
 * - `fallbackClassify` is the deterministic heuristic (FR-011). It never throws.
 * - `LlmClassifier` wraps any `complete(prompt) => text` function, validates the model's JSON against
 *   `TaskProfile`, and falls back on ANY failure (FR-010). The provider wiring lives in
 *   `createClassifier`; tests inject a fake `complete`.
 */
import {
  type ClassifyInput,
  type Classifier,
  FALLBACK_TASK_PROFILE,
  TASK_TYPES,
  type TaskProfile,
  TaskProfile as TaskProfileSchema,
} from '@subbuddy/contracts';

export type ClassifierSource = 'llm' | 'fallback';

/** FR-010: the source (model or fallback) is identified in internal telemetry. */
export interface ClassificationResult {
  profile: TaskProfile;
  source: ClassifierSource;
  /** Provider model id when `source === 'llm'`. */
  model?: string;
  /** Why the LLM result was discarded, when `source === 'fallback'` inside an LLM classifier. */
  fallbackReason?: string;
}

const CODING =
  /```|\b(function|const|let|var|class|import|def|return|async|await|=>|SELECT|FROM|WHERE|public static|#include|npm|pip|regex|compile|debug|refactor|typescript|javascript|python|rust|golang|sql)\b/i;
const MATH =
  /[∑∫√∞≤≥≠±∂∇πθ]|\\(frac|sum|int|sqrt|alpha|beta)|\b(prove|proof|theorem|lemma|integral|derivative|equation|solve for|polynomial|matrix|eigen|probability|calculate|compute)\b|\d\s*[+\-*/^=]\s*\d/i;
const SUMMARIZE = /\b(summari[sz]e|summary|tl;?dr|condense|key points|abstract of)\b/i;

/** ~4 chars per token; good enough for a size estimate (FR-010 estimatedInputTokens). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ponytail: only the FR-011 required classes plus a size cutoff for long_context_analysis; extraction and
// creative_writing are left to the LLM classifier.
export function fallbackClassify(input: ClassifyInput): TaskProfile {
  const prompt = input.prompt;
  const estimatedInputTokens = estimateTokens(prompt);
  const needed = estimatedInputTokens + (input.maxOutputTokens ?? 1024);
  let requiredContextTokens = 4096;
  while (requiredContextTokens < needed) requiredContextTokens *= 2;

  let taskType: TaskProfile['taskType'] = 'general_chat';
  if (estimatedInputTokens > 8000) taskType = 'long_context_analysis';
  else if (CODING.test(prompt)) taskType = 'coding';
  else if (MATH.test(prompt)) taskType = 'mathematical_reasoning';
  else if (SUMMARIZE.test(prompt)) taskType = 'summarization';

  return {
    ...FALLBACK_TASK_PROFILE,
    taskType,
    estimatedInputTokens,
    requiredContextTokens,
    // Heuristic hits are a weak signal; unmatched prompts carry the FR-010 fallback confidence of 0.
    confidence: taskType === 'general_chat' ? 0 : 0.5,
  };
}

export class FallbackClassifier implements Classifier {
  classifyDetailed(input: ClassifyInput): ClassificationResult {
    return { profile: fallbackClassify(input), source: 'fallback' };
  }
  async classify(input: ClassifyInput): Promise<TaskProfile> {
    return fallbackClassify(input);
  }
}

/** Provider-agnostic completion: returns the model's raw text for a prompt. */
export type CompleteFn = (system: string, user: string) => Promise<string>;

export const CLASSIFIER_SYSTEM_PROMPT = `Classify the user's prompt for an inference router. Reply with ONLY a JSON object, no prose, shaped exactly:
{"taskType": one of ${JSON.stringify(TASK_TYPES)}, "reasoningLevel": "low"|"medium"|"high", "inputModality": "text", "estimatedInputTokens": integer >= 0, "requiredContextTokens": positive integer (context the model needs for prompt plus answer; never 0, use 4096 if unsure), "toolCallingRequired": boolean, "confidence": number 0..1}`;

export class LlmClassifier implements Classifier {
  constructor(
    private readonly complete: CompleteFn,
    private readonly model: string,
    private readonly timeoutMs = 8000,
  ) {}

  async classifyDetailed(input: ClassifyInput): Promise<ClassificationResult> {
    let fallbackReason: string;
    try {
      const raw = await withTimeout(
        this.complete(CLASSIFIER_SYSTEM_PROMPT, input.prompt),
        this.timeoutMs,
      );
      const obj = JSON.parse(extractJson(raw)) as Record<string, unknown>;
      // ponytail: models sometimes emit 0 for context size; a sizing slip should not discard a good classification.
      if (typeof obj['requiredContextTokens'] === 'number' && obj['requiredContextTokens'] <= 0)
        obj['requiredContextTokens'] = FALLBACK_TASK_PROFILE.requiredContextTokens;
      const parsed = TaskProfileSchema.safeParse(obj);
      if (parsed.success) return { profile: parsed.data, source: 'llm', model: this.model };
      fallbackReason = `schema: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`;
    } catch (err) {
      fallbackReason = err instanceof Error ? err.message : String(err);
    }
    // FR-010: any failure degrades to the heuristic; the route request never crashes.
    return { ...new FallbackClassifier().classifyDetailed(input), fallbackReason };
  }

  async classify(input: ClassifyInput): Promise<TaskProfile> {
    return (await this.classifyDetailed(input)).profile;
  }
}

/** Tolerates code fences or leading prose around the JSON object. */
function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in classifier output');
  return text.slice(start, end + 1);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`classifier timed out after ${ms}ms`)), ms);
    p.then(resolve, reject).finally(() => clearTimeout(t));
  });
}

// ---------------------------------------------------------------------------
// Provider wiring (CLASSIFIER_PROVIDER). Both providers are plain HTTPS JSON calls, so `fetch` covers
// them without an SDK dependency. The API key is read here and never logged or returned.
// ---------------------------------------------------------------------------

export interface ClassifierConfig {
  /** mock | anthropic | openai-compatible (see .env.example). */
  provider: string;
  apiKey?: string | undefined;
  model?: string | undefined;
  /** openai-compatible only, e.g. https://api.example.com/v1 */
  baseUrl?: string | undefined;
}

type FetchLike = typeof fetch;

export function anthropicComplete(apiKey: string, model: string, f: FetchLike = fetch): CompleteFn {
  return async (system, user) => {
    const res = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 256,
        system,
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const body = (await res.json()) as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
    };
    if (body.stop_reason === 'refusal') throw new Error('anthropic refusal');
    return (body.content ?? []).map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('');
  };
}

export function openAiCompatibleComplete(
  apiKey: string,
  model: string,
  baseUrl: string,
  f: FetchLike = fetch,
): CompleteFn {
  return async (system, user) => {
    const res = await f(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 256,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`openai-compatible ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? '';
  };
}

/** Builds the classifier selected by CLASSIFIER_PROVIDER. Misconfiguration fails fast at startup. */
export function createClassifier(
  cfg: ClassifierConfig,
  f: FetchLike = fetch,
): Classifier & {
  classifyDetailed(input: ClassifyInput): Promise<ClassificationResult> | ClassificationResult;
} {
  switch (cfg.provider) {
    case 'mock':
      return new FallbackClassifier();
    case 'anthropic': {
      if (!cfg.apiKey) throw new Error('CLASSIFIER_API_KEY is required for provider anthropic');
      const model = cfg.model ?? 'claude-opus-5';
      return new LlmClassifier(anthropicComplete(cfg.apiKey, model, f), model);
    }
    case 'openai-compatible': {
      if (!cfg.apiKey || !cfg.model || !cfg.baseUrl) {
        throw new Error(
          'CLASSIFIER_API_KEY, CLASSIFIER_MODEL and CLASSIFIER_BASE_URL are required for provider openai-compatible',
        );
      }
      return new LlmClassifier(
        openAiCompatibleComplete(cfg.apiKey, cfg.model, cfg.baseUrl, f),
        cfg.model,
      );
    }
    default:
      throw new Error(`unknown CLASSIFIER_PROVIDER "${cfg.provider}"`);
  }
}
