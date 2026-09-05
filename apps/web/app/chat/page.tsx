'use client';

import type { RouteState, RoutingMode } from '@subbuddy/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, backoffMs, EXPLORER_BASE, type RouteDetail } from '../../src/lib/api';
import {
  buildPrompt,
  loadChat,
  newConversation,
  saveChat,
  type ChatMessage,
  type Conversation,
} from '../../src/lib/chat-store';
import { failureCopy, isTerminal } from '../../src/lib/route-ui';
import { MD } from '../components/Result';

const MODES: { id: RoutingMode; label: string }[] = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'quality', label: 'Quality' },
  { id: 'cheapest', label: 'Cheapest' },
  { id: 'fastest', label: 'Fastest' },
];
const SETTINGS_KEY = 'subbuddy.chat.settings';
const STEP_COPY: Partial<Record<RouteState, string>> = {
  CLASSIFYING: 'Classifying the task…',
  ROUTING: 'Comparing offers…',
  QUOTING: 'Getting the authoritative x402 quote…',
  QUOTED: 'Quote received, checking the spend policy…',
  POLICY_APPROVED: 'Approved, signing the payment…',
  SIGNED: 'Payment signed, sending to the seller…',
  PAID_REQUEST_SENT: 'Paid request sent…',
  OUTCOME_UNKNOWN: 'Resolving the payment outcome on ledger…',
  VERIFYING: 'Verifying settlement on XRPL…',
};

