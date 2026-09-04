// Workflow: PRD_SPECS.md -> GitHub issue board.
// Run with: Workflow({ scriptPath: ".claude/workflows/prd-to-issues.js", args: { repo, prdPath, milestone } })
// Output: { milestone, issues: [{ number, url, title, requirementIds, area, priority }] }

export const meta = {
  name: 'prd-to-issues',
  description: 'Turn PRD_SPECS.md requirements into a labelled, milestoned GitHub issue board, verified for P0 coverage',
  phases: [
    { title: 'Extract', detail: 'one agent per PRD section group drafts issues' },
    { title: 'Coverage', detail: 'critic checks every P0/P1 id is covered; gap-fill once' },
    { title: 'Publish', detail: 'labels + milestone, then issues in parallel batches' },
  ],
}

const REPO = args.repo
const PRD = args.prdPath
const MILESTONE = args.milestone

const LABELS = [
  'P0', 'P1', 'P2',
  'area:contracts', 'area:config', 'area:routing', 'area:payments', 'area:database',
  'area:seller', 'area:api', 'area:web', 'area:tests', 'area:docs', 'area:infra',
  'type:feature', 'type:test', 'type:docs', 'type:infra', 'xrpl',
]

const ISSUES_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          area: { type: 'string', enum: ['contracts', 'config', 'routing', 'payments', 'database', 'seller', 'api', 'web', 'tests', 'docs', 'infra'] },
          type: { type: 'string', enum: ['feature', 'test', 'docs', 'infra'] },
          requirementIds: { type: 'array', items: { type: 'string' } },
          window: { type: 'string' },
          xrpl: { type: 'boolean' },
        },
        required: ['title', 'body', 'priority', 'area', 'type', 'requirementIds', 'window', 'xrpl'],
      },
    },
  },
  required: ['issues'],
}

const GROUPS = [
  { key: 'mandate', sections: '§7 (core experience, request mandate, happy path), §8.1 (FR-001, FR-002), §8.2 (FR-010, FR-011)', hint: 'route request validation, mandate construction, classifier adapter + deterministic fallback' },
  { key: 'routing', sections: '§8.3 (FR-020, FR-021, FR-022), §8.4 (FR-030), §8.5 (FR-040, FR-041)', hint: 'curated registry + ProviderRegistry interface, eligibility filtering, scoring with the Cheapest/Fastest guarantees and eligible-set normalisation, explanation' },
  { key: 'payment', sections: '§8.6 (FR-050, FR-051), §8.7 (FR-060), §8.8 (FR-070, FR-071, FR-072), §9 (state machines, INV-001..INV-012)', hint: 'x402 quote acquisition and validation, policy gate, WalletSigner + PaymentClient over xrpl.js and x402-xrpl, sign-once idempotency, settlement verification, route/payment state machines' },
  { key: 'execution-ui', sections: '§8.9 (FR-080, FR-081, FR-082), §8.10 (FR-090..FR-093), §13 (UI specification)', hint: 'seller paid execution and idempotent replay, receipt, main page regions, UI states, candidate table, error copy' },
  { key: 'architecture', sections: '§10 (architecture, layout, stack, adapter boundaries), §11 (API contract), §12 (data model)', hint: 'pnpm monorepo scaffold, package skeletons, adapter interfaces, each API endpoint, Prisma schema with the uniqueness constraints' },
  { key: 'resilience', sections: '§14 (failure handling), §15 (SEC-001..SEC-011), §16 (NFR-001..NFR-010), §19 (observability)', hint: 'failure table behaviours, log redaction, API key + spend cap, config validation that fails startup, metrics and correlated events' },
  { key: 'delivery', sections: '§17 (AT-001..AT-012), §18 (test strategy), §20 (delivery plan), §21 (definition of done), §22 (demo script), and the submission checklist in ripple/README.md', hint: 'one issue per acceptance test, CI, live-testnet smoke test procedure, README/setup/architecture diagram/tx evidence, demo rehearsal, feedback form' },
]

const extractPrompt = (g) => `You are drafting GitHub issues from a product spec for a 24-hour hackathon build.

Read ${PRD} — specifically ${g.sections}. Skim §1, §4 (DEC-*), and §5 for context. Focus: ${g.hint}.

Draft issues that a developer could pick up and complete. Rules:
- One issue per coherent unit of work (usually one FR/SEC/AT id, sometimes two tightly coupled ids). Do not create one giant issue per section.
- Title: imperative, under 70 chars, ends with the primary id in brackets, e.g. "Validate x402 quote fields before signing [FR-051]".
- Body (markdown) MUST contain these headings in order: "## Requirement" (ids + PRD section), "## Summary" (2-4 sentences in your own words), "## Acceptance criteria" (a checklist copied or condensed from the PRD; every bullet is testable), "## Delivery window" (the §20 window this belongs to), "## Notes" (relevant INV/SEC/DEC ids and hard constraints, e.g. never re-sign, decimal money only, XRPL Testnet only).
- priority mirrors the PRD tag on the requirement (P0/P1/P2). Unlabelled supporting work inherits the priority of what it unblocks.
- area is the package or app from §10.1 that owns the work. type is feature/test/docs/infra.
- xrpl=true when the work touches XRPL, x402, RLUSD, the facilitator, or wallet signing.
- Only cover the ids in your sections. Other groups cover the rest.
Return only the structured issues.`

// ---- Extract (barrier: the coverage critic needs every draft at once) ----
phase('Extract')
const drafts = (await parallel(GROUPS.map(g => () =>
  agent(extractPrompt(g), { label: `extract:${g.key}`, phase: 'Extract', schema: ISSUES_SCHEMA })
))).filter(Boolean).flatMap(r => r.issues)
log(`${drafts.length} issue drafts from ${GROUPS.length} groups`)

