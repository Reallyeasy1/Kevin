import { describe, expect, it, vi } from 'vitest';
import { FALLBACK_TASK_PROFILE, TaskProfile } from '@subbuddy/contracts';
import { LlmClassifier, createClassifier, fallbackClassify } from './classifier.js';

describe('fallbackClassify (FR-011)', () => {
  it('code fence -> coding', () => {
    expect(fallbackClassify({ prompt: 'fix this\n```js\nlet x = 1\n```' }).taskType).toBe('coding');
  });
  it('programming keyword -> coding', () => {
    expect(fallbackClassify({ prompt: 'Write a python function to sort' }).taskType).toBe('coding');
  });
  it('proof keyword / notation -> mathematical_reasoning', () => {
    expect(fallbackClassify({ prompt: 'Prove that the sum converges' }).taskType).toBe(
      'mathematical_reasoning',
    );
    expect(fallbackClassify({ prompt: 'what is ∑ 1/n²' }).taskType).toBe('mathematical_reasoning');
  });
  it('summarise / summarize -> summarization', () => {
    expect(fallbackClassify({ prompt: 'Summarise this article' }).taskType).toBe('summarization');
    expect(fallbackClassify({ prompt: 'Please summarize: ...' }).taskType).toBe('summarization');
  });
  it('unmatched -> general_chat with confidence 0 and a schema-valid profile', () => {
    const p = fallbackClassify({ prompt: 'hello there, how are you today?' });
    expect(p.taskType).toBe('general_chat');
    expect(p.confidence).toBe(0);
    expect(TaskProfile.parse(p)).toEqual(p);
  });
  it('sizes requiredContextTokens from prompt + maxOutputTokens', () => {
    const p = fallbackClassify({ prompt: 'x'.repeat(20000), maxOutputTokens: 1000 });
    expect(p.estimatedInputTokens).toBe(5000);
    expect(p.requiredContextTokens).toBe(8192);
  });
});

describe('LlmClassifier (FR-010, AT-008)', () => {
  const good = {
    taskType: 'coding',
    reasoningLevel: 'medium',
    inputModality: 'text',
    estimatedInputTokens: 220,
    requiredContextTokens: 4096,
    toolCallingRequired: false,
    confidence: 0.91,
  };

  it('accepts schema-valid output, even wrapped in a code fence', async () => {
    const c = new LlmClassifier(async () => '```json\n' + JSON.stringify(good) + '\n```', 'm');
    const r = await c.classifyDetailed({ prompt: 'anything' });
    expect(r).toEqual({ profile: good, source: 'llm', model: 'm' });
  });

  it('falls back when the model invents a task type', async () => {
    const c = new LlmClassifier(async () => JSON.stringify({ ...good, taskType: 'vision' }), 'm');
    const r = await c.classifyDetailed({ prompt: 'hello there' });
    expect(r.source).toBe('fallback');
    expect(r.fallbackReason).toMatch(/schema: taskType/);
    expect(r.profile).toMatchObject({ taskType: 'general_chat', confidence: 0 });
  });

  it('falls back to the heuristic when the model is unavailable (AT-008)', async () => {
    const c = new LlmClassifier(async () => {
      throw new Error('ECONNREFUSED');
    }, 'm');
    const r = await c.classifyDetailed({ prompt: '```py\nprint(1)\n```' });
    expect(r.source).toBe('fallback');
    expect(r.profile.taskType).toBe('coding');
    expect(r.fallbackReason).toBe('ECONNREFUSED');
  });

  it('falls back on non-JSON output and on timeout', async () => {
    expect(await new LlmClassifier(async () => 'sure!', 'm').classify({ prompt: 'hi' })).toEqual(
      fallbackClassify({ prompt: 'hi' }),
    );
    const slow = new LlmClassifier(() => new Promise(() => {}), 'm', 5);
    expect((await slow.classifyDetailed({ prompt: 'hi' })).fallbackReason).toMatch(/timed out/);
  });
});

describe('createClassifier (CLASSIFIER_PROVIDER)', () => {
  it('mock -> heuristic; missing key fails fast; unknown provider fails fast', async () => {
    expect(await createClassifier({ provider: 'mock' }).classify({ prompt: 'hi' })).toEqual(
      fallbackClassify({ prompt: 'hi' }),
    );
    expect(() => createClassifier({ provider: 'anthropic' })).toThrow(/CLASSIFIER_API_KEY/);
    expect(() => createClassifier({ provider: 'nope' })).toThrow(/unknown/);
  });

  it('anthropic provider posts to the Messages API with the key in a header, never in the body', async () => {
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.body).not.toContain('sk-test');
      return new Response(
        JSON.stringify({
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ...FALLBACK_TASK_PROFILE, taskType: 'coding' }),
            },
          ],
        }),
      );
    });
    const c = createClassifier(
      { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-opus-5' },
      f as unknown as typeof fetch,
    );
    const r = await c.classifyDetailed({ prompt: 'hi' });
    expect(r).toMatchObject({ source: 'llm', model: 'claude-opus-5' });
    expect(r.profile.taskType).toBe('coding');
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect((init!.headers as Record<string, string>)['x-api-key']).toBe('sk-test');
  });

  it('anthropic HTTP error degrades to fallback', async () => {
    const f = async () => new Response('nope', { status: 500 });
    const c = createClassifier({ provider: 'anthropic', apiKey: 'k' }, f as typeof fetch);
    const r = await c.classifyDetailed({ prompt: 'hi' });
    expect(r).toMatchObject({ source: 'fallback', fallbackReason: 'anthropic 500' });
  });
});
