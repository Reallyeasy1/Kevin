// Workflow 3: finishing pass for submission — live demo screenshots, cheap open issues, judge panel,
// issue closure, CI verify, submission write-up.
// Requires a funded Testnet agent wallet in the root .env (never read or print AGENT_WALLET_SEED).
//   Workflow({ scriptPath: ".claude/workflows/ship-mvp.js", args: { repo, issueRepo, root, prdPath, issues } })

export const meta = {
  name: 'ship-mvp',
  description: 'Demo screenshots + evidence, polish open issues in parallel, judge panel review, close issues, verify CI, draft SUBMISSION.md',
  phases: [
    { title: 'Evidence', detail: 'drive the funded stack through PRD §22, capture screenshots, fill docs/EVIDENCE.md' },
    { title: 'Polish', detail: 'five agents in disjoint dirs: docs, apps/api, apps/web, apps/seller, scripts' },
    { title: 'Integrate', detail: 'typecheck, unit, acceptance, e2e; commit; push' },
    { title: 'Judges', detail: 'three read-only reviewers (judge, payment skeptic, fresh developer) then one fixer' },
    { title: 'Issues', detail: 'close solved GitHub issues with evidence; CI verify' },
    { title: 'Submission', detail: 'SUBMISSION.md ready to paste into the hackathon form' },
  ],
}

const REPO = args.repo
const ISSUE_REPO = args.issueRepo ?? 'Reallyeasy1/Kevin'
const ROOT = args.root
const PRD = args.prdPath
const ISSUES = args.issues ?? []

const refs = (...areas) => {
  const nums = ISSUES.filter(i => areas.includes(i.area)).map(i => `#${i.number}`)
  return nums.length ? `Refs ${nums.join(' ')}` : ''
}
const byNumber = (...nums) => ISSUES.filter(i => nums.includes(i.number))
  .map(i => `- #${i.number} ${i.title} (${i.requirementIds.join(', ')})`).join('\n') || '(no issues mapped)'

const COMMON = `Repository root: ${ROOT} (git repo, branch main, remote ${REPO}; GitHub issues live in ${ISSUE_REPO}). Spec: ${PRD} (source of truth). Read ${ROOT}/CLAUDE.md, ${ROOT}/README.md, ${ROOT}/docs/ARCHITECTURE.md and ${ROOT}/docs/EVIDENCE.md first. The MVP is built, tested (unit, acceptance, e2e) and has one recorded live Testnet payment; this workflow is the finishing pass.

Local environment facts:
- Root .env exists and is gitignored. It holds a FUNDED Testnet demo wallet. NEVER cat, grep, echo or otherwise print AGENT_WALLET_SEED or the .env file; read individual non-secret variables via \`node scripts/with-env.mjs node -e "console.log(process.env.X)"\` if you need them.
- The dev:* and smoke:testnet scripts load .env automatically (scripts/with-env.mjs). Postgres runs in Docker on host port 5433 (POSTGRES_PORT). Ports 5432 and 3000 are taken by unrelated processes: run the web app with \`node scripts/with-env.mjs pnpm --filter @subbuddy/web exec next dev --webpack --port 3100\`.
- Services may already be running on 4010 (api), 4020 (seller), 3100 (web); check /health before starting your own, and never kill processes you did not start.

Hard rules for every agent in this workflow:
- TypeScript strict. pnpm workspaces. Node 22. Windows host: bash-compatible commands, prefer node scripts over shell tricks. Relative imports need .js extensions.
- Money is a decimal string or decimal.js value; never number arithmetic on amounts.
- Never create or edit .env or .env.* except .env.example. Never put a seed, key, or token in source, tests, docs, or screenshots.
- Do NOT run \`pnpm install\` or touch pnpm-lock.yaml unless you are the integrate agent or the fresh-developer reviewer working in a temp clone.
- Work only inside the directories you are assigned. Other agents edit sibling directories concurrently.
- Do not git commit or push unless your instructions say so.
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

// ponytail: agent() resolves null when a spawn dies; one retry beats silently dropping a job.
const agentRetry = async (prompt, opts) => {
  const r = await agent(prompt, opts)
  if (r) return r
  log(`${opts.label}: agent failed to start or died, retrying once`)
  return agent(prompt, { ...opts, label: `${opts.label}:retry` })
}

// ---------------- Evidence (live, sequential) ----------------
phase('Evidence')
const evidence = await agentRetry(`${COMMON}

