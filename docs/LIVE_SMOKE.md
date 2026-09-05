# Live Testnet smoke test (PRD §18.3, §21)

Manual, run by hand before submission. It never runs on CI (`.github/workflows/ci.yml` runs only mocked tests). It proves one real XRPL Testnet payment end to end (AT-001, AT-011) and that a second execute of the same route creates no second payment (AT-005), then prints the row for [EVIDENCE.md](EVIDENCE.md).

## Prerequisites

1. `pnpm install`, Postgres up (`pnpm db:up`), migrations applied (README "Setup").
2. `.env` in the repo root with real Testnet values: `APP_ENV=hackathon`, `XRPL_NETWORK=xrpl:1`, a Testnet `XRPL_WSS_URL`, `AGENT_WALLET_SEED`, `SELLER_PAYTO_ADDRESS`, `RLUSD_ISSUER`, `DEMO_API_KEY`. The script loads `.env` itself with Node's `process.loadEnvFile` and validates it with the same `loadBuyerEnv` the API uses, so a Mainnet host or `xrpl:0` is rejected before anything runs (SEC-010).
3. Funded wallets (README "Fund the Testnet wallets"): agent wallet with >= 2 XRP and an RLUSD trust line plus balance >= `maxCost`; seller wallet with XRP and an RLUSD trust line. Step 2 of the script checks the agent wallet and prints the exact faucet or TrustSet instruction if anything is missing.
4. Seller and API running in two other terminals:

```bash
pnpm dev:seller   # http://localhost:4020
pnpm dev:api      # http://localhost:4010
```

## Command

```bash
pnpm smoke:testnet -- 0.020000
# options
pnpm smoke:testnet -- 0.020000 --api http://localhost:4010 --prompt "your coding prompt" --timeout-ms 180000
```

The positional argument is `maxCost` in `SETTLEMENT_ASSET` units (decimal string, > 0). Exit code 0 and a final `PASS` line mean every check below held; any mismatch prints `FAIL: ...` and exits 1. The seed is read for address derivation only and is never printed.

## What each step proves

| Step | Output | Proves |
| --- | --- | --- |
| 1 | `env ok: APP_ENV=hackathon network=xrpl:1 asset=RLUSD` | Config is valid and Testnet-only (SEC-010, NFR-009). |
| 2 | Agent address, XRP and RLUSD balances, account explorer link | Wallet exists on Testnet and can afford `maxCost` plus fees; trust line exists (DEC-004). |
| 3 | `POST /v1/routes` with a coding prompt, mode `balanced`: route id, task type, every candidate with eligibility, estimate, score, and the selected offer's reason | Classification, eligibility filtering and deterministic scoring over the curated registry (FR-020..041). No seller contact yet. |
| 4 | `POST /v1/routes/:id/execute` accepted (202) | Prompt-hash-bound mandate accepted (FR-002, AT-009 negative space). |
| 5 | State timeline polled from `GET /v1/routes/:id` until terminal: `QUOTING -> QUOTED -> POLICY_APPROVED -> SIGNED -> PAID_REQUEST_SENT -> VERIFYING -> SUCCEEDED` | 402 quote, policy gate, single signature, seller settle via facilitator, buyer-side ledger verification (§7.2, INV-001..003, INV-009). |
| 6 | Full public receipt (no seed, blob or prompt), tx hash, explorer link, then the transaction fetched from the ledger by hash: validated, `tesSUCCESS`, destination, amount, currency and issuer compared with the receipt | AT-011: the explorer shows the same hash, destination and amount as the receipt (FR-072, SEC-009). |
| 7 | Second `POST /v1/routes/:id/execute` on the same route: same routeId, state unchanged, receipt hash identical | AT-005 live: duplicate execute submits no new payment and re-signs nothing (INV-003, INV-011). |
| 8 | Two markdown rows | Ready to paste into [EVIDENCE.md](EVIDENCE.md) "Transactions" (rows 1 and 2). Also copy the agent, seller and issuer addresses into its "Wallets" table. |

