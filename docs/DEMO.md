# Demo rehearsal (PRD §22)

Presenter checklist for a clean browser session. Every step names what to say, what to click, and what must be on screen before moving on. Total runtime about four minutes; the payment itself takes 5 to 15 seconds on Testnet.

Everything on screen is XRPL **Testnet** from a demo agent wallet with no real-value funds (PRD §15.1). Say so once, at the start.

## Prerequisites (do these before the audience arrives)

- [ ] Docker Desktop running. `pnpm install` done once.
- [ ] Root `.env` present with real Testnet values (`APP_ENV=hackathon`, `XRPL_NETWORK=xrpl:1`, `AGENT_WALLET_SEED`, `SELLER_PAYTO_ADDRESS`, `RLUSD_ISSUER`, `DEMO_API_KEY` = `NEXT_PUBLIC_DEMO_API_KEY`). Never open `.env` on the projector.
- [ ] `POSTGRES_PORT=5433` and `DATABASE_URL=postgresql://subbuddy:subbuddy@localhost:5433/subbuddy` in `.env` if 5432 is taken on the demo machine (it is on ours).
- [ ] Agent wallet holds >= 2 XRP and >= 0.10 RLUSD; seller wallet has an RLUSD trust line. Check at https://testnet.xrpl.org/accounts/<agent address> or via step 2 below. One demo run costs 0.006000 RLUSD, so 0.10 RLUSD covers about fifteen takes.
- [ ] Four terminals open at the repo root. Ports 4010 (api), 4020 (seller), 3100 (web) free, or already serving a healthy instance you started yourself (see "If something breaks").

Shortcut: `pnpm demo` (scripts/demo.mjs) brings up Postgres, migrates, and runs seller + api + web in one terminal with prefixed logs, choosing 3100 for the web when 3000 is busy. The explicit version, one process per terminal, is:

```bash
# terminal 1
pnpm db:up && pnpm --filter @subbuddy/database db:migrate
pnpm dev:seller                                   # http://localhost:4020/health -> {"status":"ok"}
# terminal 2
pnpm dev:api                                      # http://localhost:4010/health -> {"status":"ok","service":"api"}
# terminal 3 (port 3000 is taken on our host, so 3100)
node scripts/with-env.mjs pnpm --filter @subbuddy/web exec next dev --webpack --port 3100
# terminal 4: keep for the duplicate-execute proof
```

- [ ] `curl -s localhost:4020/health` and `curl -s localhost:4010/health` both return `ok`.
- [ ] Open a **fresh private/incognito window** (no cached state, no history) at http://localhost:3100. Wait for the wallet bar to show a balance before starting. Do a full dry run once; the second run is the one you present.
- [ ] Second tab pre-opened at https://testnet.xrpl.org/ so the explorer is warm.

## Step 1: Setup (§22.1)

**Click:** nothing yet. Point at the page.

**Say:** "Kevin is a wallet-native AI inference router. One Testnet wallet, no seller accounts, no API keys on the buyer side. The agent picks the model and pays per request over x402 on XRPL."

**On screen:**

- [ ] "XRPL Testnet" badge in the header.
- [ ] Wallet bar: agent address `rMdi…r5e3`, non-zero RLUSD and XRP balances. Note the RLUSD figure aloud; you compare against it at the end.
- [ ] Four routing modes (Cheapest, Balanced, Quality, Fastest) with **Balanced** selected.
- [ ] Max cost field defaulting to or set to `0.020000` RLUSD.
- [ ] Notice "Hub discovery unavailable: routing over the curated registry only (FR-021)". Say: "The live market is the XRPL AI Hub at xrpl-ai.org, 1,700+ registered providers. Those listings are Mainnet, which this build rejects by policy, so three curated Testnet sellers stand in."

## Step 2: Prompt (§22.2)

**Click:** the prompt box. Paste exactly:

> Explain this distributed database query plan and identify the most expensive operation. Keep the answer under 500 words.

**Set:** mode **Balanced**, max cost `0.020000`.

