# Evidence

Filled in by hand after the manual live Testnet smoke test (PRD §18.3, §21). Every entry must come from a real run; nothing here is generated. Explorer base: `https://testnet.xrpl.org/transactions/<hash>`.

All transactions are on XRPL **Testnet** from a demo agent wallet with no real-value funds.

## Wallets

| Role | Testnet address | Explorer |
| --- | --- | --- |
| Agent (buyer) wallet | `TODO r...` | `https://testnet.xrpl.org/accounts/<address>` |
| Seller wallet (payTo) | `TODO r...` | `https://testnet.xrpl.org/accounts/<address>` |
| RLUSD Testnet issuer | `TODO r...` | `https://testnet.xrpl.org/accounts/<address>` |

## Transactions

| # | Date (UTC) | Purpose | Route ID | Invoice ID | Tx hash | Ledger index | Amount | Asset | Result | Explorer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `TODO` | Happy path (AT-001, AT-011) | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | RLUSD | `tesSUCCESS` | `TODO` |
| 2 | `TODO` | Duplicate execute (AT-005): same hash, no new tx | same as 1 | same as 1 | same as 1 | same as 1 | none | RLUSD | no new payment | same as 1 |
| 3 | `TODO` | Trust line, agent wallet (TrustSet) | n/a | n/a | `TODO` | `TODO` | limit `TODO` | RLUSD | `tesSUCCESS` | `TODO` |
| 4 | `TODO` | Trust line, seller wallet (TrustSet) | n/a | n/a | `TODO` | `TODO` | limit `TODO` | RLUSD | `tesSUCCESS` | `TODO` |

Add rows for any XRP-fallback run (`SETTLEMENT_ASSET=XRP`) or paid-execution-failure demonstration (AT-007).

## Acceptance tests (PRD §17)

| AT | Description | Evidence type | Where | Status |
| --- | --- | --- | --- | --- |
| AT-001 | Successful balanced route | live run, tx #1 | above | `TODO` |
| AT-002 | No offer within budget | unit + API test | `apps/api/src/app.test.ts` | automated |
| AT-003 | Authoritative quote exceeds estimate | unit | `packages/payments/src/quote.test.ts` | automated |
| AT-004 | Destination substitution attack | unit | `packages/payments/src/quote.test.ts` | automated |
| AT-005 | Duplicate execute calls | API test + live run, tx #2 | `apps/api/src/app.test.ts`, above | `TODO` (live) |
| AT-006 | Lost submission response | API test | `apps/api/src/app.test.ts` | automated |
| AT-007 | Paid execution failure | API test | `apps/api/src/app.test.ts` | automated |
| AT-008 | Classifier failure | unit | `packages/routing/src/classifier.test.ts` | automated |
| AT-009 | Prompt mutation | API test | `apps/api/src/app.test.ts` | automated |
| AT-010 | Commission exclusion | manual: receipt and UI show no fee row | tx #1 receipt, screenshot 05 | `TODO` |
| AT-011 | Explorer evidence | manual, tx #1 | above | `TODO` |
| AT-012 | Seller payment gate | seller test | `apps/seller/src/app.test.ts` | automated |

## Screenshots

Save under `docs/screenshots/` and link here.

| Step (PRD §22) | File | Notes |
| --- | --- | --- |
| Setup: Testnet badge, wallet balance, modes, max cost | `docs/screenshots/01-setup.png` | `TODO` |
| Agent decision: classification, three candidates, score factors | `docs/screenshots/02-decision.png` | `TODO` |
| Quote: estimate vs authoritative 402 quote | `docs/screenshots/03-quote.png` | `TODO` |
| Commercial loop timeline: policy, signed, sent, verifying, succeeded | `docs/screenshots/04-timeline.png` | `TODO` |
| Result + economic receipt with tx hash | `docs/screenshots/05-receipt.png` | `TODO` |
| Explorer page for tx #1 | `docs/screenshots/06-explorer.png` | `TODO` |
| Duplicate execute: same hash, no new payment | `docs/screenshots/07-duplicate.png` | `TODO` |

## Builder feedback

| Item | Evidence | Status |
| --- | --- | --- |
| Feedback Stop hook active throughout the build | `.claude/settings.json`, hook submissions | `TODO` count / date range |
| Final Google form submitted | https://forms.gle/FZckiEAMU8oWXVbX7 | `TODO` date |
