// Workflow 4 (lean): chat-first UI with settings + logs pages and persisted sessions, plus a dummy XRPL AI Hub
// for live discovery. Runs in a separate git worktree on a feature branch; opens a PR to main.
//   Workflow({ scriptPath: ".claude/workflows/chat-and-hub.js", args: { root, branch, issueRepo } })

export const meta = {
  name: 'chat-and-hub',
  description: 'Chat UI (settings + logs, persisted sessions) and a dummy XRPL AI Hub with live discovery, in parallel; then tests, commit, push, PR',
  phases: [
    { title: 'Build', detail: 'chat UI and dummy hub in parallel (disjoint dirs)' },
    { title: 'Integrate', detail: 'typecheck, tests, e2e, commit, push branch, open PR' },
  ],
}

const ROOT = args.root
const BRANCH = args.branch ?? 'feat/chat-ui-hub'
const ISSUE_REPO = args.issueRepo ?? 'Reallyeasy1/Kevin'

const COMMON = `Repository worktree: ${ROOT} (branch ${BRANCH}; a separate git worktree, so the main checkout and its running demo are untouched). Spec: ${ROOT}/PRD_SPECS.md. Skim ${ROOT}/README.md and ${ROOT}/docs/ARCHITECTURE.md; the MVP works end to end.

Environment:
- ${ROOT}/.env exists (gitignored). NEVER print AGENT_WALLET_SEED or any *_API_KEY. dev:* scripts load .env via scripts/with-env.mjs.
- The MAIN checkout's services occupy 4010 (api), 4020 (seller), 3100 (web); Postgres 5433 is shared. Never kill them. From this worktree use API_PORT=4110, SELLER_PORT=4120 with SELLER_BASE_URL=http://localhost:4120 and NEXT_PUBLIC_API_BASE_URL=http://localhost:4110 set in the PROCESS env (not .env), web on 3200, Playwright WEB_PORT=3277.
- Windows host: bash-compatible commands, node scripts over shell tricks. NodeNext: relative imports need .js. TypeScript strict. Money is decimal strings.

Hard rules:
- Never create or edit .env* except .env.example. No seeds/keys in source, tests or docs.
- Do NOT run pnpm install unless you are the integrate agent; list new deps in depsToInstall (prefer none).
- Work only inside your assigned directories; another agent edits sibling directories concurrently.
- Keep the §11 API wire contract backward compatible.
- Do not git commit or push unless told to.
- SPEED MATTERS: the whole workflow must finish in ~30 minutes. Reuse existing components and helpers; move code rather than rewrite it; minimal styling; no new libraries. Run only the checks named in your task.
- Return a concise report: files changed, commands run and results, deps to install, anything unfinished.`

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
const JOBS = [
  {
    key: 'chat-ui', dirs: 'apps/web and tests/e2e',
    task: `A shallow clone of chatbot-ui sits at ${ROOT}/../.chatbot-ui-ref for layout reference (skim its components/chat and sidebar for 2 minutes at most; copy ideas, not code). Turn the single-page router UI into a chat-first app in the style of chatbot-ui (mckaywrigley): left sidebar with the conversation list and a "New chat" button, a message pane, and a composer at the bottom. Three routes:
- / = chat. Header keeps the existing wallet bar (address short, Testnet badge, balances) plus links to Settings and Logs, and a one-word hub indicator ("hub: live" / "hub: curated only") from GET /v1/offers hubStatus. Each user message creates ONE paid route with the existing api client (POST /v1/routes then execute, then follow SSE/poll exactly as RouterApp does today — reuse RouterApp's follow/submit logic by extracting it into a hook or module, do not rewrite it). The prompt sent = a compact transcript of this conversation ("User: ...\\nAssistant: ...\\n" for prior turns, then the new message), capped at PROMPT_MAX_CHARS (32000) by dropping the oldest turns first. The assistant bubble renders the markdown answer (react-markdown is already wired in Result.tsx) and a footer line: cost + asset, seller name, tx hash short with explorer link, and a "details" link to /logs?route=<id>. While in flight the bubble shows the existing timeline step copy (Classify, Compare, Quote, Approve, Settle, Execute). Failures reuse failureCopy so the bubble states whether money moved.
- SESSION HISTORY (required): conversations persist in localStorage under one key: { id, title (first 40 chars of the first message), createdAt, messages: [{ role, text, routeId?, cost?, txHash?, state? }] }. On load, restore the list and the last open conversation; the sidebar switches between them; deleting a conversation is fine to skip. Because every assistant turn has a routeId, a "Reload from server" action on a message may re-fetch GET /v1/routes/:id, but that is optional.
- /settings = the controls that used to sit above the prompt: routing mode (4 modes), max cost + asset, output limit, mandate TTL note, plus wallet details and the hub status block with reasons. Persist settings in localStorage; the chat composer reads them.
- /logs = the existing Result/Timeline/Candidates/Receipt/PaymentEvidence components rendered for ?route=<id> (fetch GET /v1/routes/:id) and, without a route id, the existing history list (reuse the /history page's component; keep /history working as a redirect or alias).
Keep every existing data-testid where the element still exists; move, don't delete, components. Mobile: sidebar collapses behind a button at <768px; composer stays usable at 360px; keep keyboard operability.
Tests: update tests/e2e/*.spec.ts to the new layout (the mocked route flow now runs from the chat composer; receipt/timeline assertions go through /logs?route=<id>; the OUTCOME_UNKNOWN badge test asserts on the message footer or the /logs page). Add one spec: two messages in one conversation, assert the second POST /v1/routes body prompt contains the first exchange, then reload the page and assert both messages are still shown (session persistence). Run: pnpm --filter @subbuddy/web typecheck; npx vitest run apps/web; WEB_PORT=3277 pnpm test:e2e. Do not edit apps/api or packages/*.`,
  },
  {
    key: 'dummy-hub', dirs: 'apps/hub (new), packages/config, apps/seller, .env.example, root package.json scripts, docs/ARCHITECTURE.md hub row',
    task: `A previous agent left UNCOMMITTED partial work in exactly your directories (run "git status" and "git diff" first): keep what is correct, finish it, do not start over. Make FR-021 discovery LIVE so the "Hub discovery unavailable" notice goes away and hub-discovered offers appear with source "xrpl-ai-hub":
1. apps/hub: package @subbuddy/hub, plain node:http or Fastify (already in the workspace), HUB_PORT default 4030, scripts dev (tsx) and typecheck; root script "dev:hub" via scripts/with-env.mjs. GET /health; GET /api/listings -> JSON array in the SAME record shape as packages/config/hub-offers.json, 4 Testnet listings that are purchasable in the demo: endpoint = SELLER_BASE_URL + "/v1/inference/<offerId>" with offerIds hub-greenhead-chat, hub-swarm-research, hub-clawbank-story, hub-sciphr-verify, distinct prices (e.g. 0.003, 0.009, 0.004, 0.012 RLUSD) and capability sets, payTo = SELLER_PAYTO_ADDRESS, network xrpl:1, asset RLUSD; plus ONE invalid record (network xrpl:0) to exercise the skip path. GET /listing/<id> -> tiny HTML page so hubUrl links resolve.
2. packages/config: XrplAiHubRegistry live mode: when HUB_URL is set, fetch HUB_URL + "/api/listings" at startup (3 s timeout, 256 KB cap), validate records exactly like the JSON import (invalid -> skipped with reason), on ANY failure fall back to hub-offers.json with hubStatus.available=false and the reason. Add hubStatus.source: 'live' | 'import'. Add optional HUB_URL and HUB_PORT to the env schema and .env.example (commented example HUB_URL=http://localhost:4030). Because the registry is built at startup, buildMergedRegistry may need to become async or take pre-fetched records: pick the smallest change that keeps apps/api compiling (you may edit the one call site in apps/api/src/index.ts if unavoidable; report it).
3. apps/seller: price hub offerIds. The seller currently prices from buildCuratedOffers(env); make it use the merged registry (curated + live hub) so POST /v1/inference/hub-* returns a 402 at the listing's price and runs the same upstream once paid. Keep SEC-003: the api only pays registry offers, which now include validated hub offers.
4. Tests (small): config live fetch success / timeout fallback / invalid skip with a mocked fetch; seller 402 quote for a hub offer. Update the docs/ARCHITECTURE.md "mocked vs live" row for hub discovery.
5. Prove it (no payment): from this worktree start hub (4030), seller (4120) and api (4110) with HUB_URL=http://localhost:4030 and the port overrides in the process env; GET /v1/offers must list the 4 hub offers with source xrpl-ai-hub and hubStatus.available true, imported 4, skipped 1; POST /v1/routes with a prompt likely to pick a hub offer must reach QUOTED. Stop your processes. Run pnpm typecheck and npx vitest run packages/config apps/seller apps/hub.`,
  },
]

