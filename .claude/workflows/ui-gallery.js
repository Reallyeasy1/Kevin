// Workflow 5: parallel UI screenshot gallery + visual QA against the running demo (main checkout, port 3100).
//   Workflow({ scriptPath: ".claude/workflows/ui-gallery.js", args: { root } })

export const meta = {
  name: 'ui-gallery',
  description: 'Seven parallel agents screenshot every page and state of the running UI into docs/screenshots/gallery and report visual defects',
  phases: [{ title: 'Shoot', detail: 'one agent per page/state, in parallel, against http://localhost:3100' }],
}

const ROOT = args.root
const OUT = `${ROOT}/docs/screenshots/gallery`

const COMMON = `Repository: ${ROOT} (main checkout). The app is RUNNING: web http://localhost:3100, api 4010, seller 4020 (real gpt-4o-mini upstream), Postgres 5433. Do not start, restart or kill any service. Do not edit any source file, test, or doc; your only outputs are PNG files under ${OUT}/ (create the folder if missing) and your report.

How to screenshot: @playwright/test with chromium is installed at the repo root. Write a temporary script ${ROOT}/.shot-<yourname>.mjs (ESM, \`import { chromium } from '@playwright/test'\`), run it with \`node\` from ${ROOT}, then DELETE the script. Use waitUntil 'networkidle' plus explicit waits for the elements you need; the dev server may take up to 60 s on a cold page compile, so use generous timeouts (120 s) and retry once on a timeout. Default viewport 1280x900 unless told otherwise; use fullPage:true when the content is taller than the viewport. Name files exactly as instructed. Never print or screenshot anything from .env. The demo API key is only needed if you call the API directly: read it via \`node scripts/with-env.mjs node -e "console.log(process.env.DEMO_API_KEY)"\` and never write it into a file or your report.

PAYMENTS: a real XRPL Testnet RLUSD payment happens whenever a route is executed (Route and Run in the router UI, or Send in the chat). Only agents whose task says "you MAY pay" may do that, at most the number of times stated. Everyone else must not click Route and Run / Send.

Report (structured): for each PNG, a one-line caption of what it shows; then a list of visual defects you noticed (overflow, clipped text, misaligned controls, unreadable contrast, missing states, console errors) with the file and a suggested fix; nothing else.`

const SHOT_SCHEMA = {
  type: 'object',
  properties: {
    shots: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, caption: { type: 'string' } }, required: ['file', 'caption'] } },
    defects: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['file', 'problem', 'fix'] } },
    paymentsMade: { type: 'number' },
  },
  required: ['shots', 'defects', 'paymentsMade'],
}

