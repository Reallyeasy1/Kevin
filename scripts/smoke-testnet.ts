/**
 * Manual live XRPL Testnet smoke test (PRD §18.3, §21; AT-005, AT-011). Never run on CI.
 *
 *   pnpm smoke:testnet -- 0.020000 [--api http://localhost:4010] [--prompt "..."]
 *
 * Requires seller + api already running with real Testnet settings and `.env` in the repo root.
 * Prints the receipt, tx hash, explorer link and a docs/EVIDENCE.md row. Exits non-zero on any mismatch.
 * The wallet seed is validated by loadBuyerEnv but never printed.
 */
import { existsSync } from 'node:fs';
import { Client, Wallet } from 'xrpl';
import { loadBuyerEnv, settlementAsset } from '../packages/config/src/index.js';
import {
  isTerminalRouteState,
  type ExecuteResponse,
  type Receipt,
  type RouteResponse,
} from '../packages/contracts/src/index.js';
import {
  compareReceiptToLedger,
  dropsToXrp,
  evidenceRows,
  fetchLedgerTx,
  fundingProblems,
  parseArgs,
} from './smoke-lib.js';

const step = (n: number, msg: string) => console.log(`\n[${n}] ${msg}`);
// Explicit annotation so TS narrows after `if (!x) fail(...)`.
const fail: (msg: string) => never = (msg) => {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
};

// (1) env: same validation the API uses; Mainnet is already rejected there under APP_ENV=hackathon (SEC-010).
if (existsSync('.env')) process.loadEnvFile('.env');
const env = loadBuyerEnv();
if (env.APP_ENV !== 'hackathon')
  fail(`APP_ENV=${env.APP_ENV}; the smoke test only runs with APP_ENV=hackathon`);
if (env.XRPL_NETWORK !== 'xrpl:1')
  fail(`XRPL_NETWORK=${env.XRPL_NETWORK}; Testnet (xrpl:1) required`);
const asset = settlementAsset(env);
const args = parseArgs(process.argv.slice(2));
step(
  1,
  `env ok: APP_ENV=${env.APP_ENV} network=${env.XRPL_NETWORK} asset=${asset.code} api=${args.apiBase}`,
);

