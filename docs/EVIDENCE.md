# Evidence

Filled in by hand after the manual live Testnet smoke test (PRD §18.3, §21). Every entry must come from a real run; nothing here is generated. Explorer base: `https://testnet.xrpl.org/transactions/<hash>`.

All transactions are on XRPL **Testnet** from a demo agent wallet with no real-value funds.

## Wallets

| Role | Testnet address | Explorer |
| --- | --- | --- |
| Agent (buyer) wallet | `rMdiYvvzXMhZvkTkPX9Kma7F61o6m4r5e3` | https://testnet.xrpl.org/accounts/rMdiYvvzXMhZvkTkPX9Kma7F61o6m4r5e3 |
| Seller wallet (payTo) | `r9jnMEauwP4Mh3dfAHNdSjFM4yiYGmsoUD` | https://testnet.xrpl.org/accounts/r9jnMEauwP4Mh3dfAHNdSjFM4yiYGmsoUD |
| RLUSD Testnet issuer | `rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV` | https://testnet.xrpl.org/accounts/rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV |

## Transactions

| # | Date (UTC) | Purpose | Route ID | Invoice ID | Tx hash | Ledger index | Amount | Asset | Result | Explorer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2026-09-05 04:48:42 | Happy path (AT-001, AT-011) | `b88803e3-53ea-43a2-836b-a4c35ded6eb5` | `735A8B6E482899783F8DA47DB2B53480A3FB2B958AF1E0437733E89CA7CF16FE` | `4F930E96D76AF9D6F0D7696B168D017EBE463A0F7ED0584CAC06DD4248909C4D` | 20496465 | 0.006000 | RLUSD | `tesSUCCESS` | https://testnet.xrpl.org/transactions/4F930E96D76AF9D6F0D7696B168D017EBE463A0F7ED0584CAC06DD4248909C4D |
| 2 | 2026-09-05 04:48:42 | Duplicate execute (AT-005): same hash, no new tx | same as 1 | same as 1 | same as 1 | same as 1 | none | RLUSD | no new payment | same as 1 |
| 3 | 2026-09-05 03:51:41 | Trust line, agent wallet (TrustSet) | n/a | n/a | `3C1671DBA2718154FEAF7B9DF96EA43F35EA6C2182047E1B0DE2DE9EE0D97326` | 20495369 | limit 1000000 | RLUSD | `tesSUCCESS` | https://testnet.xrpl.org/transactions/3C1671DBA2718154FEAF7B9DF96EA43F35EA6C2182047E1B0DE2DE9EE0D97326 |
| 4 | 2026-09-05 03:51:52 | Trust line, seller wallet (TrustSet) | n/a | n/a | `21AE3CBBE4D718BC0DD3C4E6F835C69B9A850287FDB0BD1D76CAB8994CCE7E94` | 20495373 | limit 1000000 | RLUSD | `tesSUCCESS` | https://testnet.xrpl.org/transactions/21AE3CBBE4D718BC0DD3C4E6F835C69B9A850287FDB0BD1D76CAB8994CCE7E94 |
| 5 | 2026-09-05 05:02:02 | UI demo run (PRD §22, screenshots 01-07; AT-005 re-executed twice, same hash) | `9933e217-1226-4266-a1eb-3c879a73ca80` | `2CFEAA2CCB3F6038604E4F8528123EEC1CC94439A4FC6B0B402CBDEFCD2AAB27` | `89F5643E4F083E7BFACA72CDAEC37B4924A0147B81F0CEE58193408DE9C506E6` | 20496719 | 0.006000 | RLUSD | `tesSUCCESS` | https://testnet.xrpl.org/transactions/89F5643E4F083E7BFACA72CDAEC37B4924A0147B81F0CEE58193408DE9C506E6 |

Invoice IDs are the on-ledger `InvoiceID` field (SHA-256 of the x402 invoice id), read back from the ledger with xrpl.js. Row 5 was produced by `node scripts/with-env.mjs node scripts/demo-screenshots.mjs`, which drives the real UI once, re-executes the route through `POST /v1/routes/:id/execute` and fetches the transaction from Testnet; the receipt it saved is `docs/screenshots/05-receipt.json`.

Add rows for any XRP-fallback run (`SETTLEMENT_ASSET=XRP`) or paid-execution-failure demonstration (AT-007).

## Acceptance tests (PRD §17)

