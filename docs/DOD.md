# Definition of Done (PRD §21)

One row per §21 bullet. "Evidence" points at the file, test, or [EVIDENCE.md](EVIDENCE.md) row that proves it; automated rows are re-proven by `pnpm test` / `pnpm test:e2e` on every CI run (`.github/workflows/ci.yml`). Rows marked **human** need a person to perform or confirm them before submission.

Legend: `[x]` done, `[ ]` open.

| # | §21 bullet | Evidence | Status |
| --- | --- | --- | --- |
| 1 | All P0 functional requirements implemented or explicitly waived in the PRD | FR IDs traced in code comments and tests; `tests/acceptance/*.test.ts` (AT-001..012, FR-002, NFR-001/004/005); FR-021 hub discovery is P1 and documented as a build-time import in README "The market it draws from" and `packages/config/src/hub.ts` | `[x]` |
| 2 | AT-001 through AT-012 pass or have recorded manual evidence | `tests/acceptance/at-001..at-012*.test.ts` (automated); AT-001, AT-005, AT-010, AT-011 also recorded live in EVIDENCE.md "Acceptance tests" (tx #1, #2, #5) | `[x]` |
| 3 | At least one successful XRPL Testnet transaction hash recorded | EVIDENCE.md "Transactions" rows 1 and 5: `4F930E96…909C4D` (ledger 20496465), `89F5643E…C506E6` (ledger 20496719), both `tesSUCCESS`, explorer links included | `[x]` |
| 4 | The paid seller returns real inference | Seller calls upstream only after facilitator settle (`apps/seller/src/app.ts`, AT-012 in `tests/acceptance/at-012-seller-payment-gate.test.ts`). Default `SELLER_UPSTREAM_PROVIDER=mock` returns a canned answer; set `openai-compatible` plus base URL and key for a live model (README "Run"). The recorded runs (tx #1, #5) used the mock upstream behind a real paid gate | `[x]` mock upstream; **human**: switch to `openai-compatible` for the presented demo if a key is available |
| 5 | Duplicate execute requests do not create duplicate payment | `tests/acceptance/at-005-duplicate-execute.test.ts`; Prisma `UNIQUE(routeId/quoteId/invoiceId/transactionHash)` and row lock (ARCHITECTURE.md INV-003, INV-011); live: EVIDENCE.md row 2 and screenshot `07-duplicate.png` (same hash after two further executes) | `[x]` |
| 6 | Secrets absent from the repository and logs | `.env` gitignored; `.claude/hooks/guard-secrets.mjs` blocks edits to `.env*`; Pino redaction `REDACT_PATHS` in `apps/api/src/app.ts` and seller (`SEC-001`); receipts strip seed/blob/prompt (`apps/api/src/service.ts` getReceipt; asserted in `apps/api/src/app.test.ts` and `tests/acceptance/at-001-balanced-route.test.ts`) | `[x]`; **human**: run `git grep -nE "^s[A-Za-z0-9]{28}$"` and eyeball `git log -p --all -- .env*` returns nothing before pushing the final commit |
| 7 | Public repository includes setup instructions | README "Setup", "Fund the Testnet wallets", "Run", "Test"; [LIVE_SMOKE.md](LIVE_SMOKE.md); [DEMO.md](DEMO.md) | `[x]` |
| 8 | Repository includes an architecture diagram | README "Architecture" (mermaid flowchart); [ARCHITECTURE.md](ARCHITECTURE.md) components and state diagrams | `[x]` |
| 9 | Environment variables documented with non-secret examples | `.env.example`, every variable commented, placeholders only; README "Setup" table of the four values that must change | `[x]` |
| 10 | A new developer can run the mocked smoke test | `pnpm install && pnpm test && pnpm test:e2e` needs no network, wallet or Postgres (`createFakeDb`); CI runs exactly this on ubuntu from a fresh checkout (`.github/workflows/ci.yml`) | `[x]` CI green on `main`; **human**: fresh-clone check on a second machine if time allows |
| 11 | The demo can be completed from a clean browser session | [DEMO.md](DEMO.md) rehearsal checklist (incognito window, prerequisites, per-step expected state); recorded run 2026-09-05 05:02 UTC, screenshots `01-setup.png` … `07-duplicate.png`, tx #5 | `[x]` recorded; **human**: one live rehearsal on the presentation machine before the slot |
| 12 | Builder feedback requirement completed | Stop hook registered in `.claude/settings.json`, submits via `ripple/hook/submit.mjs` throughout the build (EVIDENCE.md "Builder feedback"); final form https://forms.gle/FZckiEAMU8oWXVbX7 | `[x]` hook; `[ ]` **human**: submit the Google form near the end and fill the date in EVIDENCE.md |
| 13 | Demo and README make clear the wallet is a Testnet agent demo wallet | README blockquote under the title (DEC-006, §15.1); "XRPL Testnet" badge in the UI header (`apps/web/app/layout.tsx`); DEMO.md opening line; EVIDENCE.md header | `[x]` |
| 14 | No platform commission executed or displayed | `tests/acceptance/at-010-commission-exclusion.test.ts`; no second `Payment` code path (ARCHITECTURE.md INV-008); live: `docs/screenshots/05-receipt.json` contains no `fee`/`commission` field, asserted by `scripts/demo-screenshots.mjs`; explorer shows one Payment (EVIDENCE.md AT-010) | `[x]` |

## Human-only rows before submission

- [ ] Row 6: final secret sweep of the tree and history.
- [ ] Row 11: live rehearsal from an incognito window on the presentation machine (DEMO.md).
- [ ] Row 12: submit the builder feedback form and date it in EVIDENCE.md.
- [ ] Optional rows 4 and 10: live upstream model for the presented run; fresh-clone check on another machine.

## Never-cut list (PRD §20.1) cross-check

| Item | Where proven |
| --- | --- |
| Real XRPL transaction | EVIDENCE.md tx #1, #5 |
| x402 payment gate | AT-012; `apps/seller/src/app.ts` 402 before inference |
| Agent selection among multiple offers | AT-001, NFR-005 ranking snapshot; screenshot `02-decision.png` |
| Useful paid output | Screenshot `05-receipt.png`; row 4 above |
| Transaction evidence | AT-011; receipt hash = explorer hash (screenshot `06-explorer.png`) |
| Duplicate-payment protection | AT-005; row 5 above |
