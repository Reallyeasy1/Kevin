import { describe, expect, it } from 'vitest';
import { buildPrompt, type ChatMessage } from './chat-store.js';

describe('buildPrompt', () => {
  const prior: ChatMessage[] = [
    { role: 'user', text: 'What is 2+2?' },
    { role: 'assistant', text: '4', state: 'SUCCEEDED' },
    { role: 'user', text: 'broken' },
    { role: 'assistant', text: 'No eligible offer', state: 'NO_ELIGIBLE_OFFER' },
  ];
  it('prefixes prior successful turns and appends the new message', () => {
    expect(buildPrompt(prior, 'and 3+3?')).toBe(
      'User: What is 2+2?\nAssistant: 4\nUser: broken\nand 3+3?',
    );
  });
  it('drops the oldest turns first when over the cap', () => {
    expect(buildPrompt(prior, 'and 3+3?', 30)).toBe('User: broken\nand 3+3?');
    expect(buildPrompt([], 'x'.repeat(50), 30)).toBe('x'.repeat(50)); // new text alone; RouteRequest rejects it
  });
});
