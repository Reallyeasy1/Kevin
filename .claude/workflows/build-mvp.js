// Workflow: build the PRD_SPECS.md MVP critical path, committing and pushing per stage.
// Run with: Workflow({ scriptPath: ".claude/workflows/build-mvp.js", args: { repo, root, prdPath, issues } })
// `issues` is the output of prd-to-issues (number/title/requirementIds/area) so commits can reference them.

export const meta = {
  name: 'build-mvp',
  description: 'Scaffold the pnpm monorepo, build packages and apps in parallel per PRD_SPECS.md, review payment code, push each stage to GitHub',
  phases: [
    { title: 'Scaffold', detail: 'monorepo, adapter interfaces, pinned deps, CI, .env.example' },
    { title: 'Packages', detail: 'contracts+config, routing, payments, database in parallel (disjoint dirs)' },
    { title: 'Apps', detail: 'seller (Express + x402-xrpl), buyer API (Fastify), web (Next.js) in parallel' },
    { title: 'Review', detail: 'payment invariants review, fix confirmed findings' },
    { title: 'Docs', detail: 'README, architecture, submission checklist' },
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
const issueList = (...areas) => ISSUES.filter(i => areas.includes(i.area))
  .map(i => `- #${i.number} ${i.title} (${i.requirementIds.join(', ')})`).join('\n') || '(no issues mapped)'

const COMMON = `Repository root: ${ROOT} (git repo, branch main, remote ${REPO}). Spec: ${PRD} (the source of truth; when it and any instruction here disagree, the PRD wins). Also read ${ROOT}/CLAUDE.md and ${ROOT}/.claude/rules/xrpl-payments.md before writing payment-adjacent code.

Hard rules for every agent in this workflow:
- TypeScript strict. pnpm workspaces. Node 22 is installed. Windows host: use bash-compatible commands; prefer node scripts over shell tricks.
- Money is a decimal string or decimal.js value; never number arithmetic on amounts.
- Never create or edit a file named .env or .env.* except .env.example. Never put a wallet secret, API key, or token in source.
- Do NOT run \`pnpm install\` or touch pnpm-lock.yaml unless you are the scaffold or integrate agent; if you need a dependency that is not installed, add it to your package.json and list it in your return so the integrate agent installs it.
- Work only inside the directories you are assigned. Other agents are editing sibling directories concurrently.
- Do not git commit or push unless your instructions say so.
- Leave one runnable Vitest check per non-trivial module. No live network in tests: mock xrpl.js clients, the facilitator, and upstream models.
- Return a concise report: files created/changed, commands you ran and their results, deps you need installed, anything unfinished.`

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

// ---------------- Scaffold ----------------
phase('Scaffold')
const scaffold = await agent(`${COMMON}

You are the scaffold agent. Create the monorepo described in PRD §10 so that every later agent can work in its own directory without installing anything.

Deliver:
1. Root: package.json (private, scripts: build, typecheck, test, test:e2e, lint, dev:seller, dev:api, dev:web), pnpm-workspace.yaml (apps/*, packages/*), tsconfig.base.json (strict, ES2022, NodeNext for packages, bundler for web), vitest.workspace.ts, .prettierrc, .editorconfig, .gitattributes (* text=auto eol=lf).
2. packages/contracts, packages/config, packages/routing, packages/payments, packages/database — each with package.json (name @subbuddy/<pkg>, type module, exports ./src/index.ts via tsx for dev), tsconfig.json extending base, src/index.ts, and one placeholder vitest test.
   packages/contracts/src/index.ts MUST contain the four interfaces from PRD §10.3 (Classifier, ProviderRegistry, PaymentClient, WalletSigner) and the domain types they reference (TaskProfile, InferenceOffer, PaymentRequirement, ExactPayment, SignedPayment, SettlementResult, SellerRequest, PaidSellerResponse, PayAndRetryInput, ClassifyInput), typed from PRD §8 and §12. Other packages import from @subbuddy/contracts.
3. apps/seller (Express 4), apps/api (Fastify 5), apps/web (Next.js app router + Tailwind) — minimal running skeletons with a /health route (web: a page that renders "SubBuddy").
4. .env.example at root listing every variable NFR-009 and SEC-010/011 imply, each with a comment and a non-secret placeholder: APP_ENV=hackathon, XRPL_NETWORK (CAIP-2 id, comment that it must match x402-xrpl's Testnet constant), XRPL_WSS_URL (wss://s.altnet.rippletest.net:51233), XRPL_EXPLORER_BASE (https://testnet.xrpl.org/transactions/), SETTLEMENT_ASSET (RLUSD), RLUSD_ISSUER, RLUSD_CURRENCY_HEX, FACILITATOR_URL (https://xrpl-facilitator-testnet.t54.ai), AGENT_WALLET_SEED (placeholder text only), DEMO_API_KEY, HOURLY_SPEND_CAP, DATABASE_URL, SELLER_BASE_URL, SELLER_PAYTO_ADDRESS, SELLER_UPSTREAM_PROVIDER (mock|openai-compatible), SELLER_UPSTREAM_BASE_URL, SELLER_UPSTREAM_API_KEY, CLASSIFIER_PROVIDER, CLASSIFIER_API_KEY, MANDATE_TTL_SECONDS=300.
5. .github/workflows/ci.yml: pnpm install --frozen-lockfile, typecheck, test. No live Testnet tests (PRD §18.3).
6. Install and PIN exact versions (check \`npm view <pkg> version\` for current): typescript, tsx, vitest, @types/node, zod, decimal.js, pino, xrpl (4.x), x402-xrpl (0.3.x, peer dep express), express + @types/express, fastify, @fastify/cors, prisma + @prisma/client, next, react, react-dom, tailwindcss + postcss + autoprefixer, @playwright/test. Put each dep in the package that owns it; shared dev deps at root. Run \`pnpm install\`, \`pnpm typecheck\`, \`pnpm test\` and make them green.
7. Commit everything as "Scaffold pnpm monorepo per PRD §10 ${refs('infra', 'contracts')}" and push to origin main. Do not commit .env files (only .env.example) or node_modules.

Issues this addresses:
${issueList('infra', 'contracts')}`, { label: 'scaffold', phase: 'Scaffold', schema: REPORT_SCHEMA })
log(`scaffold: ${scaffold?.summary ?? 'FAILED'}`)
if (!scaffold || scaffold.unfinished.some(u => /install|typecheck|push/i.test(u))) {
  log('scaffold did not complete cleanly; stopping before parallel work')
  return { stoppedAt: 'scaffold', scaffold }
}

// ---------------- Packages (parallel, disjoint dirs) ----------------
phase('Packages')
const PACKAGE_JOBS = [
  {
    key: 'contracts+config', dirs: 'packages/contracts and packages/config', areas: ['contracts', 'config'],
    task: `Finish packages/contracts: Zod schemas (and inferred types) for TaskProfile (FR-010), InferenceOffer (FR-020 incl. currencyHex and CAIP-2 network), the route request/response and standard error envelope (§11), route/payment/execution state enums (§9), and the execution receipt (FR-090). Export everything.
Finish packages/config: (a) runtime env validation with Zod that FAILS fast with a precise message when any NFR-009 variable is missing, and REJECTS Mainnet when APP_ENV=hackathon (SEC-010); (b) the curated offer registry seed: three RLUSD Testnet offers per FR-020 (ids fast-text-v1, fast-code-v1, deep-reasoning-v1) with distinct capabilities, prices, latencies, qualityByTask, all pointing at SELLER_BASE_URL; (c) a CuratedRegistry implementing ProviderRegistry that validates the seed at startup (invalid record = startup error) and computes a registryVersion hash (INV-010). Tests for env failure cases, Mainnet rejection, and registry validation.`,
  },
  {
    key: 'routing', dirs: 'packages/routing', areas: ['routing'],
    task: `Implement per PRD §8.2–8.5: (a) deterministic fallback classifier (FR-011) and a Classifier adapter interface with an LLM implementation behind CLASSIFIER_PROVIDER that validates output against the TaskProfile schema and falls back on any failure (FR-010, DEC-014) — mock the LLM in tests; (b) eligibility filter (FR-030) returning machine-readable rejection reasons per removed offer; (c) scoring (FR-040) with normalisation over the ELIGIBLE SET (not maxCost), the four mode weight tables, the Cheapest and Fastest hard guarantees, tie-break order, 4-dp scores; (d) explanation generator (FR-041) from structured score deltas. Money via decimal.js. Tests: every mode, every tie-break, the required "maxCost 1.000000 with equal latencies still picks the cheapest" case, single-eligible-offer normalisation, classifier fallback.`,
  },
  {
    key: 'payments', dirs: 'packages/payments', areas: ['payments'],
    task: `Implement per PRD §8.6–8.8 and §9.2 using xrpl.js and x402-xrpl (already installed; read their type definitions in node_modules first and adapt to what the SDK actually exposes — if x402-xrpl's client helpers do not fit, build the PAYMENT-SIGNATURE header yourself per the t54 exact scheme: base64 JSON {x402Version:2, accepted:{scheme,network,asset,payTo,amount,maxTimeoutSeconds,extra}, payload:{signedTxBlob}}):
(a) WalletSigner (FR-070): reads the wallet secret from env only inside signExactPayment, builds a Payment with exact Amount (XRP drops or IOU {currency: 40-hex, issuer, value}), Destination, InvoiceID = SHA-256(extra.invoiceId), SourceTag, bounded LastLedgerSequence, NO tfPartialPayment, NO Paths; signs once; returns {signedTxBlob, txHash} with the hash computed locally; serialises signing per wallet with an in-process mutex (ponytail: upgrade to Tickets if throughput matters).
(b) PaymentClient: obtainRequirement (send the seller request, expect 402, parse and validate the accepts[] entry for scheme=exact per FR-051 — every listed check, safe public reason on failure), payAndRetry (resend with PAYMENT-SIGNATURE; parse PAYMENT-RESPONSE; never re-sign; on timeout return OUTCOME_UNKNOWN with the known hash), resolveTransaction (query the ledger for the hash; SETTLED only on validated tesSUCCESS; expired past LastLedgerSequence with no entry = PAYMENT_FAILED).
(c) Export nothing from xrpl.js or x402-xrpl types beyond this package (adapter boundary).
Tests with mocked xrpl Client and a fake seller/facilitator: quote validation matrix (AT-003, AT-004), sign-once on retry (INV-011), OUTCOME_UNKNOWN resolution (AT-006), settlement only on tesSUCCESS (INV-009).`,
  },
  {
    key: 'database', dirs: 'packages/database', areas: ['database'],
    task: `Implement per PRD §12: prisma/schema.prisma (provider postgresql) for Route, RouteCandidate, Quote, Payment, Execution with the exact uniqueness constraints from FR-071 (UNIQUE route_id, UNIQUE invoice_id, UNIQUE transaction_hash where not null) and decimal columns for money; a thin repository module (createRoute, saveCandidates, saveQuote, claimPayment — an INSERT that relies on the unique constraint to make concurrent execute calls lose, per SEC-007 — updatePayment, saveExecution, getRoute with everything for the receipt); run \`pnpm exec prisma generate\` in this package; a SpendLedger helper that sums payments in the last rolling hour for SEC-011. Tests: unit-test the repository against an in-memory fake of the Prisma client for the claim-payment race; DB-backed tests skip unless DATABASE_URL is set. Provide docker-compose.yml at ROOT for local Postgres (only this file outside your dir).`,
  },
]

const pkgReports = (await parallel(PACKAGE_JOBS.map(j => () =>
  agent(`${COMMON}\n\nYou own ${j.dirs}. ${j.task}\n\nIssues this addresses:\n${issueList(...j.areas)}`,
    { label: `pkg:${j.key}`, phase: 'Packages', schema: REPORT_SCHEMA })
))).filter(Boolean)
pkgReports.forEach((r, i) => log(`${PACKAGE_JOBS[i]?.key}: ${r.summary}`))

const integratePrompt = (stage, reports, areas) => `${COMMON}

You are the integrate agent for the "${stage}" stage. The following agents just finished working in parallel:
${reports.map(r => `- ${r.summary}\n  deps to install: ${r.depsToInstall.join(', ') || 'none'}\n  unfinished: ${r.unfinished.join('; ') || 'none'}`).join('\n')}

Do, in order:
1. If any deps are listed, add them to the right package.json (pinned exact versions) and run \`pnpm install\`.
2. Run \`pnpm typecheck\` and \`pnpm test\`. Fix cross-package breakages (mismatched imports, type drift between packages) with the smallest change. Do not rewrite a package's logic; if something is deeply wrong, report it as unfinished.
3. Confirm no .env file and no secret value is staged (\`git status\`, review the diff for anything that looks like a credential).
4. Commit as "${stage}: <one line summary> ${refs(...areas)}" and push to origin main.
Report what you fixed and whether typecheck and tests are green.`

const pkgIntegrate = await agent(integratePrompt('Add core packages', pkgReports, PACKAGE_JOBS.flatMap(j => j.areas)),
  { label: 'integrate:packages', phase: 'Packages', schema: REPORT_SCHEMA })
log(`packages integrated: tests ${pkgIntegrate?.testsPassing ? 'green' : 'NOT green'}`)

// ---------------- Apps (parallel, disjoint dirs) ----------------
phase('Apps')
const APP_JOBS = [
  {
    key: 'seller', dirs: 'apps/seller', areas: ['seller'],
    task: `Build the x402-protected inference seller per PRD §11.8, FR-050, FR-080, FR-081, AT-012 on Express 4 with the x402-xrpl middleware (read its README/types in node_modules; if the middleware cannot express per-offer pricing or invoice binding, wrap it or implement the 402 + PAYMENT-SIGNATURE verification via the facilitator's verify/settle endpoints — FACILITATOR_URL). POST /v1/inference/:offerId: unpaid request -> validate body, create/retrieve an invoice bound to requestId+offerId+promptHash, return 402 with accepts[] for scheme exact on the configured Testnet network/asset/payTo (from env), do NOT call any model; paid retry -> verify via facilitator, consume the invoice idempotently (INV-003 seller-side, a repeated paid request returns the cached result), call the upstream model at most once per invoice, return the FR-080 normalised response plus PAYMENT-RESPONSE. Upstream adapter: "mock" provider (deterministic canned answer, no network) and "openai-compatible" provider behind SELLER_UPSTREAM_*; credentials only in env. Pino logging with redaction (SEC-001, SEC-008). Tests: AT-012 (model invocation count 0 then 1), idempotent replay, malformed payment rejected. A \`pnpm dev:seller\` script.`,
  },
  {
    key: 'api', dirs: 'apps/api', areas: ['api'],
    task: `Build the Fastify buyer API per PRD §11 wiring @subbuddy/routing, @subbuddy/payments, @subbuddy/database, @subbuddy/config: POST /v1/routes (classify, load registry, filter, score, obtain quote from the top offer with the FR-051 walk-to-next-offer rule, store immutable quote, return QUOTED per §11.2), POST /v1/routes/:id/execute (prompt hash check FR-002/AT-009, policy gate FR-060 incl. wallet balance and SEC-011 hourly cap, claimPayment race per AT-005, sign once, payAndRetry, VERIFYING via resolveTransaction, state transitions per the amended §9.1, idempotent by routeId), GET /v1/routes/:id, GET /v1/routes/:id/events (SSE, event types per §11.5), GET /v1/offers, GET /v1/wallet. Every route requires Authorization: Bearer DEMO_API_KEY (SEC-011) and returns the §11.1 error envelope with safe messages. Startup runs config validation (fails fast). Tests: mock payments and database; cover AT-002, AT-005 (concurrent execute -> one claim), AT-009, UNAUTHORIZED, SPEND_CAP_REACHED, and the state machine transitions. A \`pnpm dev:api\` script.`,
  },
  {
    key: 'web', dirs: 'apps/web', areas: ['web'],
    task: `Build the single-page Next.js UI per PRD §13 and FR-091..FR-093: wallet bar (address, network badge, balances from GET /v1/wallet), prompt composer (prompt, mode selector with the four modes, max cost with asset label, optional output limit, "Route and Run"), execution timeline driven by the SSE events (classify, compare, quote, approve, settle, execute) with every §13.2 state including "Paid execution failed" warning copy per §13.4, candidate table with estimated vs quoted labels and status per FR-092, result workspace with the answer and a collapsible economic receipt (FR-090) including shortened tx hash, copy button, and explorer link built from XRPL_EXPLORER_BASE. Tailwind, keyboard-operable, usable at 360px (NFR-007/008). API base URL and demo key from NEXT_PUBLIC_* env (document in .env.example that the demo key in the browser is a hackathon-only choice). One Playwright e2e against a mocked API (no payment) per §18.3, runnable with \`pnpm test:e2e\`. A \`pnpm dev:web\` script.`,
  },
]

const appReports = (await parallel(APP_JOBS.map(j => () =>
  agent(`${COMMON}\n\nYou own ${j.dirs}. ${j.task}\n\nIssues this addresses:\n${issueList(...j.areas)}`,
    { label: `app:${j.key}`, phase: 'Apps', schema: REPORT_SCHEMA })
))).filter(Boolean)
appReports.forEach((r, i) => log(`${APP_JOBS[i]?.key}: ${r.summary}`))

const appIntegrate = await agent(integratePrompt('Add seller, buyer API, and web app', appReports, APP_JOBS.flatMap(j => j.areas)),
  { label: 'integrate:apps', phase: 'Apps', schema: REPORT_SCHEMA })
log(`apps integrated: tests ${appIntegrate?.testsPassing ? 'green' : 'NOT green'}`)

// ---------------- Review ----------------
phase('Review')
const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' }, line: { type: 'number' }, id: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          scenario: { type: 'string' }, fix: { type: 'string' },
        },
        required: ['file', 'line', 'id', 'severity', 'scenario', 'fix'],
      },
    },
  },
  required: ['findings'],
}
const review = await agent(`${COMMON}

You are a payment-invariants reviewer. Read ${ROOT}/.claude/agents/xrpl-payment-reviewer.md and follow it as your instructions. Review packages/payments, apps/seller, apps/api, and packages/database against every INV-* and SEC-* id in ${PRD} §9.3 and §15.2. Report only concrete violations with file:line, the id, a one-sentence failure scenario, and the smallest fix. Severity high = money can move wrongly or a credential can leak.`,
  { label: 'payment-review', phase: 'Review', schema: FINDINGS_SCHEMA, effort: 'high' })