You own docs/EVIDENCE.md, docs/screenshots/ and README.md (screenshot links only). Produce the PRD §22 demo evidence with the FUNDED wallet:
1. Ensure api (4010), seller (4020) and web (3100) are up (start with the dev scripts in the background if not; the web app on port 3100 as described).
2. Write a Playwright script (run it from the repo root with \`node <file>.mjs\`; @playwright/test and chromium are installed; delete the script afterwards or keep it as scripts/demo-screenshots.mjs if it is tidy) that walks §22 at viewport 1280x900 and saves PNGs under docs/screenshots/ with exactly the names EVIDENCE.md lists: 01-setup (Testnet badge, wallet balance, modes, max cost), 02-decision (after Route and Run: classification and candidate table with score factors), 03-quote (selected offer card showing estimated vs quoted), 04-timeline (the full timeline through Settle and Execute after execute completes — click the approve/execute control the UI offers; wait for SUCCEEDED), 05-receipt (result + expanded economic receipt with the tx hash), 06-explorer (page.goto the explorer URL from the receipt and screenshot it), 07-duplicate (trigger execute again on the same route, or call POST /v1/routes/:id/execute twice via fetch with the demo key read through with-env, and screenshot the UI/receipt showing the same hash). Use the prompt "Write a TypeScript function that parses an ISO-8601 duration string into total seconds, with tests." mode balanced, max cost 0.020000. This spends one real 0.006 RLUSD Testnet payment; that is intended. Do not print the seed or the demo key.
3. Fill EVIDENCE.md: the Screenshots table notes (what each shows, which route id / tx hash), the AT-010 row (receipt and UI show no commission or fee row: cite the screenshot and the receipt JSON), and add a row 5 to Transactions for this run's tx hash (date, route id, invoice id from the on-ledger InvoiceID field, hash, ledger index, amount, explorer link) — fetch the tx from the ledger with xrpl.js (root devDependency) to get the ledger index and InvoiceID. Add the "Builder feedback" hook row: count submissions by running \`node ripple/hook/submit.mjs --help\` only if it has a list mode; otherwise write "submitted throughout the build via the Stop hook (see .claude/settings.json); count kept by the hackathon server" and leave the Google-form date as a human TODO.
4. Link 05-receipt.png and 04-timeline.png from the README demo-script section.
5. Run \`pnpm lint\`; commit as "Add live demo screenshots and evidence ${refs('docs')}" and push to origin main. Report the new tx hash in your summary.`,
  { label: 'evidence', phase: 'Evidence', schema: REPORT_SCHEMA, effort: 'medium' })
log(`evidence: ${evidence?.summary?.slice(0, 200) ?? 'FAILED'}`)

