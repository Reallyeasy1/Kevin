/**
 * Create and fund two XRPL Testnet wallets (agent/buyer + seller), set their RLUSD trust lines, and
 * print the .env lines to paste. Seeds are written ONLY to a gitignored local file (SEC-002, INV-007).
 *
 *   pnpm fund:testnet [-- --out ./testnet-wallets.local.json] [--issuer rXXX]
 *
 * Testnet only: fundWallet uses the Testnet faucet and Mainnet endpoints are refused. Manual, never on CI.
 */
import { writeFileSync } from 'node:fs';
import { Client, Wallet } from 'xrpl';
import { assertNoSeed, envLines, faucetSteps, parseArgs, trustSetTx } from './fund-lib.js';

const args = parseArgs(process.argv.slice(2), process.env);
const say = (msg: string) => {
  assertNoSeed(msg, seeds);
  console.log(msg);
};
const seeds: string[] = [];

console.log(`[fund] connecting to ${args.wss}`);
const client = new Client(args.wss);
await client.connect();
try {
  const fund = async (name: string) => {
    console.log(`[fund] creating + funding ${name} wallet at the Testnet faucet`);
    const { wallet } = await client.fundWallet();
    seeds.push(wallet.seed!);
    say(`[fund] ${name}: ${wallet.address}`);
    const res = await client.submitAndWait(trustSetTx(wallet.address, args.issuer), {
      wallet,
      autofill: true,
    });
    const code =
      typeof res.result.meta === 'object'
        ? res.result.meta.TransactionResult
        : String(res.result.meta);
    if (code !== 'tesSUCCESS') throw new Error(`${name} TrustSet failed: ${code}`);
    say(`[fund] ${name}: RLUSD trust line to ${args.issuer} set (${res.result.hash})`);
    return wallet;
  };
  const agent = await fund('agent');
  const seller = await fund('seller');

  writeFileSync(
    args.out,
    JSON.stringify(
      {
        network: 'xrpl:1',
        agent: { address: agent.address, seed: agent.seed },
        seller: { address: seller.address, seed: seller.seed },
        note: 'Testnet only. Gitignored. Paste agent.seed into .env as AGENT_WALLET_SEED; delete when done.',
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  say(`[fund] seeds written to ${args.out} (gitignored; not printed)`);
  say(`\nPaste into .env:\n${envLines(agent.address, seller.address, args.issuer, args.out)}\n`);
  say(faucetSteps(agent.address));
} finally {
  await client.disconnect();
}
