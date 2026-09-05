import { PROMPT_MAX_CHARS, type RouteState } from '@subbuddy/contracts';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  routeId?: string | undefined;
  cost?: string | undefined;
  asset?: string | undefined;
  seller?: string | undefined;
  txHash?: string | undefined;
  state?: RouteState | undefined;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  messages: ChatMessage[];
}

const KEY = 'subbuddy.chat';

export function newConversation(): Conversation {
  return {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    title: 'New chat',
    createdAt: new Date().toISOString(),
    messages: [],
  };
}

export function loadChat(): { conversations: Conversation[]; openId: string | null } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { conversations: [], openId: null };
    const o = JSON.parse(raw) as { conversations?: Conversation[]; openId?: string | null };
    return {
      conversations: Array.isArray(o.conversations) ? o.conversations : [],
      openId: o.openId ?? null,
    };
  } catch {
    return { conversations: [], openId: null };
  }
}

export function saveChat(conversations: Conversation[], openId: string | null): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ conversations, openId }));
  } catch {
    // storage blocked; history lives for this page only
  }
}

/**
 * Prompt sent for a new user message: prior turns as "User: ...\nAssistant: ...\n" followed by the new text,
 * capped at PROMPT_MAX_CHARS by dropping the oldest turns first. Failed assistant turns carry no answer, so
 * only SUCCEEDED assistant messages are part of the transcript.
 */
export function buildPrompt(
  prior: readonly ChatMessage[],
  text: string,
  max = PROMPT_MAX_CHARS,
): string {
  const lines = prior
    .filter((m) => m.role === 'user' || m.state === 'SUCCEEDED')
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}\n`);
  let start = 0;
  let total = text.length + lines.reduce((n, l) => n + l.length, 0);
  while (start < lines.length && total > max) total -= lines[start++]!.length;
  return lines.slice(start).join('') + text;
}