// ---------------- Polish (parallel, disjoint dirs) ----------------
phase('Polish')
const JOBS = [
  {
    key: 'docs', dirs: 'docs/ (except EVIDENCE.md, screenshots/) and README.md', effort: 'medium',
    task: `(a) docs/DEMO.md: the §22 rehearsal script as a checklist for a presenter on a clean browser — prerequisites (Docker, .env, POSTGRES_PORT=5433, web on 3100), exact commands, what to say and click at each step, the expected on-screen state, the explorer check, and the duplicate-execute proof; include a "if something breaks" table (stale process on a port -> netstat + taskkill; RLUSD balance low -> tryrlusd.com GitHub sign-in + GemWallet transfer; Testnet slow -> wait for validation, never re-sign). (b) docs/DOD.md: PRD §21 as a checklist with, per bullet, the evidence pointer (file, test, EVIDENCE.md row) and status; mark the human-only rows. (c) README: in the demo-script section mention the XRPL AI Hub as the live market (https://xrpl-ai.org/, 1,700+ registered providers) and that curated offers stand in on Testnet; add the CI status badge for ${ISSUE_REPO} workflow "ci" and a link to the Actions page; a short "Builder feedback" note that the Stop hook submitted feedback throughout and link the form https://forms.gle/FZckiEAMU8oWXVbX7. Keep the README's existing structure. Run \`pnpm lint\`.`,
    issues: [48, 50, 4, 45, 49],
  },
  {
    key: 'api', dirs: 'apps/api (plus additive schema exports in packages/contracts ONLY if a field must be typed)', effort: 'medium',
    task: `Close, smallest diff each with a test: (a) #60 GET /v1/offers exposes each offer's enabled state (include disabled offers with enabled:false, or add an enabled field on the active ones) without breaking apps/web; (b) #85 include classifierSource ('llm' | 'fallback') and the model id when available in POST /v1/routes and GET /v1/routes/:id responses (additive field; extend the contracts schema additively if needed); (c) #66 a signer failure after policy approval must not leave the route stranded in POLICY_APPROVED: transition to PAYMENT_FAILED with failureCode signer_unavailable / insufficient_balance per §9.1 (if §9.1 lacks the edge, add it to the ROUTE_TRANSITIONS map in packages/contracts with a comment citing this issue and update the state-machine test); (d) #67 give the payments withBackoff helper a deadline option and use it for ledger polling in apps/api so VERIFYING cannot spin forever (edit packages/payments/src/ledger.ts for this one function only). Keep the §11 wire contract backward compatible.`,
    issues: [60, 85, 66, 67],
  },
  {
    key: 'web', dirs: 'apps/web', effort: 'medium',
    task: `Close, smallest diff each: (a) #23 dedicated failure copy for SPEND_CAP_REACHED and QUOTE_OVER_BUDGET stating whether money moved (it did not) and what to change (lower max cost / wait for the hourly window); (b) #88 show the routing mode on the selected-offer card and render candidates in the API's order (rank) instead of re-sorting client-side; (c) #90 render inputTokens/outputTokens and provider latencyMs from the execution receipt in the result workspace; (d) #95 history rows show taskType and mode, and PAID_EXECUTION_FAILED rows carry the warning badge and the §13.4 copy; (e) #78 a Playwright test against the mocked API that walks OUTCOME_UNKNOWN -> SETTLED -> SUCCEEDED and asserts the payment badge never reads Validated before SETTLED; (f) if the API now returns classifierSource, show "classified by LLM" / "fallback heuristic" next to the task type (guard for absence). Keep existing test ids; run the web unit tests and \`pnpm test:e2e\` with WEB_PORT=3177 so you do not collide with the running 3100 server.`,
    issues: [23, 88, 90, 95, 78, 19],
  },
  {
    key: 'seller', dirs: 'apps/seller', effort: 'medium',
    task: `Close #14: add a test that fires two concurrent paid requests carrying the same PAYMENT-SIGNATURE for one invoice and asserts the upstream model is invoked exactly once and both responses carry the same result and PAYMENT-RESPONSE; if the current in-memory invoice store lets both reach the facilitator, serialise per invoice with an in-process promise map (ponytail comment: per-invoice lock, Postgres unique claim if the seller is ever replicated). Also make SELLER_UPSTREAM_MODEL part of the seller's env handling if packages/config now exposes it; otherwise leave as is and note it.`,
    issues: [14, 13],
  },
  {
    key: 'scripts', dirs: 'scripts/ and root package.json scripts only', effort: 'medium',
    task: `(a) #81 \`pnpm demo\`: scripts/demo.mjs (stdlib only) that checks Docker, runs docker compose up -d postgres honouring POSTGRES_PORT, waits for pg_isready, runs the database migrate, then starts seller, api and web (web port from WEB_PORT or 3100 if 3000 is busy — probe the port) as child processes with prefixed, colourless log lines, and stops them all on Ctrl+C; prints the three URLs and the wallet address (never the seed) when healthy. Wire it as "demo" in root package.json through scripts/with-env.mjs. (b) #70 scripts/fund-testnet.ts: create two Testnet wallets with xrpl.js fundWallet, set RLUSD trust lines to the issuer in .env (or the known Testnet issuer rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV), print addresses and the exact .env lines to paste EXCEPT the seed, which it writes to a local file the user names via --out (default ./testnet-wallets.local.json, add that name to .gitignore) — and print the tryrlusd.com steps (GitHub sign-in, GemWallet on Testnet, claim 10, send to the agent address). Wire as "fund:testnet". Unit-test the pure parts. Run \`pnpm typecheck\` (scripts/ is in the root typecheck) and \`pnpm lint\`.`,
    issues: [81, 70],
  },
]

const results = await parallel(JOBS.map(j => () =>
  agentRetry(`${COMMON}\n\nYou own ${j.dirs}. ${j.task}\n\nIssues this addresses:\n${byNumber(...j.issues)}`,
    { label: `polish:${j.key}`, phase: 'Polish', schema: REPORT_SCHEMA, effort: j.effort })
))
results.forEach((r, i) => log(r ? `${JOBS[i].key}: ${r.summary.slice(0, 160)}` : `DROPPED: ${JOBS[i].key} failed twice`))
const reports = results.filter(Boolean)

