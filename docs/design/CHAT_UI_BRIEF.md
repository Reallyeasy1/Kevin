# Chat UI build brief

Turn the single-page router (`apps/web`) into a three-route chat app: `/` chat, `/settings`, `/logs`. The buyer API
(PRD §11) is untouched; every chat turn is one paid route through the existing `POST /v1/routes` → `execute` → SSE flow.
Reference studied: mckaywrigley/chatbot-ui (`../.chatbot-ui-ref`, Next 14 + Radix + Supabase). We borrow its shape,
not its stack.

## 0. What we take from chatbot-ui, and what we do not

| Take | Leave |
| --- | --- |
| Layout: fixed 260-350 px sidebar (conversation list, new-chat button) + centred message column + bottom composer. Sidebar collapses to 0 with a toggle; state in `localStorage`. | Radix/shadcn (~30 packages), Supabase, i18n, workspaces, folders, presets, assistants, files, tools, retrieval. |
| Composer: auto-growing textarea, `Enter` sends, `Shift+Enter` newline, IME guard via `compositionstart/end`, send button disabled while empty, "stop/generating" affordance replaced by our in-flight status. | `@`/`/`/`#`/`!` command pickers, file drop, image paste. |
| Message rendering: `react-markdown` + `remark-gfm`; block code gets a header bar with language + copy button; inline code stays inline. Streaming placeholder is a pulsing `▍`. | `react-syntax-highlighter`, `remark-math`, download-as-file. |
| Empty state: brand mark centred, composer at bottom, settings reachable from the top-right. | Quick-settings dropdown (we have three knobs; a Settings page is enough). |
| Scroll: auto-scroll to bottom while generating unless the user scrolled up; scroll-to-bottom button when overflowing. | Scroll-to-top button. |
| Hotkeys: `Ctrl/Cmd+Shift+O` new chat, `Ctrl/Cmd+Shift+L` focus composer, `Ctrl/Cmd+Shift+S` toggle sidebar. | Help dropdown, announcements. |

New UI libraries recommended: **none**. Tailwind 4 `field-sizing-content` replaces textarea-autosize; native `<dialog>`
replaces the mobile drawer; the existing `MD` component map in `Result.tsx` already renders markdown. If a syntax
highlighter is demanded later, add `shiki` (ESM, no CSS import) behind the code block, not `react-syntax-highlighter`.

## 1. Routes

