/** Classifier stubs. The "LLM down" case reuses the real LlmClassifier so its FR-011 fallback path is exercised. */
import {
  FALLBACK_TASK_PROFILE,
  type Classifier,
  type TaskProfile,
} from '../../packages/contracts/src/index.js';
import { LlmClassifier } from '../../packages/routing/src/index.js';

/** Always returns the given profile; never calls anything. */
export function stubClassifier(over: Partial<TaskProfile> = {}): Classifier & { calls: number } {
  const c = {
    calls: 0,
    async classify(): Promise<TaskProfile> {
      c.calls += 1;
      return { ...FALLBACK_TASK_PROFILE, taskType: 'coding', confidence: 0.9, ...over };
    },
  };
  return c;
}

/** AT-008: the LLM provider is unreachable; every call rejects. */
export function downLlmClassifier(): LlmClassifier & { attempts: () => number } {
  let n = 0;
  const c = new LlmClassifier(async () => {
    n += 1;
    throw new Error('ECONNREFUSED: classifier provider unavailable');
  }, 'test/llm-down');
  return Object.assign(c, { attempts: () => n });
}

/** A classifier that throws outright (not an LlmClassifier): the API must fail the route, not crash. */
export function crashingClassifier(): Classifier {
  return {
    async classify() {
      throw new Error('classifier exploded');
    },
  };
}