| AT | Description | Evidence type | Where | Status |
| --- | --- | --- | --- | --- |
| AT-001 | Successful balanced route | live run, tx #1 | above | passed 2026-09-05 (`pnpm smoke:testnet -- 0.020000`, exit 0) |
| AT-002 | No offer within budget | unit + API test | `apps/api/src/app.test.ts` | automated |
| AT-003 | Authoritative quote exceeds estimate | unit | `packages/payments/src/quote.test.ts` | automated |
| AT-004 | Destination substitution attack | unit | `packages/payments/src/quote.test.ts` | automated |
| AT-005 | Duplicate execute calls | API test + live run, tx #2 | `apps/api/src/app.test.ts`, above | passed 2026-09-05: second execute returned 202, same hash, no new payment |
| AT-006 | Lost submission response | API test | `apps/api/src/app.test.ts` | automated |
| AT-007 | Paid execution failure | API test | `apps/api/src/app.test.ts` | automated |
| AT-008 | Classifier failure | unit | `packages/routing/src/classifier.test.ts` | automated |
| AT-009 | Prompt mutation | API test | `apps/api/src/app.test.ts` | automated |
| AT-010 | Commission exclusion | manual: receipt and UI show no fee row | `docs/screenshots/05-receipt.png`, `docs/screenshots/05-receipt.json` (tx #5) | passed 2026-09-05: the XRPL payment card and the expanded receipt show one payment of 0.006000 RLUSD and no fee or commission row; the receipt JSON contains no field or value matching `fee` or `commission` (asserted by `scripts/demo-screenshots.mjs`), and the explorer shows a single Payment to the seller |
| AT-011 | Explorer evidence | manual, tx #1 | above | passed 2026-09-05: smoke script fetched tx from ledger, validated tesSUCCESS, destination and amount match receipt |
| AT-012 | Seller payment gate | seller test | `apps/seller/src/app.test.ts` | automated |

## Screenshots

Taken 2026-09-05 at 1280x900 by `scripts/demo-screenshots.mjs` against the live Testnet stack (transaction #5). Prompt: "Write a TypeScript function that parses an ISO-8601 duration string into total seconds, with tests." Mode Balanced, max cost 0.020000 RLUSD. Route `9933e217-1226-4266-a1eb-3c879a73ca80`, tx `89F5643E4F083E7BFACA72CDAEC37B4924A0147B81F0CEE58193408DE9C506E6`.

| Step (PRD §22) | File | Notes |
| --- | --- | --- |
| Setup: Testnet badge, wallet balance, modes, max cost | `docs/screenshots/01-setup.png` | Agent wallet `rMdiYvvzXMhZvkTkPX9Kma7F61o6m4r5e3`, "XRPL Testnet" badge, balances 0.994000 RLUSD / 99.999976 XRP before the run, the four modes with Balanced selected, max cost 0.020000 RLUSD, idle six-step timeline. |
| Agent decision: classification, three candidates, score factors | `docs/screenshots/02-decision.png` | Mid-run (Approve step active). Status line: quoted 0.006000 RLUSD from Fast Code against the 0.020000 mandate. Candidates table: Fast Code selected (quality 0.88, latency 0.70, reliability 0.97, score 0.7780, 0.006000 estimated and 0.006000 quoted), Deep Reasoning not quoted (0.92 quality, 0.015000 estimated, score 0.5090), Fast Text ineligible (CAPABILITY_MISSING). Classification `coding · medium reasoning` is in the receipt (05). |
| Quote: estimate vs authoritative 402 quote | `docs/screenshots/03-quote.png` | Selected offer card: Fast Code `demo/fast-code`, score 0.7780, Estimated 0.006000 RLUSD (registry) next to Quoted 0.006000 RLUSD (x402 402 response), mandate ≤ 0.020000 RLUSD on XRPL Testnet, and the selection rationale. |
| Commercial loop timeline: policy, signed, sent, verifying, succeeded | `docs/screenshots/04-timeline.png` | All six steps done (Classify, Compare, Quote, Approve, Settle, Execute), status "Done. Answer and receipt below.", Route and Run re-enabled. |
| Result + economic receipt with tx hash | `docs/screenshots/05-receipt.png` | XRPL payment card "Validated", 0.006000 RLUSD to Fast Code, tx `89F5643E…C506E6`, ledger 20496719, explorer link; the answer; the expanded receipt with route id, prompt hash, task, policy checks (all ok), payment SETTLED, full tx hash and explorer URL. No fee or commission row (AT-010). Raw JSON: `docs/screenshots/05-receipt.json`. |
| Explorer page for tx #5 | `docs/screenshots/06-explorer.png` | testnet.xrpl.org: Payment, Success, hash `89F5643E4F08…`, 0.006 RLUSD (issuer `rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV`) from the agent wallet to `r9jnMEauwP4Mh3dfAHNdSjFM4yiYGmsoUD`, ledger 20496719, 2026-09-05 05:02:02 UTC. |
| Duplicate execute: same hash, no new payment | `docs/screenshots/07-duplicate.png` | After two further `POST /v1/routes/9933e217…/execute` calls (both 202, state SUCCEEDED), the route reloaded via `/?route=<id>`: payment still Validated, same tx `89F5643E…C506E6`, same ledger 20496719; the ledger holds one Payment for this InvoiceID (AT-005). |

## Builder feedback

| Item | Evidence | Status |
| --- | --- | --- |
| Feedback Stop hook active throughout the build | `.claude/settings.json` (Stop hook), `ripple/hook/submit.mjs` | submitted throughout the build via the Stop hook (see `.claude/settings.json`); count kept by the hackathon server (`submit.mjs` has no list mode) |
| Final Google form submitted | https://forms.gle/FZckiEAMU8oWXVbX7 | `TODO` date |
