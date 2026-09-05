// Workflow 4: chat-first UI (settings + logs pages, chatbot-ui inspired) and a dummy XRPL AI Hub for live
// discovery. Runs in a separate git worktree on a feature branch; opens a PR to main at the end.
//   Workflow({ scriptPath: ".claude/workflows/chat-and-hub.js", args: { root, branch, issueRepo } })

export const meta = {
  name: 'chat-and-hub',
  description: 'Study chatbot-ui, rebuild the web app as chat + settings + logs, add a dummy XRPL AI Hub with live discovery, integrate, open a PR',
  phases: [
    { title: 'Build', detail: 'study chatbot-ui -> chat UI (pipeline) in parallel with the dummy hub + live discovery' },
    { title: 'Integrate', detail: 'typecheck, tests, e2e, screenshots of the new UI, commit, push branch, open PR' },
  ],
}

const ROOT = args.root
const BRANCH = args.branch ?? 'feat/chat-ui-hub'
const ISSUE_REPO = args.issueRepo ?? 'Reallyeasy1/Kevin'

const COMMON = `Repository worktree: ${ROOT} (branch ${BRANCH}; a separate git worktree of the SubBuddy repo, so the main checkout and its running demo are untouched). Spec: ${ROOT}/PRD_SPECS.md. Read ${ROOT}/CLAUDE.md, ${ROOT}/README.md, ${ROOT}/docs/ARCHITECTURE.md first. The MVP works end to end (see docs/EVIDENCE.md).

Local environment facts:
- ${ROOT}/.env exists (gitignored, funded Testnet wallet). NEVER print AGENT_WALLET_SEED or any *_API_KEY. The dev:* scripts load .env via scripts/with-env.mjs.
- The MAIN checkout's services occupy ports 4010 (api), 4020 (seller), 3100 (web), and Postgres is on 5433. Do not kill them. If you need to run services from this worktree, use API_PORT=4110, SELLER_PORT=4120 (also set SELLER_BASE_URL=http://localhost:4120 and NEXT_PUBLIC_API_BASE_URL=http://localhost:4110 in the process env, not in .env), web on 3200 (\`node scripts/with-env.mjs pnpm --filter @subbuddy/web exec next dev --webpack --port 3200\`), and Playwright with WEB_PORT=3277. The shared Postgres on 5433 can be reused.
- Windows host: bash-compatible commands, prefer node scripts. Relative imports need .js extensions (NodeNext). TypeScript strict. Money is decimal strings, never number arithmetic.

Hard rules:
- Never create or edit .env or .env.* except .env.example. Never put a seed, key or token in source, tests, docs or screenshots.
- Do NOT run \`pnpm install\` unless you are the integrate agent; if you need a dependency, add it pinned to the owning package.json and list it in depsToInstall.
- Work only inside your assigned directories; another agent edits sibling directories concurrently.
- Keep the §11 API wire contract backward compatible; extend additively.
- Do not git commit or push unless told to.
- Run \`pnpm typecheck\` and \`pnpm test\` before returning where you changed code; report real results.
- Return a concise report: files created/changed, commands run and results, deps to install, anything unfinished.`

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    depsToInstall: { type: 'array', items: { type: 'string' } },
    testsPassing: { type: 'boolean' },
    unfinished: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'files', 'depsToInstall', 'testsPassing', 'unfinished'],
}

const agentRetry = async (prompt, opts) => {
  const r = await agent(prompt, opts)
  if (r) return r
  log(`${opts.label}: agent failed to start or died, retrying once`)
  return agent(prompt, { ...opts, label: `${opts.label}:retry` })
}

phase('Build')