const serious = (review?.findings ?? []).filter(f => f.severity !== 'low')
log(`review: ${review?.findings?.length ?? 0} finding(s), ${serious.length} medium/high`)

let reviewFix = null
if (serious.length) {
  reviewFix = await agent(`${COMMON}

Fix these reviewer findings with the smallest correct change each, add or extend a test that fails without the fix where practical, run \`pnpm typecheck\` and \`pnpm test\`, then commit as "Fix payment invariant findings ${refs('payments', 'seller', 'api', 'database')}" and push.

Findings:
${serious.map(f => `- [${f.severity}] ${f.id} ${f.file}:${f.line} — ${f.scenario}\n  fix: ${f.fix}`).join('\n')}`,
    { label: 'fix-findings', phase: 'Review', schema: REPORT_SCHEMA })
  log(`fixes: ${reviewFix?.summary}`)
}

// ---------------- Docs ----------------
phase('Docs')
const docs = await agent(`${COMMON}

Write the submission documentation required by PRD §21 and the checklist in ${ROOT}/ripple/README.md:
1. README.md at root: product overview (from PRD §2–3, positioning per §3.3, do NOT call it "OpenRouter on XRPL"), architecture diagram (mermaid, from §10 with the amended payment flow), setup (pnpm install, docker compose up for Postgres, prisma migrate, .env from .env.example, how to fund the Testnet agent wallet with XRP and RLUSD and set trust lines — link the RLUSD faucet from ripple/resources.md), run (three dev scripts), test (unit, e2e mocked, and the MANUAL live Testnet smoke test procedure from §18.3 with a placeholder table for transaction hashes and explorer links), demo script (§22), the "Testnet demo wallet, not production custody" statement (§15.1), the XRPL AI Hub reference per FR-021's MVP treatment, and a Builder Feedback section (hook + Google form link from ripple/README.md).
2. docs/ARCHITECTURE.md: adapter boundaries, state machines (copy the amended §9 diagrams), invariants table, what is mocked vs live.
3. docs/EVIDENCE.md: template for transaction hashes, explorer links, screenshots, filled in later by hand.
Commit as "Add README, architecture, and evidence template ${refs('docs')}" and push.`,
  { label: 'docs', phase: 'Docs', schema: REPORT_SCHEMA, effort: 'medium' })

return {
  scaffold: scaffold.summary,
  packages: pkgReports.map(r => r.summary),
  packagesIntegrated: pkgIntegrate?.testsPassing ?? false,
  apps: appReports.map(r => r.summary),
  appsIntegrated: appIntegrate?.testsPassing ?? false,
  reviewFindings: review?.findings ?? [],
  reviewFixed: reviewFix?.summary ?? null,
  docs: docs?.summary ?? null,
  unfinished: [scaffold, ...pkgReports, pkgIntegrate, ...appReports, appIntegrate, reviewFix, docs]
    .filter(Boolean).flatMap(r => r.unfinished),
}
