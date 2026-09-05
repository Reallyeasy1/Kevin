// Workflow 2: close the gaps build-mvp leaves — acceptance tests, live smoke script, hub discovery,
// API hardening, history page — then audit against PRD §21 Definition of Done.
// Run AFTER build-mvp finishes, with the same args:
//   Workflow({ scriptPath: ".claude/workflows/harden-mvp.js", args: { repo, root, prdPath, issues } })

export const meta = {
  name: 'harden-mvp',
  description: 'Acceptance tests, Testnet smoke script, XRPL AI Hub discovery, API hardening, history page; then a Definition-of-Done audit',
  phases: [
    { title: 'Gaps', detail: 'six agents in disjoint dirs: tests/, scripts/, packages/config, apps/api, apps/web, fixups' },
    { title: 'Integrate', detail: 'install missing deps, typecheck, test, commit, push' },
    { title: 'Audit', detail: 'PRD §21 definition-of-done audit; fix what is auto-fixable' },
  ],
}

const REPO = args.repo
const ROOT = args.root
const PRD = args.prdPath
const ISSUES = args.issues ?? []

const refs = (...areas) => {
  const nums = ISSUES.filter(i => areas.includes(i.area)).map(i => `#${i.number}`)
  return nums.length ? `Refs ${nums.join(' ')}` : ''
}
const byNumber = (...nums) => ISSUES.filter(i => nums.includes(i.number))
  .map(i => `- #${i.number} ${i.title} (${i.requirementIds.join(', ')})`).join('\n') || '(no issues mapped)'

const COMMON = `Repository root: ${ROOT} (git repo, branch main, remote ${REPO}). Spec: ${PRD} (source of truth; when it and any instruction here disagree, the PRD wins). Read ${ROOT}/CLAUDE.md, ${ROOT}/README.md and ${ROOT}/docs/ARCHITECTURE.md first: the monorepo, packages (@subbuddy/contracts, config, routing, payments, database) and apps (seller, api, web) already exist and have green typecheck and tests. Read the code you are extending before writing; reuse its schemas, fakes and helpers instead of inventing parallel ones.

Hard rules for every agent in this workflow:
- TypeScript strict. pnpm workspaces. Node 22. Windows host: bash-compatible commands, prefer node scripts over shell tricks. Relative imports need .js extensions (NodeNext).
- Money is a decimal string or decimal.js value; never number arithmetic on amounts.
- Never create or edit .env or .env.* except .env.example. Never put a wallet secret, API key, or token in source or tests (use xrpl.js Wallet.generate() at test time for throwaway keys).
- Do NOT run \`pnpm install\` or touch pnpm-lock.yaml; if you need a dependency, add it to the owning package.json and list it in depsToInstall.
- Work only inside the directories you are assigned. Other agents are editing sibling directories concurrently.
- No live network in tests. Live Testnet code lives only in scripts/ and is run manually.
- Do not git commit or push unless your instructions say so.
- Run \`pnpm typecheck\` and \`pnpm test\` before returning; report their real results.
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

// ponytail: agent() resolves null when a spawn dies; one retry beats silently dropping a job.
const agentRetry = async (prompt, opts) => {
  const r = await agent(prompt, opts)
  if (r) return r
  log(`${opts.label}: agent failed to start or died, retrying once`)
  return agent(prompt, { ...opts, label: `${opts.label}:retry` })
}

// ---------------- Gaps (parallel, disjoint dirs) ----------------
phase('Gaps')
const JOBS = [
  {
    key: 'acceptance-tests', dirs: 'tests/ (create tests/acceptance and tests/fakes)', effort: 'high',
    task: `Make PRD §17 executable: one Vitest file per AT-001..AT-012 under tests/acceptance, driven through the buyer API's public HTTP contract (§11) using Fastify inject or fetch against an in-process server. Build tests/fakes once: in-memory ProviderRegistry with the three curated offers, fake seller HTTP server (402 then paid 200, invoice-idempotent, model-invocation counter), fake PaymentClient/WalletSigner that record sign calls, in-memory database repository, stub classifier. apps/api is being edited concurrently by another agent: depend only on its exported buildApp/createApp factory and the §11 wire contract, never on internals; if the factory does not accept injected adapters, report exactly what signature you need as unfinished rather than editing apps/api.