// ---- Coverage ----
phase('Coverage')
const COVERAGE_SCHEMA = {
  type: 'object',
  properties: {
    missingIds: { type: 'array', items: { type: 'string' } },
    duplicateTitles: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
  },
  required: ['missingIds', 'duplicateTitles'],
}
const index = drafts.map((d, i) => `${i}. ${d.title} -> ${d.requirementIds.join(', ')}`).join('\n')
const coverage = await agent(`You are a completeness critic for an issue board built from ${PRD}.

Every P0 and P1 requirement id in the PRD must be owned by at least one issue. Ids to check: every FR-*, SEC-*, AT-*, NFR-*, and US-* id in the document (grep the file for them and note each one's priority tag; INV-* and DEC-* are constraints, not work items, and need no issue).

Drafted issues (index. title -> ids):
${index}

Return:
- missingIds: P0/P1 ids with no owning issue (empty if fully covered).
- duplicateTitles: pairs of titles that describe the same unit of work and should be merged (empty if none).
Be strict about missing ids and lenient about duplicates; only pair issues that are truly the same work.`, { label: 'coverage-critic', phase: 'Coverage', schema: COVERAGE_SCHEMA })

// drop the second title of each duplicate pair
const dropTitles = new Set((coverage?.duplicateTitles ?? []).map(p => p[1]).filter(Boolean))
let issues = drafts.filter(d => !dropTitles.has(d.title))
if (dropTitles.size) log(`merged ${dropTitles.size} duplicate(s)`)

if (coverage?.missingIds?.length) {
  log(`gap-fill for ${coverage.missingIds.length} uncovered id(s): ${coverage.missingIds.join(', ')}`)
  const fill = await agent(extractPrompt({
    sections: `only the requirements with these ids: ${coverage.missingIds.join(', ')} (grep ${PRD} for each id)`,
    hint: 'these ids were missed by the first pass; draft exactly the issues needed to own them',
  }), { label: 'gap-fill', phase: 'Coverage', schema: ISSUES_SCHEMA })
  if (fill) issues = issues.concat(fill.issues)
}
log(`${issues.length} issues to publish`)

// ---- Publish ----
phase('Publish')
const SETUP_SCHEMA = {
  type: 'object',
  properties: { milestoneNumber: { type: 'number' }, labelsCreated: { type: 'number' } },
  required: ['milestoneNumber', 'labelsCreated'],
}
const setup = await agent(`Prepare the GitHub repo ${REPO} for an issue board using the gh CLI (already authenticated).

1. Ensure these labels exist (create any that are missing with a short description and a sensible colour; skip ones that already exist): ${LABELS.join(', ')}.
   Use: gh label create <name> --repo ${REPO} --description "..." --color <hex> --force
2. Ensure a milestone titled exactly "${MILESTONE}" exists. List with: gh api repos/${REPO}/milestones --jq '.[] | "\\(.number) \\(.title)"'. Create if missing with: gh api repos/${REPO}/milestones -f title="${MILESTONE}" -f description="Singhacks 2026 Ripple challenge MVP per PRD_SPECS.md"
Return the milestone number and how many labels you created.`, { label: 'labels+milestone', phase: 'Publish', schema: SETUP_SCHEMA, effort: 'low' })

const CREATED_SCHEMA = {
  type: 'object',
  properties: {
    created: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'number' }, url: { type: 'string' }, title: { type: 'string' },
          requirementIds: { type: 'array', items: { type: 'string' } },
          area: { type: 'string' }, priority: { type: 'string' },
        },
        required: ['number', 'url', 'title', 'requirementIds', 'area', 'priority'],
      },
    },
  },
  required: ['created'],
}

const BATCH = 8
const batches = []
for (let i = 0; i < issues.length; i += BATCH) batches.push(issues.slice(i, i + BATCH))

const created = (await pipeline(batches, (batch, _item, bi) =>
  agent(`Create these ${batch.length} GitHub issues in ${REPO} using the gh CLI (already authenticated). Milestone: "${MILESTONE}".

For each issue:
1. Write the body to a temp file (use the scratchpad or a temp dir; never inside the repo) because bodies are multi-line markdown.
2. Run: gh issue create --repo ${REPO} --title "<title>" --body-file <file> --milestone "${MILESTONE}" --label "<priority>" --label "area:<area>" --label "type:<type>" ${''}(add --label xrpl when xrpl is true). Labels already exist; do not create labels.
3. Capture the issue number and URL from the output.
Create them in the order given. If one fails, retry once, then report it with number -1.

Issues (JSON):
${JSON.stringify(batch, null, 2)}

Return the created list with number, url, title, requirementIds, area, priority for every issue.`,
    { label: `create-batch-${bi + 1}`, phase: 'Publish', schema: CREATED_SCHEMA, effort: 'low' })
)).filter(Boolean).flatMap(r => r.created)

const failed = created.filter(c => c.number < 0)
if (failed.length) log(`WARNING: ${failed.length} issue(s) failed to create: ${failed.map(f => f.title).join(' | ')}`)
log(`published ${created.length - failed.length} issues to ${REPO} under milestone "${MILESTONE}"`)

return {
  repo: REPO,
  milestone: MILESTONE,
  milestoneNumber: setup?.milestoneNumber ?? null,
  coverageGaps: coverage?.missingIds ?? [],
  issues: created.filter(c => c.number > 0),
  failed,
}
