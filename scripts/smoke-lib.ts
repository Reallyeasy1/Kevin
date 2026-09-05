/**
 * Pure helpers for scripts/smoke-testnet.ts (PRD §18.3, AT-005, AT-011). No network, no SDK imports, so
 * tests/unit/smoke-lib.test.ts runs without root-level xrpl.js. Amounts are decimal strings throughout
 * (INV-006); comparisons normalise strings, never go through number.
 */
import type { PaymentReceipt, SettlementAssetCode } from '../packages/contracts/src/index.js';

export interface SmokeArgs {
  maxCost: string;
  apiBase: string;
  prompt: string;
  /** Poll GET /v1/routes/:id this often while waiting for a terminal state. */
  pollMs: number;
  /** Give up waiting after this long. */
  timeoutMs: number;
}

export const DEFAULT_PROMPT =
  'Write a TypeScript function that parses an ISO-8601 duration string into total seconds, with unit tests. Keep it under 300 words.';

/** `pnpm smoke:testnet -- <maxCost> [--api http://host:port] [--prompt "..."]`. */
export function parseArgs(argv: readonly string[]): SmokeArgs {
  const out: SmokeArgs = {
    maxCost: '',
    apiBase: 'http://localhost:4010',
    prompt: DEFAULT_PROMPT,
    pollMs: 2_000,
    timeoutMs: 180_000,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--') continue; // pnpm forwards the separator itself
    if (a === '--api') out.apiBase = next().replace(/\/+$/, '');
    else if (a === '--prompt') out.prompt = next();
    else if (a === '--timeout-ms') out.timeoutMs = Number(next());
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else positional.push(a);
  }
  const maxCost = positional[0];
  if (!maxCost || !/^\d+(\.\d+)?$/.test(maxCost) || !/[1-9]/.test(maxCost))
    throw new Error('usage: pnpm smoke:testnet -- <maxCost decimal, e.g. 0.020000> [--api URL]');
  out.maxCost = maxCost;
  return out;
}

/** "0.0200" and "0.02" are the same amount; "20000" drops is "0.02" XRP. */
export function normalizeDecimal(v: string): string {
  const [int = '0', frac = ''] = v.split('.');
  const i = int.replace(/^0+(?=\d)/, '');
  const f = frac.replace(/0+$/, '');
  return f ? `${i}.${f}` : i;
}

export function dropsToXrp(drops: string): string {
  if (!/^\d+$/.test(drops)) throw new Error(`not a drops amount: ${drops}`);
  const padded = drops.padStart(7, '0');
  return normalizeDecimal(`${padded.slice(0, -6)}.${padded.slice(-6)}`);
}

/** The subset of an xrpl `tx` response the smoke test reads. */
export interface LedgerTx {
  validated: boolean;
  resultCode: string;
  destination: string | null;
  /** XRP: drops string. Issued: { value, currency (hex or ISO), issuer }. */
  delivered: string | { value: string; currency: string; issuer: string } | null;
  ledgerIndex: number | null;
  /** tx_json.InvoiceID = SHA-256(invoiceId); the receipt does not expose the raw invoiceId (SEC-009). */
  invoiceIdHash: string | null;
}

interface TxClient {
  request(req: Record<string, unknown>): Promise<unknown>;
}

/** Reads a validated Payment by hash. Works against a mocked `request` in tests. */
export async function fetchLedgerTx(client: TxClient, hash: string): Promise<LedgerTx> {
  const resp = (await client.request({ command: 'tx', transaction: hash })) as {
    result: {
      validated?: boolean;
      ledger_index?: number;
      meta?: string | { TransactionResult?: string; delivered_amount?: LedgerTx['delivered'] };
      tx_json?: {
        Destination?: string;
        InvoiceID?: string;
        Amount?: LedgerTx['delivered'];
        DeliverMax?: LedgerTx['delivered'];
      };
    };
  };
  const r = resp.result;
  const meta = typeof r.meta === 'object' && r.meta ? r.meta : undefined;
  return {
    validated: r.validated === true,
    resultCode: meta?.TransactionResult ?? 'unknown',
    destination: r.tx_json?.Destination ?? null,
    delivered: meta?.delivered_amount ?? r.tx_json?.DeliverMax ?? r.tx_json?.Amount ?? null,
    ledgerIndex: r.ledger_index ?? null,
    invoiceIdHash: r.tx_json?.InvoiceID ?? null,
  };
}

export interface ExpectedAsset {
  code: SettlementAssetCode;
  currencyHex: string | null;
  issuer: string | null;
}