Then open the explorer link in a browser, take the screenshots listed in EVIDENCE.md, and fill the AT-001, AT-005, AT-010 and AT-011 status cells.

## Troubleshooting

| Symptom | Meaning | Fix |
| --- | --- | --- |
| `FAIL: wallet underfunded` listing `faucet.altnet.rippletest.net` | Agent wallet has < 2 XRP (base reserve + trust line reserve + fees). | Fund the printed address at https://faucet.altnet.rippletest.net/ or with `client.fundWallet()`. |
| `FAIL: wallet underfunded` listing `tryrlusd.com` | RLUSD balance below `maxCost`. | Request Testnet RLUSD for the printed address at https://tryrlusd.com/; confirm the faucet's issuer equals `RLUSD_ISSUER`. |
| `FAIL: wallet underfunded` mentioning `No RLUSD trust line` | `account_lines` to `RLUSD_ISSUER` returned nothing. | Submit the TrustSet from README step 3 for the agent wallet, then rerun. |
| Route ends `PAYMENT_FAILED` with `tecPATH_DRY` | The **seller** (`SELLER_PAYTO_ADDRESS`) has no RLUSD trust line, or the issuer in the quote differs from the one the seller trusts, so the ledger found no path to deliver the IOU. No RLUSD moved; the XRP fee was spent. | Set the seller's trust line to `RLUSD_ISSUER` (same TrustSet snippet with the seller seed). Check `RLUSD_ISSUER` matches on both sides. |
| Route ends `PAYMENT_FAILED` with `tecUNFUNDED` / `tecUNFUNDED_PAYMENT` / `tecINSUFFICIENT_FUNDS` | Agent wallet cannot cover amount plus fee while keeping its reserve, or the RLUSD line balance dropped between the step-2 check and signing. | Top up XRP (faucet) or RLUSD (tryrlusd.com); lower `maxCost`. |
| Route ends `PAYMENT_FAILED` / `OUTCOME_UNKNOWN`, API log shows facilitator 5xx or timeout | `FACILITATOR_URL` (T54 Testnet facilitator) rejected or never answered the settle call. The buyer resolves by hash: if the ledger has no such tx after `LastLedgerSequence`, nothing was paid. | Check https://xrpl-facilitator-testnet.t54.ai reachability and the seller log. Rerun; a fresh route gets a fresh quote. Never re-sign the old one (INV-011). |
| `PAYMENT_FAILED` with no ledger entry, log says expired / `LastLedgerSequence` passed | The signed tx was not submitted before its `LastLedgerSequence` (slow facilitator, clock skew, long pause between quote and pay). No money moved. | Rerun; if it repeats, raise the seller's `maxTimeoutSeconds` for the quote or check ledger connectivity (`XRPL_WSS_URL`). |
| `FAIL: receipt/ledger mismatch (AT-011)` | Receipt and on-ledger tx disagree on destination, amount, currency, issuer, result or validation. | This is a real bug; do not record the run. Compare the printed lines against `packages/payments/src/client.ts` `resolveTransaction` and the seller's payTo. |
| `FAIL: second execute produced a new hash` | AT-005 violated: a second payment was created. | Stop. Check the `Payment` unique constraints and `claimPayment` in `apps/api/src/service.ts`. |
| `FAIL: API not reachable` / `ECONNREFUSED` | API not running or wrong `--api`. | `pnpm dev:api`; check `API_PORT`. |
| `FAIL: POST /v1/routes -> 401 UNAUTHORIZED` | `DEMO_API_KEY` in `.env` differs from the one the running API loaded. | Restart the API after editing `.env`. |
| `FAIL: no eligible offer within maxCost` | Every curated offer's estimate exceeds `maxCost`. | Use `0.020000` or higher. |
| `Invalid buyer configuration` at start | `.env` failed `loadBuyerEnv`. | Fix the listed variables; Mainnet values are rejected by design while `APP_ENV=hackathon`. |