const results = await parallel(JOBS.map(j => () =>
  agentRetry(`${COMMON}\n\nYou own ${j.dirs}. ${j.task}`, { label: `build:${j.key}`, phase: 'Build', schema: REPORT_SCHEMA, effort: 'medium' })
))
results.forEach((r, i) => log(r ? `${JOBS[i].key}: ${r.summary.slice(0, 160)}` : `DROPPED: ${JOBS[i].key} failed twice`))
const reports = results.filter(Boolean)

phase('Integrate')
const integrate = await agent(`${COMMON}

You are the integrate agent. Two agents just finished:
${reports.map(r => `- ${r.summary.slice(0, 1200)}\n  deps to install: ${r.depsToInstall.join(', ') || 'none'}\n  unfinished: ${r.unfinished.join('; ') || 'none'}`).join('\n')}

Do, in order, fast:
1. Install listed deps (pinned) if any; \`pnpm install\` in ${ROOT}.
2. \`pnpm lint\`, \`pnpm typecheck\`, \`pnpm test\`, \`WEB_PORT=3277 pnpm test:e2e\`. Fix cross-package drift with the smallest change (likely the web Settings hub block vs the new hubStatus.source field).
3. README.md: replace the UI paragraph with three lines (chat at /, settings, logs with per-route deep links; sessions persist in the browser) and add \`pnpm dev:hub\` + HUB_URL to the run section. Two lines in docs/DEMO.md so the presenter starts the hub and types into the chat composer. Do not touch docs/EVIDENCE.md.
4. Confirm no secret is staged. Commit on ${BRANCH} as "Chat-first UI with persisted sessions, settings and logs pages; live hub discovery via dummy XRPL AI Hub", push the branch, and open a PR to main: \`gh pr create -R ${ISSUE_REPO} --base main --head ${BRANCH}\` with a body listing what changed, how to run (ports, dev:hub, HUB_URL), test results, and "Generated with Claude Code". Do NOT merge. Report the PR URL.`,
  { label: 'integrate+pr', phase: 'Integrate', schema: REPORT_SCHEMA, effort: 'medium' })
log(`integrate: ${integrate?.testsPassing ? 'green' : 'NOT green'} — ${integrate?.summary?.slice(0, 160)}`)

return {
  chatUi: results[0]?.summary ?? null,
  hub: results[1]?.summary ?? null,
  integrated: integrate?.testsPassing ?? false,
  integrateSummary: integrate?.summary ?? null,
  unfinished: [...reports, integrate].filter(Boolean).flatMap(r => r.unfinished),
}