/** AT-011: the on-ledger transaction must say what the receipt says. Empty array = match. */
export function compareReceiptToLedger(
  receipt: PaymentReceipt,
  tx: LedgerTx,
  asset: ExpectedAsset,
): string[] {
  const errs: string[] = [];
  if (receipt.status !== 'SETTLED')
    errs.push(`receipt payment status is ${receipt.status}, expected SETTLED`);
  if (!tx.validated) errs.push('ledger: transaction is not in a validated ledger');
  if (tx.resultCode !== 'tesSUCCESS')
    errs.push(`ledger: result ${tx.resultCode}, expected tesSUCCESS`);
  if (!receipt.destination || tx.destination !== receipt.destination)
    errs.push(`destination: receipt ${receipt.destination} vs ledger ${tx.destination}`);
  if (receipt.assetCode !== asset.code)
    errs.push(`asset: receipt ${receipt.assetCode} vs configured ${asset.code}`);
  if (
    receipt.ledgerIndex !== null &&
    tx.ledgerIndex !== null &&
    receipt.ledgerIndex !== tx.ledgerIndex
  )
    errs.push(`ledgerIndex: receipt ${receipt.ledgerIndex} vs ledger ${tx.ledgerIndex}`);

  const want = receipt.amount ? normalizeDecimal(receipt.amount) : null;
  if (tx.delivered === null || want === null) {
    errs.push('amount: missing on receipt or ledger');
  } else if (typeof tx.delivered === 'string') {
    if (asset.code !== 'XRP') errs.push('asset: ledger delivered XRP but receipt says RLUSD');
    else if (dropsToXrp(tx.delivered) !== want)
      errs.push(`amount: receipt ${want} XRP vs ledger ${dropsToXrp(tx.delivered)} XRP`);
  } else {
    if (asset.code !== 'RLUSD')
      errs.push('asset: ledger delivered an issued currency but receipt says XRP');
    if (normalizeDecimal(tx.delivered.value) !== want)
      errs.push(`amount: receipt ${want} vs ledger ${tx.delivered.value}`);
    if (
      asset.currencyHex &&
      tx.delivered.currency.toUpperCase() !== asset.currencyHex.toUpperCase()
    )
      errs.push(`currency: ledger ${tx.delivered.currency} vs configured ${asset.currencyHex}`);
    if (asset.issuer && tx.delivered.issuer !== asset.issuer)
      errs.push(`issuer: ledger ${tx.delivered.issuer} vs configured ${asset.issuer}`);
  }
  return errs;
}

export interface FundingState {
  address: string;
  xrp: string;
  /** null when no trust line to the issuer exists. */
  rlusd: string | null;
  issuer: string | null;
}

/** Compares decimal strings without number arithmetic (pad to common scale, compare lexicographically). */
export function decimalLt(a: string, b: string): boolean {
  const [ai = '0', af = ''] = a.split('.');
  const [bi = '0', bf = ''] = b.split('.');
  const w = Math.max(ai.length, bi.length);
  const s = Math.max(af.length, bf.length);
  const A = ai.padStart(w, '0') + af.padEnd(s, '0');
  const B = bi.padStart(w, '0') + bf.padEnd(s, '0');
  return A < B;
}

/** Base reserve 1 XRP + one trust line 0.2 + fees: require 2 XRP so a Payment can always be submitted. */
export const MIN_XRP = '2';

/** Exact operator instructions when the wallet cannot pay `maxCost` in `asset`. Empty = funded. */
export function fundingProblems(
  s: FundingState,
  asset: SettlementAssetCode,
  maxCost: string,
): string[] {
  const out: string[] = [];
  if (decimalLt(s.xrp, MIN_XRP))
    out.push(
      `XRP balance ${s.xrp} < ${MIN_XRP}. Fund ${s.address} at https://faucet.altnet.rippletest.net/ (or xrpl.js client.fundWallet()).`,
    );
  if (asset === 'XRP') {
    if (decimalLt(s.xrp, maxCost))
      out.push(
        `XRP balance ${s.xrp} < maxCost ${maxCost}. Top up at https://faucet.altnet.rippletest.net/.`,
      );
    return out;
  }
  if (s.rlusd === null) {
    out.push(
      `No RLUSD trust line from ${s.address} to issuer ${s.issuer}. Submit a TrustSet (see README "Fund the Testnet wallets", step 3), then rerun.`,
    );
  } else if (decimalLt(s.rlusd, maxCost)) {
    out.push(
      `RLUSD balance ${s.rlusd} < maxCost ${maxCost}. Get Testnet RLUSD for ${s.address} at https://tryrlusd.com/ (issuer must equal RLUSD_ISSUER=${s.issuer}).`,
    );
  }
  return out;
}

export interface EvidenceInput {
  dateIso: string;
  routeId: string;
  /** On-ledger InvoiceID (SHA-256 of the invoiceId). */
  invoiceIdHash: string | null;
  hash: string;
  ledgerIndex: number | null;
  amount: string;
  asset: SettlementAssetCode;
  explorerUrl: string;
}

/** Two rows matching the docs/EVIDENCE.md "Transactions" table (happy path + duplicate execute). */
export function evidenceRows(e: EvidenceInput): string {
  const date = e.dateIso.slice(0, 19).replace('T', ' ') + ' UTC';
  const li = e.ledgerIndex ?? 'n/a';
  const inv = e.invoiceIdHash ? `InvoiceID \`${e.invoiceIdHash}\`` : 'n/a';
  return [
    `| 1 | ${date} | Happy path (AT-001, AT-011) | \`${e.routeId}\` | ${inv} | \`${e.hash}\` | ${li} | ${e.amount} | ${e.asset} | \`tesSUCCESS\` | ${e.explorerUrl} |`,
    `| 2 | ${date} | Duplicate execute (AT-005): same hash, no new tx | same as 1 | same as 1 | same as 1 | same as 1 | none | ${e.asset} | no new payment | same as 1 |`,
  ].join('\n');
}