**Say:** "A mid-tier task: needs technical reasoning but not the most expensive model. Budget is two cents of RLUSD."

**Click:** **Route and Run**.

## Step 3: Agent decision (§22.3)

The six-step timeline (Classify, Compare, Quote, Approve, Settle, Execute) starts ticking. Talk over the first three steps; they complete within a second or two.

**On screen, in the candidates table and the selected-offer card:**

- [ ] Classification label (for this prompt: technical reasoning / analysis, medium reasoning).
- [ ] Three considered offers: Fast Code, Deep Reasoning, Fast Text.
- [ ] One lower-ranked or excluded alternative: Deep Reasoning ranked lower on price, or Fast Text marked ineligible (`CAPABILITY_MISSING`).
- [ ] Selected offer with score factors (quality, latency, reliability, composite score).
- [ ] **Estimated** price from the registry next to the **Quoted** price from the seller's 402 response, both `0.006000 RLUSD`, mandate `<= 0.020000`.

**Say:** "The agent compared three offers and picked the one with the best quality-per-price for this task. The estimate came from our registry; the quote is authoritative, it came from the seller's HTTP 402 response, and the policy engine checked it against the mandate before anything was signed."

## Step 4: Commercial loop (§22.4)

Narrate only what the timeline shows. The Approve and Settle steps take longest (facilitator submit plus ledger validation, 5 to 15 s).

- [ ] Quote done: "Seller requested payment."
- [ ] Approve done: "Policy confirmed the quote was within the mandate: amount, asset, destination, network, invoice binding, expiry."
- [ ] Settle active then done: "The agent signed one exact Testnet payment. The facilitator submitted it. XRPL validated it."
- [ ] Execute done, status line "Done. Answer and receipt below.": "Only after validation did the seller release the purchased inference."

Do not fill silence with claims the screen does not make. If Settle takes a while, say "waiting for the ledger to validate" and wait. Never restart the run mid-payment (see "Testnet slow" below).

## Step 5: Evidence (§22.5)

**On screen:**

- [ ] The model answer. Say which upstream produced it: in the recorded run the seller ran gpt-4o-mini (`SELLER_UPSTREAM_PROVIDER=openai-compatible`); with `SELLER_UPSTREAM_PROVIDER=mock` the answer is a labelled canned string, so never present a mock answer as inference.
- [ ] XRPL payment card: "Validated", `0.006000 RLUSD` to Fast Code, short tx hash, ledger index, **View on explorer** link.
- [ ] Wallet bar RLUSD balance is exactly 0.006000 lower than in step 1.

**Click:** the receipt `<summary>` to expand it.

- [ ] Route id, prompt hash, task classification, policy checks all `ok`, payment state `SETTLED`, full tx hash, explorer URL.
- [ ] No fee or commission row anywhere (DEC-007, INV-008). Say it: "No platform commission. One payment, buyer to seller."

**Click:** **View on explorer** (opens testnet.xrpl.org in a new tab).

- [ ] Explorer shows: Payment, Success (`tesSUCCESS`), same hash as the receipt, 0.006 RLUSD, from the agent address to the seller address `r9jn…soUD`, `InvoiceID` present.

**Say:** "Same hash, same destination, same amount as the receipt. The buyer verified this on the ledger itself before marking the payment settled; a seller's word alone is never enough."

### Duplicate-execute proof (AT-005)

Two ways; do the first on the projector, keep the second as backup.

**A. Refresh.** Copy the route id from the receipt. In the browser open `http://localhost:3100/?route=<routeId>`. The route reloads read-only: payment still Validated, same hash, same ledger index. Say: "Replaying this route cannot create a second payment: one signature per quote, one payment per route, enforced by database uniqueness and a row lock."

**B. Re-POST execute** (terminal 4; `DEMO_API_KEY` from the environment, not typed on screen):