// Stream A: study chatbot-ui, then rebuild the web app (pipeline: brief -> build).
const webStream = (async () => {
  const brief = await agentRetry(`${COMMON}

You own docs/design/ only. Clone https://github.com/mckaywrigley/chatbot-ui.git into ${ROOT}/../.chatbot-ui-ref (shallow, --depth 1; delete nothing in the repo; this folder is outside the worktree). Study its Next.js chat interface: layout (sidebar with conversation list, message pane, composer), message rendering (markdown, code blocks, streaming placeholder), empty state, mobile behaviour, keyboard handling, and how settings are surfaced. Ignore its auth, Supabase, multi-provider plumbing and anything we do not need.

Write ${ROOT}/docs/design/CHAT_UI_BRIEF.md: a build brief for OUR web app (Next.js 16 app router, Tailwind 4, react-markdown already installed, no new UI libraries unless truly needed — list any you recommend with a one-line reason). Specify: (1) the three routes: / = chat, /settings, /logs (keep /history working or fold it into /logs); (2) what moves off the main page into Settings: routing mode, max cost + asset, output limit, mandate TTL display, wallet details, hub status; (3) what moves into Logs: per-route timeline, candidate table, economic receipt, payment evidence, history list — each chat message links to its log entry by routeId; (4) the chat message model: each user message creates one paid route (POST /v1/routes then execute) using the existing API; the prompt sent to the seller = a compact transcript of the conversation so far plus the new message (cap by PROMPT_MAX_CHARS 32000, oldest turns dropped first); the assistant bubble shows the markdown answer, and a small footer with cost, seller, tx hash short + explorer link, "details" link to /logs?route=<id>, and the state while in flight (classifying, quoting, paying, verifying) reusing the existing timeline copy; failure bubbles reuse failureCopy so they say whether money moved; (5) conversations persist in localStorage (id, title from first message, messages with routeIds); sidebar lists them; new chat button; (6) keep every existing data-testid used by tests/e2e/*.spec.ts where the element still exists, and list which e2e assertions must move to /logs or /settings; (7) accessibility and 360px behaviour; (8) a component/file plan under apps/web/app and apps/web/src with responsibilities. Include ASCII wireframes for desktop and mobile. Keep it under 400 lines.`,
    { label: 'study:chatbot-ui', phase: 'Build', schema: REPORT_SCHEMA, effort: 'medium' })
  log(`brief: ${brief?.summary?.slice(0, 160) ?? 'FAILED'}`)

  return agentRetry(`${COMMON}

You own apps/web and tests/e2e. Implement ${ROOT}/docs/design/CHAT_UI_BRIEF.md (read it fully first; if it conflicts with the PRD, the PRD wins and you note the deviation). Deliver: / as the chat interface, /settings, /logs (with ?route=<id> deep link and the history list), the conversation store in localStorage, per-message paid routes through the existing API client in apps/web/src/lib/api.ts (extend it additively), in-flight state and failure copy reuse, markdown answers via the existing react-markdown setup, source labels and the hub status notice moved to Settings (and a one-line unobtrusive indicator in the chat header). Keep the wallet bar or its equivalent visible in the chat header (address short, network badge, balances) because the demo needs it. Preserve keyboard operability and 360px usability.

Tests: update tests/e2e/*.spec.ts so the three existing flows (mocked route, history, OUTCOME_UNKNOWN badge) pass against the new layout — assertions about the receipt/timeline/candidates now go through /logs?route=<id>; add one new spec: a two-message conversation where the second prompt sent to POST /v1/routes contains the first exchange (assert on the mocked request body). Keep unit tests green. Run \`pnpm --filter @subbuddy/web typecheck\`, \`npx vitest run apps/web\`, and \`WEB_PORT=3277 pnpm test:e2e\` (production build; the Playwright config already builds). Do not change apps/api or packages/*; if you need an API field, report it as unfinished with the exact shape.`,
    { label: 'build:chat-ui', phase: 'Build', schema: REPORT_SCHEMA, effort: 'high' })
})()