Each AT test asserts the Given/When/Then of its section literally (state names, error codes, "sign called exactly once", "model invoked 0 then 1", no second payment after PAID_EXECUTION_FAILED, mutated promptHash rejected before signing, no commission payment row, explorer URL = XRPL_EXPLORER_BASE + hash). AT-001 live variant and AT-011 live evidence are manual: mark them test.skip with the manual procedure in a comment pointing at scripts/smoke-testnet.ts. Add NFR-005 ranking snapshot test and NFR-001 routing latency budget test (mocked, p95 < 2s over 20 runs). Make sure vitest.config.ts include globs pick up tests/acceptance (edit only that include array if needed).`,
    issues: [33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 56, 63, 79, 80, 82],
  },
  {
    key: 'live-smoke', dirs: 'scripts/ and docs/LIVE_SMOKE.md', effort: 'medium',
    task: `Write scripts/smoke-testnet.ts (run with \`pnpm smoke:testnet\`; add that script to root package.json — the only root file you may edit) implementing the §18.3 manual live Testnet happy path end to end against locally running seller + api: (1) load env via @subbuddy/config validation, refuse unless APP_ENV=hackathon and network is Testnet; (2) print agent wallet address, XRP and RLUSD balances via xrpl.js, and fail with the exact faucet instructions (XRP faucet, RLUSD faucet https://tryrlusd.com/, trust line) if underfunded; (3) POST /v1/routes with a coding prompt, mode balanced, maxCost from argv; (4) POST execute; (5) follow SSE or poll GET until terminal; (6) print the receipt, transaction hash, and explorer link, and fetch the tx from the ledger to confirm validated tesSUCCESS, destination and amount match the receipt (AT-011); (7) run POST execute a second time and assert the same routeId returns the same payment with no new hash (AT-005 live); (8) print a ready-to-paste markdown row for docs/EVIDENCE.md. Never print the seed. Exit non-zero on any mismatch. Write docs/LIVE_SMOKE.md: prerequisites, exact commands, what each step proves, and a troubleshooting table (tecPATH_DRY = missing trust line, tecUNFUNDED, facilitator 5xx, LastLedgerSequence expiry). Unit-test the pure helpers (argv parsing, receipt-vs-ledger comparison) with a mocked client.`,
    issues: [44, 47],
  },
  {
    key: 'hub-discovery', dirs: 'packages/config', effort: 'medium',
    task: `Implement FR-021 P1 XrplAiHubRegistry in packages/config exactly as specified: build-time import from packages/config/hub-offers.json. Use WebFetch/WebSearch on https://xrpl-ai.org/ to capture 5-10 real current listings into hub-offers.json (fields: hubServiceId, hubUrl, endpoint, payTo, network as CAIP-2, asset, price, capabilities; leave unknowns null and let validation skip them). Normalise into the FR-020 offer schema plus source/hubServiceId/hubUrl. Invalid records are skipped with a logged reason (never a startup error). Filter to the configured network and settlement asset; under APP_ENV=hackathon Mainnet listings are excluded. Export a MergedRegistry: CuratedRegistry ∪ XrplAiHubRegistry deduplicated by endpoint, curated fields win, registryVersion hashes the merged set (INV-010), and a hubStatus {available:boolean, imported:number, skipped:number, reasons:string[]} for the UI notice. Endpoint and payTo enter the allowlist only after validation (SEC-003). Keep the existing CuratedRegistry API unchanged so routing and api keep compiling. Tests: invalid record skipped, Mainnet excluded under hackathon, dedupe with curated precedence, deterministic version, empty hub file → available:false and curated-only.`,
    issues: [5, 4],
  },
  {
    key: 'api-hardening', dirs: 'apps/api', effort: 'medium',
    task: `Harden the Fastify buyer API per PRD §14 and §19 without changing the §11 wire contract: (a) bounded pre-payment retry to the next eligible offer on quote failure, max 3 attempts, then NO_ELIGIBLE_OFFER (§14, INV-004); (b) execution continues after client disconnect and GET /v1/routes/:id reflects the terminal state (§14); (c) outbound HTTP timeouts and response-size limits for seller and classifier calls (SEC-004); (d) every log line and SSE event carries routeId, requestId, invoiceId, offerId, transactionHash when known, normalized state, timestamp (§19); (e) in-process metrics counters for every §19 metric exposed at GET /metrics (Prometheus text format, no new dependency, auth-protected like other routes); (f) GET /v1/routes?limit=&cursor= listing completed routes (id, createdAt, state, selected offer, quoted cost, settled amount, transactionHash) for US-010 — add the repository query in packages/database ONLY if no list method exists, as the single exception to your directory scope; (g) GET /v1/offers includes each offer's source and the registry's hubStatus if @subbuddy/config exports one (guard with a feature check so you compile whether or not the hub agent has landed). If buildApp does not already accept injected adapters (registry, paymentClient, signer, repository, classifier), add an options object with defaults so tests can inject fakes — the acceptance-test agent depends on this. Tests: retry-then-give-up, disconnect continuation, timeout mapped to safe error, metrics increment, routes listing pagination.`,
    issues: [65, 68, 71, 76, 77],
    extra: `Also close two low reviewer findings in apps/api/src/service.ts: (1) around line 534 the SEC-005 pre-signing revalidation compares the requirement to a copy of itself — compare the ExactPayment about to be signed against the STORED quote row (amount, payTo, asset, network, invoiceId) instead; (2) around line 813 requirementFor rebuilds the wire requirement after a restart from the Decimal(20,6) row and a rounded maxTimeoutSeconds — persist the exact wire strings (or the whole accepts[] entry as JSON) on the Quote so the rebuilt requirement is byte-identical (coordinate: the fixups agent is adding a Quote.requirementJson column in packages/database; use it if present, otherwise report unfinished).`,
  },
  {
    key: 'fixups', dirs: 'packages/contracts, packages/database, packages/payments, apps/seller', effort: 'medium',
    task: `Close small carried-forward items from the build stage, smallest diff each, one test where behaviour changes: (a) packages/contracts: \`export * from './state-machine.js'\` breaks Turbopack in apps/web — replace with named exports so apps/web can drop its --webpack workaround (do not edit apps/web; report the change); export a RouteView schema for GET /v1/routes/:id (Receipt + selected + result: string|null + expiresAt) matching what apps/api/src returns today so apps/web can stop mirroring it. (b) packages/database: add a './testing' export exposing the fake-db so apps/api tests stop importing it by relative path; add a nullable Quote.requirementJson (text) column + migration + repository setter/getter holding the exact accepts[] entry so the API can rebuild a byte-identical requirement after restart (INV-005). (c) packages/payments/src/client.ts: enforce maxResponseBytes while streaming the body (abort past the cap) instead of after res.text() (SEC-004, ~line 124); in resolveTransaction pass min_ledger/max_ledger (the payment's first-seen ledger to LastLedgerSequence) so txnNotFound from a node lacking history is 'unknown' not 'not_found' (INV-009, ~line 282); export getBalances(address) so apps/api can drop its raw websocket code. (d) apps/seller/src/upstream.ts ~line 65: same streaming size cap. Keep every public signature backward compatible.`,
    issues: [73, 31, 67, 71],
  },
  {
    key: 'web-history', dirs: 'apps/web', effort: 'medium',
    task: `Extend the Next.js UI: (a) /history page for US-010 listing completed routes from GET /v1/routes?limit=&cursor= (state badge, selected offer, quoted vs settled amount, shortened hash with explorer link, load-more), linked from the main page; (b) candidate table shows each offer's source ("curated" or "xrpl-ai-hub" with a link to hubUrl) per FR-021, and a non-blocking "hub discovery unavailable" notice when GET /v1/offers reports hubStatus.available === false (guard for the field being absent); (c) verify NFR-002: the first timeline state renders within 300ms of clicking Route and Run by rendering an optimistic "classifying" state before the POST resolves; (d) verify NFR-007/008: keyboard-operable end to end and usable at 360px — fix anything that is not. Add a Playwright spec for /history against the mocked API and a component test for the source label. Keep the existing page structure; do not restyle.`,
    issues: [95, 10, 21, 83, 84],
  },
]