// ---------------- Integrate ----------------
phase('Integrate')
const integrate = await agent(`${COMMON}

You are the integrate agent. These agents just finished in parallel:
${reports.map(r => `- ${r.summary.slice(0, 900)}\n  deps to install: ${r.depsToInstall.join(', ') || 'none'}\n  unfinished: ${r.unfinished.join('; ') || 'none'}`).join('\n')}

Do, in order:
1. If any deps are listed, add them pinned to the right package.json and run \`pnpm install\`.
2. Run \`pnpm lint\`, \`pnpm typecheck\`, \`pnpm test\`, then \`WEB_PORT=3177 pnpm test:e2e\`. Fix cross-package drift with the smallest change (likely: contracts additive fields vs web types, offers enabled field vs web). Do not rewrite logic.
3. Confirm no .env, seed, key, token or screenshot containing a seed is staged (\`git status\`, review the diff).
4. Commit as "Polish for submission: demo script, DoD checklist, offers/classifier fields, web copy, seller concurrency test, pnpm demo ${refs('docs', 'api', 'web', 'seller', 'infra')}" and push to origin main.
Report what you fixed and whether everything is green.`,
  { label: 'integrate', phase: 'Integrate', schema: REPORT_SCHEMA })
log(`integrated: ${integrate?.testsPassing ? 'green' : 'NOT green'}`)

// ---------------- Judges (parallel read-only, then one fixer) ----------------
phase('Judges')
const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          where: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
          autoFixable: { type: 'boolean' },
        },
        required: ['severity', 'where', 'problem', 'fix', 'autoFixable'],
      },
    },
    verdict: { type: 'string' },
  },
  required: ['findings', 'verdict'],
}
const JUDGES = [
  {
    key: 'hackathon-judge', effort: 'high',
    prompt: `You are a hackathon judge for the Ripple/XRPL agentic payments track with 10 minutes per team. Read ONLY what a judge would: README.md, docs/EVIDENCE.md (follow the explorer links with WebFetch and confirm the tx exists, is Testnet, tesSUCCESS, and the destination/amount match), docs/ARCHITECTURE.md, docs/DEMO.md, and the screenshots under docs/screenshots (view them). Do not read source code. Judge: is the claim ("an agent buys inference with a request-scoped x402 payment on XRPL, no seller account or API key") actually proven by the evidence? Is it clear the wallet is a Testnet demo wallet and no commission is taken? What would make you doubt the result, and what one change would raise the score most? Report concrete findings with where/problem/fix; verdict = one paragraph as you would write on the scoresheet.`,
  },
  {
    key: 'payment-skeptic', effort: 'high',
    prompt: `You are an adversarial reviewer trying to make money move wrongly. Read packages/payments, apps/api/src/service.ts, apps/seller, packages/database/prisma/schema.prisma and the acceptance tests. Try to construct: a double payment for one route; a payment to a payTo not in the registry; signing after mandate expiry; a Mainnet network id slipping through; a signed blob reaching a public response or log; a re-sign after OUTCOME_UNKNOWN; a seller invoking the model twice for one invoice. For each attempt say whether the code blocks it and cite file:line, or report it as a finding with the smallest fix. Read-only.`,
  },
  {
    key: 'fresh-developer', effort: 'medium',
    prompt: `You are a developer who has never seen this repo. Clone ${REPO} into a NEW temp directory under ${ROOT}/../.ship-mvp-clone (create it; delete it at the end) and, following README.md ONLY, get to the mocked smoke test: pnpm install, pnpm typecheck, pnpm test, then pnpm test:e2e with WEB_PORT=3178 (no .env, no Docker: the README must make clear these are not needed for the mocked path; if it does not, that is a finding). Time each step. Note every place the README was wrong, ambiguous, or assumed something. Do NOT touch ${ROOT} itself. Report findings with where/problem/fix and a verdict with the total minutes to green.`,
  },
]
const judged = (await parallel(JUDGES.map(j => () =>
  agentRetry(`${COMMON}\n\n${j.prompt}`, { label: `judge:${j.key}`, phase: 'Judges', schema: FINDINGS_SCHEMA, effort: j.effort })
))).filter(Boolean)
judged.forEach((j, i) => log(`${JUDGES[i]?.key}: ${j.findings.length} finding(s) — ${j.verdict.slice(0, 160)}`))
const toFix = judged.flatMap((j, i) => j.findings.filter(f => f.autoFixable && f.severity !== 'low').map(f => ({ ...f, from: JUDGES[i]?.key })))

let judgeFix = null
if (toFix.length) {
  judgeFix = await agent(`${COMMON}

Apply the smallest correct fix for each reviewer finding below (docs and code), add or extend a test where behaviour changes, run \`pnpm lint\`, \`pnpm typecheck\`, \`pnpm test\`, then commit as "Address judge-panel findings" and push to origin main. If a finding is wrong, say why in your report instead of changing code.

${toFix.map(f => `- [${f.severity}] (${f.from}) ${f.where}\n  problem: ${f.problem}\n  fix: ${f.fix}`).join('\n')}`,
    { label: 'judge-fix', phase: 'Judges', schema: REPORT_SCHEMA })
  log(`judge fixes: ${judgeFix?.summary?.slice(0, 160)}`)
}

