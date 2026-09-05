#!/usr/bin/env node
/**
 * PRD §22 demo evidence: walks the live UI once (one real Testnet payment), saves the screenshots that
 * docs/EVIDENCE.md lists under docs/screenshots/, re-executes the route (AT-005) and fetches the tx from
 * the ledger for the evidence row. Manual only, never on CI (PRD §18.3).
 *
 *   node scripts/with-env.mjs node scripts/demo-screenshots.mjs [--web http://localhost:3100]
 *
 * Reads DEMO_API_KEY, NEXT_PUBLIC_API_BASE_URL and XRPL_WSS_URL from the environment; prints none of them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { Client } from 'xrpl';

const PROMPT =
  'Write a TypeScript function that parses an ISO-8601 duration string into total seconds, with tests.';
const MAX_COST = '0.020000';
const OUT = 'docs/screenshots';
const argv = process.argv.slice(2);
const web = argv[argv.indexOf('--web') + 1] || 'http://localhost:3100';
const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4010';
const key = process.env.DEMO_API_KEY;
if (!key) throw new Error('DEMO_API_KEY missing; run through scripts/with-env.mjs');

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const shot = (name, opts = {}) => page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
const log = (msg) => console.log(`[demo] ${msg}`);

try {
  // 01 setup: Testnet badge, balance, modes, max cost.
  await page.goto(web);
  await page.getByTestId('network-badge').waitFor();
  await page.getByLabel('Balances').waitFor();
  await page.getByLabel('Prompt', { exact: true }).fill(PROMPT);
  await page.getByRole('radio', { name: /^balanced/ }).check({ force: true });
  await page.getByLabel('Max cost').fill(MAX_COST);
  await shot('01-setup');

  // Route and Run creates the route and executes it in one go; catch the route id from the API call.
  const created = page.waitForResponse((r) => r.url().endsWith('/v1/routes') && r.status() === 201);
  await page.getByRole('button', { name: 'Route and Run' }).click();
  const route = await (await created).json();
  log(
    `route ${route.routeId} task=${route.taskProfile.taskType} selected=${route.selected?.offerId}`,
  );

  // 02 decision: candidate table with score factors, while the payment is still in flight.
  await page.getByTestId('candidates').waitFor();
  await shot('02-decision', { fullPage: true });

  // 03 quote: selected offer card, estimate vs authoritative quote.
  const quoted = page.getByTestId('quoted-cost');
  await quoted.filter({ hasText: /^\d/ }).waitFor({ timeout: 60_000 });
  await page.getByTestId('selected-offer').scrollIntoViewIfNeeded();
  await shot('03-quote');

  // 04 timeline: wait for SUCCEEDED (payment validated on ledger + inference delivered).
  const status = page.getByTestId('status');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid=status]')?.getAttribute('data-ui-state') === 'succeeded',
    null,
    { timeout: 180_000 },
  );
  await page.getByTestId('answer').locator('pre').waitFor({ timeout: 30_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('04-timeline');
  log(`status: ${await status.textContent()}`);

  // 05 receipt: answer + expanded economic receipt with the tx hash.
  await page.getByTestId('receipt').locator('summary').click();
  await page.getByTestId('payment-evidence').scrollIntoViewIfNeeded();
  await shot('05-receipt', { fullPage: true });
  const explorerUrl = await page.getByTestId('explorer-link').getAttribute('href');
  const hash = explorerUrl.split('/').pop();
  log(`tx ${hash}`);

  // Receipt JSON (public fields only, SEC-009) for AT-010: no fee or commission field anywhere.
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  const receipt = await (await fetch(`${apiBase}/v1/routes/${route.routeId}`, { headers })).json();
  writeFileSync(`${OUT}/05-receipt.json`, JSON.stringify(receipt, null, 2) + '\n');
  if (/fee|commission/i.test(JSON.stringify(receipt)))
    throw new Error('receipt mentions a fee (INV-008)');

  // 06 explorer.
  await page.goto(explorerUrl, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
  await page
    .getByRole('button', { name: 'Reject Non-Essential' })
    .click({ timeout: 5000 })
    .catch(() => {});
  await page.waitForTimeout(3000);
  await shot('06-explorer');

  // 07 duplicate execute (AT-005): same route, same prompt, twice more via the API; then show the receipt.
  const dup = [];
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`${apiBase}/v1/routes/${route.routeId}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: PROMPT }),
    });
    dup.push({ status: r.status, body: await r.json() });
  }
  const again = await (await fetch(`${apiBase}/v1/routes/${route.routeId}`, { headers })).json();
  if (again.payment.transactionHash !== hash)
    throw new Error('duplicate execute produced a new hash');
  log(
    `duplicate execute -> ${dup.map((d) => `${d.status} ${d.body.state}`).join(', ')}; same hash`,
  );
  await page.goto(`${web}/?route=${route.routeId}`);
  await page.getByTestId('network-badge').waitFor();
  await page.getByTestId('receipt').locator('summary').click();
  await page.getByTestId('tx-hash').waitFor();
  await shot('07-duplicate', { fullPage: true });

  // Ledger facts for the evidence row.
  const client = new Client(process.env.XRPL_WSS_URL ?? 'wss://s.altnet.rippletest.net:51233');
  await client.connect();
  const tx = (await client.request({ command: 'tx', transaction: hash })).result;
  await client.disconnect();
  const txj = tx.tx_json ?? tx;
  const meta = typeof tx.meta === 'object' ? tx.meta : {};
  console.log(
    JSON.stringify(
      {
        routeId: route.routeId,
        hash,
        ledgerIndex: tx.ledger_index,
        result: meta.TransactionResult,
        invoiceId: txj.InvoiceID,
        destination: txj.Destination,
        delivered: meta.delivered_amount,
        validatedAt: receipt.payment.validatedAt,
        amount: receipt.payment.amount,
        asset: receipt.payment.assetCode,
        explorerUrl,
        duplicate: dup.map((d) => ({ status: d.status, state: d.body.state })),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
