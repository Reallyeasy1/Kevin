/**
 * Pure helpers for scripts/fund-testnet.ts (SEC-002, INV-007). No network, no SDK imports, so
 * tests/unit/fund-lib.test.ts runs without xrpl.js. Nothing here ever sees a seed except
 * `assertNoSeed`, which exists to prove printed text does not contain one.
 */

/** Known Testnet RLUSD issuer (tryrlusd.com); overridden by RLUSD_ISSUER in .env or --issuer. */
export const DEFAULT_RLUSD_ISSUER = 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV';
export const RLUSD_CURRENCY_HEX = '524C555344000000000000000000000000000000';
export const DEFAULT_OUT = './testnet-wallets.local.json';

export interface FundArgs {
  out: string;
  issuer: string;
  wss: string;
}

/** `pnpm fund:testnet [-- --out file] [--issuer rXXX] [--wss wss://...]`; env values are the defaults. */
export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv): FundArgs {
  const out: FundArgs = {
    out: DEFAULT_OUT,
    issuer: env['RLUSD_ISSUER'] || DEFAULT_RLUSD_ISSUER,
    wss: env['XRPL_WSS_URL'] || 'wss://s.altnet.rippletest.net:51233',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--') continue;
    else if (a === '--out') out.out = next();
    else if (a === '--issuer') out.issuer = next();
    else if (a === '--wss') out.wss = next();
    else throw new Error(`unknown flag ${a}`);
  }
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(out.issuer))
    throw new Error(`issuer ${out.issuer} is not a classic XRPL address`);
  if (!/^wss?:\/\//.test(out.wss))
    throw new Error(`XRPL_WSS_URL ${out.wss} is not a websocket URL`);
  if (/mainnet|s1\.ripple\.com|s2\.ripple\.com|xrplcluster/i.test(out.wss))
    throw new Error(`refusing Mainnet endpoint ${out.wss} (SEC-010)`); // fundWallet only works on test networks anyway
  return out;
}

/** TrustSet for RLUSD from `account` to `issuer`; xrpl.js autofills the rest. */
export function trustSetTx(account: string, issuer: string, limit = '1000') {
  return {
    TransactionType: 'TrustSet' as const,
    Account: account,
    LimitAmount: { currency: RLUSD_CURRENCY_HEX, issuer, value: limit },
  };
}

/** The .env lines to paste. The seed line is a pointer to the file, never the value. */
export function envLines(agent: string, seller: string, issuer: string, outFile: string): string {
  return [
    `RLUSD_ISSUER=${issuer}`,
    `RLUSD_CURRENCY_HEX=${RLUSD_CURRENCY_HEX}`,
    `SELLER_PAYTO_ADDRESS=${seller}`,
    `# AGENT_WALLET_SEED=<agent seed from ${outFile}; the file is gitignored, never paste the seed anywhere else>`,
    `# agent address (for reference, not read by the app): ${agent}`,
  ].join('\n');
}

export function faucetSteps(agent: string): string {
  return [
    'Get Testnet RLUSD for the agent wallet at https://tryrlusd.com/ :',
    '  1. Sign in with GitHub.',
    '  2. Install GemWallet (https://gemwallet.app/), create/import a wallet and switch it to Testnet.',
    '  3. Claim 10 RLUSD; the faucet sets the trust line on the GemWallet account and sends the RLUSD there.',
    `  4. In GemWallet, send the RLUSD to the agent address ${agent} (its trust line is already set).`,
    '  5. Verify with GET /v1/wallet once the API is running, or on https://testnet.xrpl.org/.',
  ].join('\n');
}

/** Throws if any seed appears in `text`. Guards everything this script prints (SEC-002). */
export function assertNoSeed(text: string, seeds: readonly string[]): void {
  for (const s of seeds)
    if (s && text.includes(s)) throw new Error('refusing to print a wallet seed');
}