// ---------------- Issues + CI ----------------
phase('Issues')
const ISSUES_SCHEMA = {
  type: 'object',
  properties: {
    closed: { type: 'array', items: { type: 'number' } },
    open: { type: 'array', items: { type: 'object', properties: { number: { type: 'number' }, reason: { type: 'string' } }, required: ['number', 'reason'] } },
  },
  required: ['closed', 'open'],
}
const closer = await agentRetry(`${COMMON}

You are the issue-closing agent. List the OPEN issues in ${ISSUE_REPO} with \`gh issue list -R ${ISSUE_REPO} --state open --limit 200 --json number,title\`. For EACH, read its body and latest comment, then look for concrete evidence at HEAD (implementing files, a covering test, an EVIDENCE.md row, a screenshot). SOLVED -> \`gh issue close <n> -R ${ISSUE_REPO} -r completed -c "<paths, test, evidence row, commit sha>"\`. Still partial -> update the existing comment thread with one line on what changed and what remains. Human-only (Google form, live rehearsal) -> leave open, comment that it is a human step. Out of MVP scope per the PRD -> close as "not planned" citing the section. Never close on a commit message alone. Do not edit files.`,
  { label: 'close-issues', phase: 'Issues', schema: ISSUES_SCHEMA, effort: 'medium' })
log(`issues: ${closer?.closed.length ?? 0} closed, ${closer?.open.length ?? 0} left open`)

const ci = await agent(`${COMMON}

You are the CI agent. Run \`gh run list -R ${ISSUE_REPO} --limit 1 --json databaseId,status,conclusion,headSha\` and \`gh run watch <id> -R ${ISSUE_REPO} --exit-status\`. If it fails, read \`gh run view <id> -R ${ISSUE_REPO} --log-failed\`, fix the ROOT CAUSE (never skip a step), verify locally, commit as "Fix CI: <cause>", push, watch again. At most two rounds. testsPassing means the latest run on main is green.`,
  { label: 'ci-verify', phase: 'Issues', schema: REPORT_SCHEMA, effort: 'medium' })
log(`ci: ${ci?.testsPassing ? 'green' : 'NOT green'}`)

// ---------------- Submission ----------------
phase('Submission')
const submission = await agent(`${COMMON}

Write docs/SUBMISSION.md for the hackathon form, from README.md, docs/EVIDENCE.md, docs/ARCHITECTURE.md and the judge verdicts below. Sections, each short enough to paste into a form field: Project name and one-line pitch (positioning per PRD §3.3, never "OpenRouter on XRPL"); Problem; What we built and what the demo proves; How XRPL and x402 are used (RLUSD on Testnet, 402 -> PAYMENT-SIGNATURE -> facilitator verify/settle, ledger verification before success, no commission); Evidence (repo URL https://github.com/${ISSUE_REPO}, the live tx hash and explorer link from EVIDENCE.md, CI status, test counts from \`pnpm test\`); Architecture in five sentences; Security and safety (Testnet demo wallet statement, invariants INV-002/003/009/011, spend cap); XRPL AI Hub relationship (FR-021); Builder feedback (Stop hook throughout, form link); a 2-minute demo narration matching docs/DEMO.md; Team (team LookingForEmployment). Run \`pnpm lint\`, commit as "Add submission write-up", push.

Judge verdicts:
${judged.map((j, i) => `- ${JUDGES[i]?.key}: ${j.verdict}`).join('\n')}`,
  { label: 'submission', phase: 'Submission', schema: REPORT_SCHEMA, effort: 'medium' })

return {
  evidence: evidence?.summary ?? null,
  polish: JOBS.map((j, i) => ({ key: j.key, done: !!results[i], summary: results[i]?.summary?.slice(0, 300) ?? null })),
  integrated: integrate?.testsPassing ?? false,
  judges: judged.map((j, i) => ({ judge: JUDGES[i]?.key, verdict: j.verdict, findings: j.findings })),
  judgeFixes: judgeFix?.summary ?? null,
  issuesClosed: closer?.closed ?? [],
  issuesOpen: closer?.open ?? [],
  ciGreen: ci?.testsPassing ?? false,
  submission: submission?.summary ?? null,
  unfinished: [evidence, ...reports, integrate, judgeFix, ci, submission].filter(Boolean).flatMap(r => r.unfinished),
}
