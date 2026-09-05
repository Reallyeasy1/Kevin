/** AT-008: Classifier failure (PRD §17, FR-010, FR-011). Issue #37. */
import { describe, expect, it } from 'vitest';
import { crashingClassifier, downLlmClassifier } from '../fakes/classifier.js';
import { createHarness } from '../fakes/harness.js';

const CODE_BLOCK_PROMPT = 'Why does this fail?\n```ts\nconst x: number = "1";\n```';

describe('AT-008: Classifier failure', () => {
  it('LLM classifier unavailable: fallback returns coding, routing continues, payment behaviour unchanged', async () => {
    const llm = downLlmClassifier();
    const h = await createHarness({ classifier: llm });

    const res = await h.route({ prompt: CODE_BLOCK_PROMPT });
    expect(llm.attempts()).toBe(1); // the LLM was tried and failed
    expect(res.statusCode).toBe(201);
    expect(res.json().taskProfile.taskType).toBe('coding');
    expect(res.json().state).toBe('QUOTED');
    expect(res.json().selected.offerId).toBe('fast-code-v1');

    // No payment behaviour changes: same single signature, same paid flow, same receipt shape.
    const { routeId } = res.json();
    await h.execute(routeId, CODE_BLOCK_PROMPT);
    expect(await h.terminal(routeId)).toBe('SUCCEEDED');
    expect(h.signCalls).toHaveLength(1);
    expect(h.seller.paidRequests).toHaveLength(1);
    expect((await h.receipt(routeId)).payment.status).toBe('SETTLED');
  });

  it('a classifier that throws outright fails the route safely: INTERNAL_ERROR envelope, FAILED, nothing signed', async () => {
    const h = await createHarness({ classifier: crashingClassifier() });
    const res = await h.route();
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatchObject({
      code: 'INTERNAL_ERROR',
      retryable: true,
      routeId: expect.any(String),
    });
    expect(res.json().error.message).not.toContain('exploded'); // §11.1 safe message
    expect(h.states(res.json().error.routeId)).toEqual(['CLASSIFYING', 'FAILED']);
    expect(h.signCalls).toHaveLength(0);
    expect(await h.paymentRows()).toHaveLength(0);
  });
});
