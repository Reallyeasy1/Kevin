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
| AT-010 | Commission exclusion | manual: receipt and UI show no fee row | tx #1 receipt, screenshot 05 | `TODO` |
| AT-011 | Explorer evidence | manual, tx #1 | above | passed 2026-09-05: smoke script fetched tx from ledger, validated tesSUCCESS, destination and amount match receipt |
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