// Stream B: dummy XRPL AI Hub + live discovery.
const hubStream = agentRetry(`${COMMON}

You own apps/hub (new), packages/config, apps/seller, .env.example, and docs/ARCHITECTURE.md (hub section only). Goal: make FR-021 discovery LIVE in the demo so the "Hub discovery unavailable" notice disappears and hub-discovered offers appear in the candidate set with source "xrpl-ai-hub".

1. apps/hub: a tiny dummy XRPL AI Hub (Node 22 + Fastify, already a workspace dep, or plain node:http), package @subbuddy/hub, \`pnpm dev:hub\` (root script via scripts/with-env.mjs), HUB_PORT default 4030. GET /health and GET /api/listings returns a JSON array of Testnet listings in the same record shape as packages/config/hub-offers.json (hubServiceId, hubUrl, displayName, endpoint, payTo, network "xrpl:1", asset "RLUSD", price, capabilities, plus contextWindow/latency/quality hints if the schema has them). Ship 4-6 listings that are PURCHASABLE in the demo: they point at the demo seller (SELLER_BASE_URL + /v1/inference/<offerId>) with distinct offerIds such as hub-greenhead-chat, hub-swarm-research, hub-clawbank-story, hub-sciphr-verify, distinct prices and capability sets, payTo = SELLER_PAYTO_ADDRESS. Include one deliberately invalid record (Mainnet network) so the skip path is exercised, and document it. Also GET /listing/<id> returning a small HTML page so hubUrl links resolve locally.
2. packages/config: XrplAiHubRegistry gains a live mode: when HUB_URL is set, fetch \`\${HUB_URL}/api/listings\` at startup with a 3 s timeout and a 256 KB cap; on success use those records (validated exactly like the JSON import; invalid ones skipped with logged reasons), on any failure fall back to hub-offers.json and set hubStatus.available=false with the reason. Keep hubStatus {available, imported, skipped, reasons} and add source: 'live' | 'import'. Add HUB_URL (optional) and HUB_PORT to the env schema and .env.example with comments. The api reads the merged registry already; make sure GET /v1/offers shows hub offers with source 'xrpl-ai-hub' when live (touch apps/api ONLY if strictly required, and report it).
3. apps/seller: it must accept and price the hub offerIds. Today it prices from the curated offers built from env; add a way for the seller to also load the hub listings (fetch HUB_URL/api/listings at startup with the same fallback, or read them from packages/config's registry) so POST /v1/inference/hub-* returns a correct 402 quote at the listing's price and, once paid, runs the same upstream. Keep SEC-003 allowlisting: the api pays only registry offers.
4. Tests: config live-fetch success/timeout/fallback/invalid-record-skip with a mocked fetch; hub route tests; seller quote for a hub offer. Update docs/ARCHITECTURE.md "mocked vs live" table: "hub discovery: live against the dummy hub (apps/hub) standing in for xrpl-ai.org; the real hub lists Mainnet services, excluded under APP_ENV=hackathon".
5. Prove it: start the hub on 4030, the seller on 4120 and the api on 4110 from this worktree with HUB_URL=http://localhost:4030 in the process env, call GET /v1/offers and show hub offers with source xrpl-ai-hub and hubStatus.available true; create one route with a prompt that should select a hub offer and reach QUOTED (do NOT execute; no payment). Stop the processes you started. Report the exact commands.`,
  { label: 'build:dummy-hub', phase: 'Build', schema: REPORT_SCHEMA, effort: 'high' })

const [web, hub] = await Promise.all([webStream, hubStream])
log(`chat-ui: ${web?.summary?.slice(0, 160) ?? 'FAILED'}`)
log(`hub: ${hub?.summary?.slice(0, 160) ?? 'FAILED'}`)
const reports = [web, hub].filter(Boolean)

phase('Integrate')
const integrate = await agent(`${COMMON}

You are the integrate agent. Two agents just finished:
${reports.map(r => `- ${r.summary.slice(0, 1200)}\n  deps to install: ${r.depsToInstall.join(', ') || 'none'}\n  unfinished: ${r.unfinished.join('; ') || 'none'}`).join('\n')}

Do, in order:
1. Install any listed deps pinned; run \`pnpm install\` in ${ROOT}.
2. Run \`pnpm lint\`, \`pnpm typecheck\`, \`pnpm test\`, then \`WEB_PORT=3277 pnpm test:e2e\`. Fix cross-package drift with the smallest change. The web Settings page should show hub status from GET /v1/offers, and candidates should show source "xrpl-ai-hub" for hub offers.
3. Start hub (4030), seller (4120), api (4110, HUB_URL=http://localhost:4030) and web (3200) from this worktree with the port overrides in the process env; with Playwright take docs/screenshots/chat-01-empty.png, chat-02-conversation.png (send ONE message that selects a hub offer if possible — this spends one small RLUSD payment; if the wallet balance is below 0.05 RLUSD skip execution and screenshot the quoted state), settings-01.png, logs-01.png. Stop your processes afterwards.
4. Update README.md: the UI section (chat, settings, logs), the hub section (dummy hub stands in for xrpl-ai.org on Testnet; \`pnpm dev:hub\`; HUB_URL), and docs/DEMO.md steps to match the new layout. Do not touch docs/EVIDENCE.md transaction rows except to add a row if you executed a payment.
5. Confirm no secret is staged. Commit on ${BRANCH} as "Chat-first UI (settings + logs) and live hub discovery via dummy XRPL AI Hub" and push the branch. Open a pull request to main with \`gh pr create -R ${ISSUE_REPO} --base main --head ${BRANCH}\` titled the same, body: what changed, how to run, screenshots list, test results, and "Generated with Claude Code". Report the PR URL in your summary. Do NOT merge.`,
  { label: 'integrate+pr', phase: 'Integrate', schema: REPORT_SCHEMA, effort: 'medium' })
log(`integrate: ${integrate?.testsPassing ? 'green' : 'NOT green'} — ${integrate?.summary?.slice(0, 160)}`)

return {
  brief: 'docs/design/CHAT_UI_BRIEF.md',
  chatUi: web?.summary ?? null,
  hub: hub?.summary ?? null,
  integrated: integrate?.testsPassing ?? false,
  integrateSummary: integrate?.summary ?? null,
  unfinished: [web, hub, integrate].filter(Boolean).flatMap(r => r.unfinished),
}