// (2) wallet address + balances straight from the ledger.
const address = Wallet.fromSeed(env.AGENT_WALLET_SEED).address;
const client = new Client(env.XRPL_WSS_URL);
await client.connect();
try {
  const info = await client.request({
    command: 'account_info',
    account: address,
    ledger_index: 'validated',
  });
  const xrp = dropsToXrp(info.result.account_data.Balance);
  let rlusd: string | null = null;
  if (asset.code === 'RLUSD' && asset.issuer) {
    const lines = await client.request({
      command: 'account_lines',
      account: address,
      peer: asset.issuer,
      ledger_index: 'validated',
    });
    const line = lines.result.lines.find((l) => l.currency.toUpperCase() === asset.currencyHex);
    rlusd = line ? line.balance : null;
  }
  step(2, `agent wallet ${address}  https://testnet.xrpl.org/accounts/${address}`);
  console.log(`    XRP   ${xrp}`);
  console.log(`    RLUSD ${rlusd ?? '(no trust line)'}`);
  const problems = fundingProblems(
    { address, xrp, rlusd, issuer: asset.issuer },
    asset.code,
    args.maxCost,
  );
  if (problems.length) fail(`wallet underfunded:\n  - ${problems.join('\n  - ')}`);

  // (3) POST /v1/routes
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${env.DEMO_API_KEY}`,
  };
  const api = async <T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: T }> => {
    const res = await fetch(`${args.apiBase}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json()) as T;
    if (!res.ok) fail(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
    return { status: res.status, json };
  };
  await api('GET', '/health').catch(() =>
    fail(`API not reachable at ${args.apiBase}; run pnpm dev:api`),
  );
  const route = (
    await api<RouteResponse>('POST', '/v1/routes', {
      prompt: args.prompt,
      mode: 'balanced',
      maxCost: args.maxCost,
    })
  ).json;
  step(3, `route ${route.routeId} state=${route.state} task=${route.taskProfile.taskType}`);
  for (const c of route.candidates)
    console.log(
      `    ${c.eligibility.padEnd(10)} ${c.offerId.padEnd(24)} est ${c.estimatedCost} score ${c.finalScore ?? '-'}`,
    );
  if (!route.selected) fail(`no eligible offer within maxCost ${args.maxCost}`);
  console.log(`    selected ${route.selected.offerId}: ${route.selected.reason}`);

  // (4) execute
  const exec1 = (
    await api<ExecuteResponse>('POST', `/v1/routes/${route.routeId}/execute`, {
      prompt: args.prompt,
    })
  ).json;
  step(4, `execute accepted: state=${exec1.state}`);

  // (5) poll GET until terminal; SSE carries the same states and needs a stream parser we do not need here.
  const deadline = Date.now() + args.timeoutMs;
  let receipt: Receipt = (await api<Receipt>('GET', `/v1/routes/${route.routeId}`)).json;
  let last = '';
  while (!isTerminalRouteState(receipt.state)) {
    if (receipt.state !== last) console.log(`    ${new Date().toISOString()} ${receipt.state}`);
    last = receipt.state;
    if (Date.now() > deadline) fail(`route still ${receipt.state} after ${args.timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, args.pollMs));
    receipt = (await api<Receipt>('GET', `/v1/routes/${route.routeId}`)).json;
  }
  step(5, `terminal state ${receipt.state}`);
  if (receipt.state !== 'SUCCEEDED')
    fail(
      `expected SUCCEEDED; payment=${receipt.payment.status} ${receipt.payment.failureCode ?? ''} execution=${receipt.execution.status} ${receipt.execution.failureCode ?? ''}`,
    );

  // (6) receipt vs ledger (AT-011)
  const p = receipt.payment;
  console.log(JSON.stringify(receipt, null, 2));
  if (!p.transactionHash) fail('receipt has no transactionHash');
  const hash = p.transactionHash;
  const explorer = p.explorerUrl ?? `${env.XRPL_EXPLORER_BASE}${hash}`;
  step(6, `tx ${hash}\n    ${explorer}`);
  const tx = await fetchLedgerTx(client, hash);
  const mismatches = compareReceiptToLedger(p, tx, asset);
  if (mismatches.length)
    fail(`receipt/ledger mismatch (AT-011):\n  - ${mismatches.join('\n  - ')}`);
  console.log(
    `    ledger: validated ${tx.resultCode} in ledger ${tx.ledgerIndex}, to ${tx.destination}, amount matches receipt`,
  );

  // (7) duplicate execute (AT-005 live)
  const exec2 = await api<ExecuteResponse>('POST', `/v1/routes/${route.routeId}/execute`, {
    prompt: args.prompt,
  });
  const again = (await api<Receipt>('GET', `/v1/routes/${route.routeId}`)).json;
  step(7, `second execute -> ${exec2.status} state=${exec2.json.state}`);
  if (exec2.json.routeId !== route.routeId) fail('second execute returned a different routeId');
  if (again.payment.transactionHash !== hash)
    fail(`second execute produced a new hash ${again.payment.transactionHash} (expected ${hash})`);
  if (again.payment.status !== 'SETTLED' || again.state !== 'SUCCEEDED')
    fail(`second execute changed state to ${again.state}/${again.payment.status}`);
  console.log('    same hash, no new payment');

  // (8) evidence row
  step(8, 'paste into docs/EVIDENCE.md "Transactions":');
  console.log(
    evidenceRows({
      dateIso: p.validatedAt ?? new Date().toISOString(),
      routeId: route.routeId,
      invoiceIdHash: tx.invoiceIdHash,
      hash,
      ledgerIndex: p.ledgerIndex ?? tx.ledgerIndex,
      amount: p.amount ?? '?',
      asset: asset.code,
      explorerUrl: explorer,
    }),
  );
  console.log('\nPASS');
} finally {
  await client.disconnect();
}