const results = await parallel(JOBS.map(j => () =>
  agentRetry(`${COMMON}\n\nYou own ${j.dirs}. ${j.task}${j.extra ? `\n\n${j.extra}` : ''}\n\nIssues this addresses:\n${byNumber(...j.issues)}`,
    { label: `gap:${j.key}`, phase: 'Gaps', schema: REPORT_SCHEMA, effort: j.effort })
))
results.forEach((r, i) => log(r ? `${JOBS[i].key}: ${r.summary}` : `DROPPED: ${JOBS[i].key} failed twice`))
const reports = results.filter(Boolean)

// ---------------- Integrate ----------------
phase('Integrate')
const integrate = await agent(`${COMMON}

You are the integrate agent. These agents just finished in parallel:
${reports.map(r => `- ${r.summary}\n  deps to install: ${r.depsToInstall.join(', ') || 'none'}\n  unfinished: ${r.unfinished.join('; ') || 'none'}`).join('\n')}

Do, in order:
1. If any deps are listed, add them to the right package.json (pinned exact versions) and run \`pnpm install\`. Run \`pnpm --filter @subbuddy/database generate\` if the Prisma client is missing.
2. Run \`pnpm typecheck\` and \`pnpm test\`. Fix cross-package breakages with the smallest change — most likely the acceptance tests vs the apps/api injection signature, and apps/web vs the hubStatus field. Do not rewrite logic; report deep problems as unfinished.
3. Confirm no .env file and no secret value is staged (\`git status\`, review the diff for anything resembling a seed, key, or token). hub-offers.json must contain only public listing data.
4. Update README.md: add the smoke test command, the /history page, and the FR-021 hub paragraph (xrpl-ai.org as the live market, curated registry stands in on Testnet because hub listings are Mainnet). Update docs/ARCHITECTURE.md's "mocked vs live" table if the hub changed it.
5. Commit as "Harden MVP: acceptance tests, Testnet smoke, hub discovery, API hardening, history ${refs('tests', 'config', 'api', 'web')}" and push to origin main.
Report what you fixed and whether typecheck and tests are green.`,
  { label: 'integrate', phase: 'Integrate', schema: REPORT_SCHEMA })