```bash
node scripts/with-env.mjs node -e "
const id = process.argv[1];
const body = JSON.stringify({ prompt: 'Explain this distributed database query plan and identify the most expensive operation. Keep the answer under 500 words.' });
const h = { authorization: 'Bearer ' + process.env.DEMO_API_KEY, 'content-type': 'application/json' };
const r = await fetch('http://localhost:4010/v1/routes/' + id + '/execute', { method: 'POST', headers: h, body });
console.log(r.status, await r.text());
" <routeId>
```

Expected: `202` with `state: "SUCCEEDED"` and the **same** `transactionHash`. Refresh the explorer account page for the agent wallet: still exactly one new Payment since step 1.

- [ ] Optional: click **History** in the header. The route is listed with state, quoted vs settled amount, and its explorer link (US-010).

**Close:** "One wallet, the right model for the task, paid only when used, verifiable on XRPL." Stop talking.

## If something breaks

| Symptom | Fix |
| --- | --- |
| `EADDRINUSE` on 4010 / 4020 / 3100, or `/health` answers from a process you did not start | `netstat -ano \| findstr :4010` (or the port), read the PID in the last column, `tasklist /FI "PID eq <pid>"` to confirm it is a stale `node.exe` of ours, then `taskkill /PID <pid> /F`. Never kill a PID you cannot identify; pick another port instead (`--port 3101`, `API_PORT=4011` plus `NEXT_PUBLIC_API_BASE_URL`). |
| Wallet bar shows RLUSD below 0.02, or route ends `POLICY_REJECTED` / `PAYMENT_FAILED` with `tecUNFUNDED` / `tecPATH_DRY` | Top up Testnet RLUSD: https://tryrlusd.com/, sign in with GitHub, request funds to the agent address, or transfer from a GemWallet account that already holds Testnet RLUSD. Confirm the faucet issuer equals `RLUSD_ISSUER`. `tecPATH_DRY` means the **seller** lacks the trust line (README "Fund the Testnet wallets", step 3). |
| Agent wallet XRP below 2 | https://faucet.altnet.rippletest.net/ to the agent address. Reserve plus trust line plus fees need about 1.2 XRP. |
| Settle step sits on "active" for more than 30 s | Testnet is slow or the facilitator is queued. **Wait.** The buyer resolves by hash; if the ledger never shows the tx past `LastLedgerSequence`, the route ends `PAYMENT_FAILED` with no money moved and you start a new route. Never restart the API or re-sign mid-flight (INV-011). |
| Route ends `OUTCOME_UNKNOWN` | Seller or facilitator response was lost. Refresh `/?route=<id>` after a few seconds; the API resolves the outcome from the ledger. If it becomes `PAID_EXECUTION_FAILED`, click **Retry delivery (no new payment)**. |
| `401 UNAUTHORIZED` in the UI or terminal 4 | `NEXT_PUBLIC_DEMO_API_KEY` and `DEMO_API_KEY` differ, or the API was started before `.env` changed. Restart api and web. |
| UI says "Wallet unavailable." | API not reachable from the browser: check `NEXT_PUBLIC_API_BASE_URL=http://localhost:4010` and `curl localhost:4010/health`. |
| Database errors at startup | `docker ps` shows no `postgres`: `pnpm db:up`, then `pnpm --filter @subbuddy/database db:migrate`. Check `POSTGRES_PORT` and `DATABASE_URL` agree (5433 on our host). |
| Explorer tab blank or slow | Use the link from the receipt again, or paste the hash at https://testnet.xrpl.org/. Fallback: show `docs/screenshots/06-explorer.png` from the recorded run and say so. |
| Everything is on fire | Show the recorded run: `docs/screenshots/01-setup.png` to `07-duplicate.png` and the transaction row in [EVIDENCE.md](EVIDENCE.md). Say it was recorded on 2026-09-05 and give the hash. |

## After the demo

- [ ] Paste the new tx hash and route id as a row in [EVIDENCE.md](EVIDENCE.md) "Transactions" if this run is to be cited.
- [ ] Close the incognito window; nothing to clean up in the repo.