const JOBS = [
  { key: 'router-idle', task: `Router home page http://localhost:3100/ before any run: full page at 1280x900 -> router-01-idle.png; a 360x780 mobile full-page shot -> router-01-idle-mobile.png; a shot with keyboard focus visible on the Route and Run button (Tab to it) -> router-01-focus.png. Do NOT pay.` },
  { key: 'router-run', task: `You MAY pay at most ONE time. On http://localhost:3100/ type the prompt "Write a Python function that validates an IBAN and explain the checksum in two sentences.", keep Balanced and max cost 0.020000, click Route and Run. Capture: router-02-inflight.png as soon as the timeline shows Quote or Approve active (poll every 200 ms, do not wait for completion); router-03-done.png full page when the status says "Done. Answer and receipt below."; router-04-receipt.png with the Economic receipt expanded (click it) cropped to the receipt card; router-05-candidates.png cropped to the Candidates considered card. Note the route id and tx hash in your captions.` },
  { key: 'router-rejections', task: `Do NOT pay. Two failure states on http://localhost:3100/ that never reach payment: (a) set max cost to 0.000100 with prompt "Summarize the plot of Macbeth in three sentences." and click Route and Run -> the route should end NO_ELIGIBLE_OFFER (or a quote rejection) with no payment; capture router-06-no-eligible.png full page. (b) reload, set max cost 0.020000, prompt "Explain quantum tunnelling to a 12-year-old.", and click Route and Run; when the route reaches the QUOTED/Approve step the UI executes automatically, so instead use the API directly to create a quoted route without executing: POST http://localhost:4010/v1/routes with the demo key and body {"prompt":"Explain quantum tunnelling to a 12-year-old.","mode":"balanced","maxCost":"0.020000"}, then open http://localhost:3100/?route=<routeId> and capture router-07-quoted-state.png (a route sitting at QUOTED with the mandate and estimate vs quote visible, no payment). If (b) is not reachable via the URL, say so in defects.` },
  { key: 'history', task: `Do NOT pay. http://localhost:3100/history: wait until the rows load (they exist from earlier runs), capture history-01.png full page at 1280x900 and history-01-mobile.png at 360x780. Click the first row's explorer or details link if present and capture where it leads -> history-02-detail.png.` },
  { key: 'chat', task: `You MAY pay at most TWO times. http://localhost:3100/chat: capture chat-01-empty.png (fresh, no conversations: if the sidebar already lists conversations, click "+ New chat" first so the pane is empty). Send "What is x402 and why does it matter for AI agents? Two short paragraphs." and wait for the reply footer (cost, tx); then send "Now give me the same answer as a three-bullet summary." and wait; capture chat-02-conversation.png. Reload the page and capture chat-03-after-reload.png showing the restored conversation and sidebar entry. Then a 360x780 mobile shot of the same conversation with the sidebar toggle visible -> chat-04-mobile.png.` },
  { key: 'answer-markdown', task: `Do NOT pay. Open http://localhost:3100/?route=19b212e6-f5e2-4c3e-a5c8-0f3190ea1c66 (an earlier successful route whose answer contains a fenced TypeScript code block, headings and lists). Capture answer-01-markdown.png cropped to the Answer card (full height) and answer-02-codeblock.png cropped to the first <pre> block. Also open http://localhost:3100/?route=3b95821f-dc26-4f84-b28d-dc33edd1bf2b (an early POLICY_REJECTED route) and capture answer-03-policy-rejected.png full page; if that route no longer exists, use GET http://localhost:4010/v1/routes?limit=50 with the demo key to find any POLICY_REJECTED route id instead.` },
  { key: 'a11y-contrast', task: `Do NOT pay. Accessibility pass on http://localhost:3100/ and /chat and /history at 1280x900: with Playwright, Tab through each page and screenshot the focused element outline on three different controls per page -> a11y-01-router-focus.png, a11y-02-chat-focus.png, a11y-03-history-focus.png (one composite per page is fine: take the shot when focus is on the most important control). Then emulate prefers-reduced-motion and a 200% zoom (viewport 640x900 with deviceScaleFactor 2) on the router page -> a11y-04-zoom200.png. Report any element that loses its focus ring, any text under 12px, and any contrast that looks below 4.5:1 (estimate from computed colors).` },
]

phase('Shoot')
const results = await parallel(JOBS.map(j => () =>
  agent(`${COMMON}\n\nYour name: ${j.key}. Your task: ${j.task}`, { label: `shoot:${j.key}`, phase: 'Shoot', schema: SHOT_SCHEMA, effort: 'low' })
))
results.forEach((r, i) => log(r ? `${JOBS[i].key}: ${r.shots.length} shots, ${r.defects.length} defects, ${r.paymentsMade} payments` : `${JOBS[i].key}: FAILED`))

return {
  shots: results.flatMap((r, i) => (r?.shots ?? []).map(s => ({ ...s, by: JOBS[i].key }))),
  defects: results.flatMap((r, i) => (r?.defects ?? []).map(d => ({ ...d, by: JOBS[i].key }))),
  paymentsMade: results.reduce((n, r) => n + (r?.paymentsMade ?? 0), 0),
  failed: JOBS.filter((_, i) => !results[i]).map(j => j.key),
}