log(`integrated: tests ${integrate?.testsPassing ? 'green' : 'NOT green'}`)

// ---------------- Audit ----------------
phase('Audit')
const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'fail', 'manual'] },
          evidence: { type: 'string' },
          fix: { type: 'string' },
          autoFixable: { type: 'boolean' },
        },
        required: ['criterion', 'status', 'evidence', 'fix', 'autoFixable'],
      },
    },
  },
  required: ['items'],
}
const audit = await agent(`${COMMON}

You are a read-only auditor. Do not edit files. Walk every bullet of PRD §21 Definition of Done and every P0 requirement id in the PRD (grep "— P0"). For each, decide pass / fail / manual (manual = needs a human or live Testnet: funded wallet, recorded tx hash, demo rehearsal, feedback form). Evidence must be concrete: a file:line, a test name that covers it, or a command you ran and its output. For fails give the smallest fix and whether an agent can do it without secrets or live network (autoFixable). Also run \`pnpm typecheck\`, \`pnpm test\`, and \`pnpm --filter @subbuddy/web build\` and report them as criteria.`,
  { label: 'dod-audit', phase: 'Audit', schema: AUDIT_SCHEMA, effort: 'high' })
const fails = (audit?.items ?? []).filter(i => i.status === 'fail')
const manual = (audit?.items ?? []).filter(i => i.status === 'manual')
log(`audit: ${fails.length} fail, ${manual.length} manual, ${(audit?.items ?? []).length - fails.length - manual.length} pass`)

let fix = null
const fixable = fails.filter(f => f.autoFixable)
if (fixable.length) {
  fix = await agent(`${COMMON}

Fix these Definition-of-Done failures with the smallest correct change each, add a test where practical, run \`pnpm typecheck\` and \`pnpm test\`, then commit as "Close definition-of-done gaps" and push to origin main.

${fixable.map(f => `- ${f.criterion}\n  evidence: ${f.evidence}\n  fix: ${f.fix}`).join('\n')}`,
    { label: 'dod-fix', phase: 'Audit', schema: REPORT_SCHEMA })
  log(`fixes: ${fix?.summary}`)
}

return {
  gaps: JOBS.map((j, i) => ({ key: j.key, done: !!results[i], summary: results[i]?.summary ?? null })),
  integrated: integrate?.testsPassing ?? false,
  audit: audit?.items ?? [],
  fixed: fix?.summary ?? null,
  humanTodo: manual.map(m => `${m.criterion}: ${m.fix}`),
  unfinished: [...reports, integrate, fix].filter(Boolean).flatMap(r => r.unfinished),
}