function loadSettings(): { mode: RoutingMode; maxCost: string } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as { mode: RoutingMode; maxCost: string };
  } catch {
    // ignore
  }
  return { mode: 'balanced', maxCost: '0.020000' };
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [settings, setSettings] = useState(() => ({
    mode: 'balanced' as RoutingMode,
    maxCost: '0.020000',
  }));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Session history: restore conversations and the last open one (localStorage, per browser).
  useEffect(() => {
    const { conversations: cs, openId: id } = loadChat();
    setConversations(cs);
    setOpenId(id ?? cs[0]?.id ?? null);
    setSettings(loadSettings());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) saveChat(conversations, openId);
  }, [conversations, openId, hydrated]);
  useEffect(() => {
    if (hydrated) {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        // ignore
      }
    }
  }, [settings, hydrated]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [conversations, openId]);

  const open = conversations.find((c) => c.id === openId) ?? null;

  function patchMessage(convId: string, index: number, patch: Partial<ChatMessage>) {
    setConversations((cs) =>
      cs.map((c) =>
        c.id !== convId
          ? c
          : { ...c, messages: c.messages.map((m, i) => (i === index ? { ...m, ...patch } : m)) },
      ),
    );
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    let conv = open;
    if (!conv) {
      conv = newConversation();
      setConversations((cs) => [conv!, ...cs]);
      setOpenId(conv.id);
    }
    const convId = conv.id;
    const prior = conv.messages;
    const prompt = buildPrompt(prior, text);
    const assistantIndex = prior.length + 1;
    setDraft('');
    setBusy(true);
    setConversations((cs) =>
      cs.map((c) =>
        c.id !== convId
          ? c
          : {
              ...c,
              title: c.messages.length === 0 ? text.slice(0, 40) : c.title,
              messages: [
                ...c.messages,
                { role: 'user', text },
                { role: 'assistant', text: '', state: 'CLASSIFYING' },
              ],
            },
      ),
    );
    try {
      const route = await api.createRoute({
        prompt,
        mode: settings.mode,
        maxCost: settings.maxCost,
      });
      patchMessage(convId, assistantIndex, { routeId: route.routeId, state: route.state });
      if (route.state === 'QUOTED') {
        // Execute: sign once, pay, verify. Errors (e.g. POLICY_REJECTED 403) are terminal states we read back below.
        await api.execute(route.routeId, prompt).catch(() => undefined);
      }
      let detail: RouteDetail | null = null;
      for (let attempt = 0; ; attempt++) {
        detail = await api.getRoute(route.routeId);
        patchMessage(convId, assistantIndex, { state: detail.state });
        if (isTerminal(detail.state)) break;
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
      }
      const ok = detail.state === 'SUCCEEDED' && detail.result;
      patchMessage(convId, assistantIndex, {
        text: ok ? detail.result! : failureCopy(detail.state).body,
        state: detail.state,
        cost:
          detail.payment.status === 'SETTLED' ? (detail.payment.amount ?? undefined) : undefined,
        asset: detail.payment.assetCode ?? undefined,
        seller: detail.selected?.sellerName ?? undefined,
        txHash: detail.payment.transactionHash ?? undefined,
      });
    } catch (err) {
      patchMessage(convId, assistantIndex, {
        text: `Request failed before any payment: ${err instanceof Error ? err.message : String(err)}. No money moved.`,
        state: 'FAILED',
      });
    } finally {
      setBusy(false);
    }
  }

  function startNew() {
    const c = newConversation();
    setConversations((cs) => [c, ...cs]);
    setOpenId(c.id);
    setSidebar(false);
  }
  function remove(id: string) {
    setConversations((cs) => cs.filter((c) => c.id !== id));
    if (openId === id) setOpenId(null);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-6xl" data-testid="chat">
      {/* Sidebar: conversation list (persisted per browser). */}
      <aside
        className={`${sidebar ? 'block' : 'hidden'} w-64 shrink-0 border-r border-neutral-200 bg-white p-3 md:block`}
        aria-label="Conversations"
      >
        <button
          type="button"
          onClick={startNew}
          className="mb-3 w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-2 focus:outline-indigo-600"
          data-testid="new-chat"
        >
          + New chat
        </button>
        <ul className="space-y-1 overflow-y-auto text-sm">
          {conversations.map((c) => (
            <li key={c.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setOpenId(c.id);
                  setSidebar(false);
                }}
                className={`flex-1 truncate rounded px-2 py-1 text-left hover:bg-neutral-100 ${c.id === openId ? 'bg-neutral-100 font-medium' : ''}`}
                title={c.title}
              >
                {c.title}
              </button>
              <button
                type="button"
                aria-label={`Delete ${c.title}`}
                onClick={() => remove(c.id)}
                className="rounded px-1 text-neutral-400 hover:text-red-600 focus:outline-2 focus:outline-indigo-600"
              >
                ×
              </button>
            </li>
          ))}
          {conversations.length === 0 && (
            <li className="px-2 text-neutral-500">No conversations yet.</li>
          )}
        </ul>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2 text-xs">
          <button
            type="button"
            className="rounded border px-2 py-1 md:hidden"
            onClick={() => setSidebar((s) => !s)}
            aria-expanded={sidebar}
            aria-controls="conversations"
          >
            ☰ Chats
          </button>
          <label className="flex items-center gap-1">
            Mode
            <select
              value={settings.mode}
              onChange={(e) => setSettings((s) => ({ ...s, mode: e.target.value as RoutingMode }))}
              className="rounded border px-1 py-0.5"
              data-testid="chat-mode"
            >
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            Max cost
            <input
              value={settings.maxCost}
              onChange={(e) => setSettings((s) => ({ ...s, maxCost: e.target.value }))}
              inputMode="decimal"
              className="w-24 rounded border px-1 py-0.5 font-mono"
              data-testid="chat-max-cost"
            />
            RLUSD
          </label>
          <span className="ml-auto text-neutral-500">
            Each reply is one x402 payment on XRPL Testnet.{' '}
            <Link href="/" className="underline">
              Full router view
            </Link>
          </span>
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-4" data-testid="messages">
          {!open || open.messages.length === 0 ? (
            <p className="mt-16 text-center text-sm text-neutral-500">
              Ask anything. Kevin classifies the task, compares sellers, pays the chosen one on
              XRPL, and shows the receipt under each answer.
            </p>
          ) : (
            open.messages.map((m, i) => <Bubble key={i} m={m} />)
          )}
          <div ref={bottom} />
        </div>

        <form
          className="border-t border-neutral-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="Message Kevin… (Enter to send, Shift+Enter for a new line)"
              aria-label="Message"
              className="min-h-[2.5rem] flex-1 resize-y rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-indigo-600"
              data-testid="chat-input"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-indigo-700 focus:outline-2 focus:outline-indigo-600"
              data-testid="chat-send"
            >
              {busy ? 'Working…' : 'Send'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  if (m.role === 'user') {
    return (
      <div className="mb-3 flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-indigo-600 px-4 py-2 text-sm text-white">
          {m.text}
        </div>
      </div>
    );
  }
  const pending = m.state !== undefined && !isTerminal(m.state);
  const failed = m.state !== undefined && isTerminal(m.state) && m.state !== 'SUCCEEDED';
  return (
    <div className="mb-3 flex justify-start">
      <div
        className={`max-w-[85%] rounded-2xl border px-4 py-2 text-sm ${failed ? 'border-red-200 bg-red-50' : 'border-neutral-200 bg-white'}`}
        data-testid="assistant-message"
      >
        {pending ? (
          <p className="text-neutral-500" role="status">
            {STEP_COPY[m.state!] ?? 'Working…'}
          </p>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>
            {m.text}
          </ReactMarkdown>
        )}
        {(m.routeId || m.cost || m.txHash) && (
          <p
            className="mt-2 border-t border-neutral-100 pt-1 font-mono text-[11px] text-neutral-500"
            data-testid="message-footer"
          >
            {m.cost ? `${m.cost} ${m.asset ?? ''} paid` : 'no payment'}
            {m.seller ? ` · ${m.seller}` : ''}
            {m.txHash ? (
              <>
                {' · tx '}
                <a
                  href={`${EXPLORER_BASE}${m.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {m.txHash.slice(0, 8)}…{m.txHash.slice(-6)}
                </a>
              </>
            ) : null}
            {m.routeId ? (
              <>
                {' · '}
                <Link href={`/?route=${m.routeId}`} className="underline">
                  details
                </Link>
              </>
            ) : null}
          </p>
        )}
      </div>
    </div>
  );
}