| Route | Purpose | Notes |
| --- | --- | --- |
| `/` | Chat. Sidebar of conversations, message pane, composer. `?c=<conversationId>` selects a conversation (optional; default = most recent). | Replaces `RouterApp`. |
| `/settings` | Routing mode, max cost + asset, output limit, mandate TTL, wallet card, hub status. | Values persist in `localStorage`; applied per message at send time. |
| `/logs` | Route history list (today's `/history`) and, with `?route=<id>`, the full route detail: timeline, selected offer, payment evidence, economic receipt, candidate table. | `/history` stays as `redirect('/logs')` in `app/history/page.tsx` (one line). `/?route=<id>` deep links from old evidence redirect to `/logs?route=<id>`. |

Shell (sidebar + top bar) wraps all three routes so Settings and Logs are one click from any chat.

## 2. What moves off the main page into Settings

Every knob the composer used to carry, plus read-only facts about the wallet:

| Control | Storage / source | Rendering on `/settings` | Echo on `/` |
| --- | --- | --- | --- |
| Routing mode (4 radios, existing copy `MODE_HELP`) | `settings.mode`, default `balanced` | Same radiogroup as today (`name="mode"`, arrow keys work) | Chip in composer: `Balanced · ≤ 0.020000 RLUSD` linking to `/settings` |
| Max cost + asset suffix | `settings.maxCost`, default `0.020000`; asset from `GET /v1/wallet` balances[0] or last route mandate | `<input inputMode="decimal">` with asset suffix and the existing mandate help text; validated with `RouteRequest.shape.maxCost` on blur | in chip |
| Output limit (tokens) | `settings.maxOutputTokens`, default unset | number input | hidden |
| Mandate TTL | read-only; server policy (5 min). Show `expiresAt - createdAt` from the most recent route when one exists, else "5 minutes from route creation". | text row | shown in the in-flight status line (existing `quoted` copy) |
| Wallet details | `GET /v1/wallet` | `WalletBar` moved here as `WalletCard`: address (`wallet-address`), `network-badge`, full `Balances` list | Top bar keeps a compact `network-badge` + first balance only (§22.1 demo needs both visible) |
| Hub status | `GET /v1/offers` `hubStatus` | "XRPL AI Hub discovery: unavailable (0 imported, N skipped: reasons…)" plus registry version and offer count | One-line `hub-notice` under the top bar stays (FR-021 says the UI shows it; it is one `<p>`) |

Settings are read once on mount via `useSyncExternalStore` over `localStorage` (SSR-safe, falls back to defaults when
storage throws). Changing a setting never touches an in-flight route; the mandate is fixed at `POST /v1/routes`.

## 3. What moves into Logs

`/logs` = today's `/history` list. `/logs?route=<id>` = today's read-only `/?route=<id>` view, rendered with the
existing components in this order: `Timeline` (final state, all steps), `SelectedOfferCard`, `PaymentEvidence`,
`ReceiptDetails` (open by default here), `CandidateTable`. Data: `GET /v1/routes/:id` + `GET /v1/offers` for hub URLs.
Each row in the list links to `/logs?route=<id>`; each assistant bubble's "details" link points there too. A
"Back to chat" link goes to `/?c=<conversationId>` when the route is known to a local conversation (lookup by routeId in
the store), otherwise to `/`.

Failed routes (`FailurePanel` copy) render in Logs too, without the action buttons; retries happen from the chat.

## 4. Chat message model

```ts
// apps/web/src/lib/conversations.ts
interface Conversation { id: string; title: string; createdAt: string; updatedAt: string; messages: ChatMessage[] }
type ChatMessage =
  | { id: string; role: 'user'; content: string; createdAt: string }
  | { id: string; role: 'assistant'; routeId: string | null; createdAt: string;
      content: string | null;                 // markdown answer once SUCCEEDED
      state: RouteState | null;               // last known route state (persisted so reload can resume)
      summary: { cost: string | null; asset: string | null; sellerName: string | null; modelId: string | null;
                 txHash: string | null; explorerUrl: string | null } };
```

Send flow (one active run per tab; composer disabled while `busy`, exactly as `RouterApp` does today):

1. Append the user message; append an assistant message with `routeId: null, state: 'CLASSIFYING'` synchronously
   (NFR-002: the first UI state change is local).
2. Build the prompt: `buildPrompt(previousMessages, newText)`.
   - First turn of a conversation: the prompt is the message verbatim (no wrapper), so the classifier, the prompt hash
     and the existing e2e request assertions see exactly what the user typed.
   - Later turns: `"User: …\n\nAssistant: …\n\n…User: <new>"`. Only `user` messages and assistant messages with
     `content` (SUCCEEDED) are included; failed turns are skipped.
   - Cap at `PROMPT_MAX_CHARS` (32 000, exported by `@subbuddy/contracts`): drop whole turns oldest-first until it fits;
     the new message is always kept. If the new message alone exceeds the cap, show the `RouteRequest` validation
     error in the composer and send nothing.
3. `api.createRoute({ prompt, mode, maxCost, maxOutputTokens })` → store `routeId` on the assistant message →
   `api.execute(routeId, prompt)` → `follow()` (SSE then bounded polling). This is `RouterApp.submit/execute/follow`
   lifted into `useRoute()` unchanged; only the setState targets change.
4. On every state/event update, mirror `routeState`, `detail.result`, and `deriveEvidence()` into the assistant message
   and persist the conversation.

Assistant bubble:

- In flight: the six-step row (`Timeline` in a `compact` variant: icons only, labels as `title`/sr-only at < 640 px) and
  the existing `statusText()` line as `role="status"` with `data-testid="status"` `data-ui-state`. Below it a pulsing
  `▍` where the answer will appear. Copy is reused verbatim: classifying, routing, quoting, quoted, payment_pending
  (incl. the OUTCOME_UNKNOWN sentence), settled, executing.
- Succeeded: markdown answer via the existing `MD` component map (`data-testid="answer"` on the bubble,
  `answer-markdown` on the body, `usage` line). Block code gets a header (language, Copy) — extend the `pre` renderer.
- Footer (always once a quote exists): `0.006200 RLUSD · Fast Code · provider/model-b · Validated ·
  E3FE6EA3…C5D6 [Copy] [explorer] · details`. Testids: `payment-status` (Validated/Pending/Failed/Not attempted via
  `paymentStatusLabel`), `tx-hash` (`shortHash`, full hash in `title`), `explorer-link`, button "Copy transaction hash",
  and `details` → `/logs?route=<id>`.
- Failure: the bubble body is `FailurePanel` unchanged (`data-testid="failure"`, `failureCopy` title/body, the
  "Money moved: yes/no" line, "Retry delivery (no new payment)" for PAID_EXECUTION_FAILED, "Route again" re-sends the
  same user text as a new turn). Amber for paid failure, red otherwise, exactly as today.
- `data-testid="status"` exists exactly once on the page: on the newest assistant bubble, or, when the conversation has
  none, on an sr-only idle line under the composer (`data-ui-state="idle"`). Older bubbles show their final state as
  plain text without the testid.

Reload during a run: the assistant message has a `routeId` and a non-terminal `state`; `useRoute` resumes with
`follow(routeId, null)` (polling only) on mount. Never re-POST `execute` automatically; the user can press retry.

## 5. Conversations and sidebar

- Store: `localStorage['subbuddy.conversations.v1']` = `Conversation[]`, newest first, capped at 50 conversations
  (oldest evicted). Every read/write in `try/catch`; a throwing store degrades to in-memory state.
- Title = first user message, trimmed to 60 chars on a word boundary. Rename via double-click/`Enter` on the item;
  delete via a trash button (`confirm()` is enough).
- Sidebar: "New chat" button (`Ctrl/Cmd+Shift+O`), list of `<a href="/?c=<id>">` items with title and relative time,
  active item marked `aria-current="page"`. Below the list: nav links Settings, Logs, and the Testnet badge.
- New chat = create conversation lazily on first send (an empty conversation is not persisted).

## 6. Existing `data-testid`s and e2e moves

Keep every testid where the element survives; move the rest with the element. Nothing is renamed.

| Testid | Lives on | Change |
| --- | --- | --- |
| `network-badge`, `hub-notice` | `/` top bar (and Settings) | none |
| `wallet-address`, `Balances` list | `/settings` `WalletCard` | moved |
| `status` (+ `data-ui-state`) | newest assistant bubble, else composer idle line | same semantics |
| `answer`, `answer-markdown`, `usage` | assistant bubble | none |
| `payment-status`, `tx-hash`, `explorer-link`, "Copy transaction hash" | assistant footer on `/`; also `PaymentEvidence` on `/logs?route=` | unchanged on `/`; the two never render on the same page |
| `failure` | assistant bubble | none |
| `payment-evidence`, `selected-offer`, `quoted-cost`, `routing-mode`, `task-type`, `classifier-source`, `receipt`, `candidates`, `source` | `/logs?route=<id>` | moved |
| `history`, `history-state`, `history-task`, `history-tx`, `history-warning`, "Load more" | `/logs` | moved with the page |

Assertions that must move (file: line → new location):

- `route.spec.ts:191-193` wallet address + Balances → `/settings`. `network-badge` stays on `/`.
- `route.spec.ts:196-201` mode radios + ArrowRight, `Max cost` value, `RLUSD` suffix → `/settings`; the test then
  navigates back to `/` (settings persist) before sending. `Prompt` label (`aria-label="Prompt"` on the textarea) and
  the button name `Route and Run` are kept on the composer (FR-091 names the action), so `:195` and `:205-206` stand.
- `route.spec.ts:214-215` `answer` stays; `receipt` → `/logs?route=route_e2e_1` (follow the footer `details` link).
- `route.spec.ts:222-225` `selected-offer`, `quoted-cost` → `/logs?route=`.
- `route.spec.ts:228-235` `payment-evidence` container, `not.toContainText(/fee/)` → `/logs?route=`; `payment-status`,
  `tx-hash`, `explorer-link`, Copy button can be asserted on the footer first and again on Logs.
- `route.spec.ts:241-252` `candidates` table → `/logs?route=`.
- `history.spec.ts:96-100` `hub-notice` and enabled `Route and Run` on `/` stay; `:99` link name `History` → `Logs`,
  `toHaveURL(/\/logs$/)`. `:134-136` row link → `/\/logs\?route=route_h1$/`.
- `outcome-unknown.spec.ts:201-207, 217-218` stay on `/` (footer). `:223-224` `routing-mode`, `classifier-source` →
  `/logs?route=`.
- Both 360 px overflow checks stay and gain one more on `/logs?route=` (the candidate table scrolls inside its own
  `overflow-x-auto`, as today).
- New: `conversations.test.ts` (Vitest) for `buildPrompt` cap/drop order and `titleFor`; one e2e that sends two turns
  and asserts the second `POST /v1/routes` body starts with `User: ` and contains the first answer.

## 7. Accessibility and 360 px

- Landmarks: `<nav aria-label="Conversations">` (sidebar), `<main>`, `<form aria-label="Prompt composer">`, message
  list as `<ol aria-label="Messages">` with `<li>` per message; each bubble names its author visually and via sr-only.
- Live regions: exactly one `role="status" aria-live="polite"` (the in-flight status line); failures are `role="alert"`
  (existing `FailurePanel`). Do not make the whole message list live.
- Keyboard: `Enter` sends, `Shift+Enter` newline, `Escape` closes the mobile drawer; every control has a visible
  `focus-visible:outline-2 outline-indigo-600` (existing classes). Composer is disabled, not hidden, while busy.
  Focus returns to the textarea after a send completes.
- Sidebar on < 768 px: hidden by default; the ☰ button (`aria-expanded`, `aria-controls`) opens it as a `<dialog>`
  overlay (native focus trap, Escape, backdrop). On ≥ 768 px it is a static column, toggleable, never a dialog.
- Bubbles are `max-w-[85%]` on mobile, `max-w-2xl` on desktop; long hashes use `break-all`; code blocks and tables
  scroll inside `overflow-x-auto` with `tabIndex={0}` so the body never scrolls horizontally (NFR-008).
- Footer on 360 px wraps to two lines (`flex-wrap gap-x-2`); the explorer link text is "explorer" not the URL.
- Colour is never the only signal: state pills keep their text; step icons keep sr-only status words.
- Respect `prefers-reduced-motion`: the `▍` pulse and step pulse use `motion-safe:animate-pulse`.

## 8. Wireframes

Desktop (≥ 768 px):

```text
┌──────────────┬──────────────────────────────────────────────────────────────────┐
│ SubBuddy     │ ☰  Query plan review        [XRPL Testnet] 4.9938 RLUSD  ⚙ Logs │
│ [+ New chat] │ [hub-notice: Hub discovery unavailable, curated registry only]   │
│──────────────│                                                                  │
│ ● Query plan │                         ┌──────────────────────────────────────┐ │
│   review     │                         │ Explain this distributed query plan… │ │
│   Dijkstra   │                         └──────────────────────────────────────┘ │
│   Summary    │ ┌──────────────────────────────────────────────────────────────┐ │
│              │ │ ● ● ● ● ◔ ○  Paying 0.006000 RLUSD to Fast Code on Testnet… │ │
│              │ │ ▍                                                            │ │
│              │ └──────────────────────────────────────────────────────────────┘ │
│              │ ┌──────────────────────────────────────────────────────────────┐ │
│              │ │ ## Most expensive operation  (markdown answer)               │ │
│              │ │ ```sql … ``` [copy]                                          │ │
│              │ │ 15 in · 220 out · 1830 ms                                    │ │
│              │ │ 0.006200 RLUSD · Fast Code · Validated · 4F930E96…909C4D     │ │
│              │ │ [Copy] [explorer] · details                                  │ │
│              │ └──────────────────────────────────────────────────────────────┘ │
│──────────────│                                                                  │
│ Settings     │ ┌──────────────────────────────────────────────────────────────┐ │
│ Logs         │ │ Message SubBuddy…                              [Route and Run]│ │
│ XRPL Testnet │ └──────────────────────────────────────────────────────────────┘ │
│              │   Balanced · ≤ 0.020000 RLUSD · Settings        one paid route  │
└──────────────┴──────────────────────────────────────────────────────────────────┘
```

Mobile (360 px):

```text
┌─────────────────────────────────┐   ┌─────────────────────────────────┐
│ ☰  SubBuddy   [Testnet] 4.99 RL │   │ ✕ Conversations                 │
│ hub-notice (one line, truncates)│   │ [+ New chat]                    │
│                                 │   │ ● Query plan review      2m     │
│      ┌────────────────────────┐ │   │   Dijkstra               1h     │
│      │ Explain this query…    │ │   │   Summary                1d     │
│      └────────────────────────┘ │   │                                 │
│ ┌────────────────────────────┐  │   │ ─────────────────────────────── │
│ │ ●●●●◔○ Paying 0.006000     │  │   │ Settings                        │
│ │ RLUSD to Fast Code…        │  │   │ Logs                            │
│ │ ▍                          │  │   │ XRPL Testnet                    │
│ └────────────────────────────┘  │   └─────────────────────────────────┘
│ ┌────────────────────────────┐  │        (<dialog> drawer, Escape / ✕)
│ │ answer markdown…           │  │
│ │ 0.006200 RLUSD · Fast Code │  │   /logs?route=<id> (mobile): stacked
│ │ Validated · 4F93…9C4D      │  │   cards in the order Timeline, Selected
│ │ [Copy] [explorer] · details│  │   offer, XRPL payment, Economic receipt,
│ └────────────────────────────┘  │   Candidates (table scrolls inside).
│ ┌──────────────────────────┬─┐  │
│ │ Message SubBuddy…        │↑│  │   /settings (mobile): single column,
│ └──────────────────────────┴─┘  │   mode radios 2×2, then max cost, output
│ Balanced · ≤ 0.020000 RLUSD ⚙   │   limit, mandate TTL, wallet, hub status.
└─────────────────────────────────┘
```

Settings and Logs pages are plain stacked cards (`max-w-3xl`) inside the same shell; no wireframe needed beyond the
component order in §2 and §3.

## 9. Component and file plan

```text
apps/web/app/
  layout.tsx                    RootLayout: <Shell> around children (sidebar + top bar), globals.css
  page.tsx                      Chat route; Suspense boundary (useSearchParams) → <ChatView />
  settings/page.tsx             <SettingsForm /> + <WalletCard /> + <HubStatus />
  logs/page.tsx                 ?route= ? <RouteDetail routeId /> : <RouteList />  (Suspense)
  history/page.tsx              redirect('/logs')  — one line, keeps old links alive
  health/route.ts               unchanged
  components/
    Shell.tsx                   'use client'. Sidebar visibility (localStorage 'subbuddy.sidebar'), <dialog> on mobile,
                                top bar: ☰, conversation title, network-badge + first balance, links ⚙ Settings, Logs,
                                hub-notice line. Hotkeys Ctrl/Cmd+Shift+O/L/S.
    Sidebar.tsx                 New chat, conversation list (rename/delete), nav links, Testnet badge.
    chat/ChatView.tsx           Owns the selected conversation + useRoute(); renders MessageList, ChatComposer, idle
                                status line. Replaces RouterApp.tsx (delete it).
    chat/MessageList.tsx        <ol> of UserBubble / AssistantBubble; auto-scroll + scroll-to-bottom button.
    chat/UserBubble.tsx         Plain text, right-aligned, preserves newlines (whitespace-pre-wrap).
    chat/AssistantBubble.tsx    Compact Timeline + status (newest only carries testid), ▍ placeholder, Answer markdown,
                                usage, footer (cost · seller · model · payment-status · tx-hash · Copy · explorer ·
                                details), FailurePanel when failed.
    chat/ChatComposer.tsx       Textarea (aria-label "Prompt", field-sizing-content, Enter/Shift+Enter, IME guard),
                                "Route and Run" button, settings chip, validation error. Replaces Composer.tsx.
    chat/EmptyState.tsx         Brand + one-line thesis + three example prompts (buttons that fill the composer).
    chat/CodeBlock.tsx          Header (language, Copy) around <pre>; wired into the MD `pre` renderer.
    logs/RouteList.tsx          Today's history/page.tsx body, links to /logs?route=.
    logs/RouteDetail.tsx        GET /v1/routes/:id (+ offers) → Timeline, SelectedOfferCard, PaymentEvidence,
                                ReceiptDetails (open), CandidateTable, FailurePanel copy (no buttons), Back to chat.
    settings/SettingsForm.tsx   Mode radiogroup, max cost + asset, output limit, mandate TTL row; writes settings store.
    settings/WalletCard.tsx     WalletBar.tsx renamed and moved; unchanged markup and testids.
    settings/HubStatus.tsx      registryVersion, offer count, hubStatus reasons.
    Timeline.tsx                + `compact` prop (icons only, labels sr-only). Otherwise unchanged.
    Result.tsx                  Unchanged exports; MD map gains CodeBlock for `pre`. Answer/FailurePanel reused by bubbles.
    CandidateTable.tsx          Unchanged.

apps/web/src/lib/
  api.ts                        Unchanged.
  route-ui.ts                   Unchanged; add `footerSummary(evidence, selected)` → the assistant `summary` shape.
  use-route.ts                  useRoute(): state + submit/execute/follow/resume lifted verbatim from RouterApp.
                                Emits { routeState, route, detail, events, error, errorCode, ui, evidence, selected }.
  conversations.ts              Store (load/save/upsert/remove, cap 50), titleFor(), buildPrompt(messages, next,
                                max = PROMPT_MAX_CHARS), useConversations() via useSyncExternalStore.
  conversations.test.ts         buildPrompt: first turn verbatim; later turns formatted; oldest dropped first; new
                                message never dropped; failed turns skipped. titleFor: 60-char word boundary.
  settings.ts                   Defaults, load/save, useSettings(); validates maxCost with RouteRequest.shape.maxCost.
```

Rules carried over from `RouterApp`: `RouteRequest.safeParse` before any network call; money stays a decimal string;
a 4xx from `execute` (not `NETWORK_ERROR`) means no money moved → `stateForError`; any 5xx or transport loss →
`OUTCOME_UNKNOWN` and poll, never claim failure (NFR-003). `isTerminal` stays the local mirror (Turbopack barrel note).

Out of scope for this pass: token streaming (the API returns whole results), message editing/regeneration, search over
conversations, server-side conversation storage, dark mode.
