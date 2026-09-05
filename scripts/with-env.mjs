#!/usr/bin/env node
// Load the root .env (if present) into the environment, then run the given command.
// Usage: node scripts/with-env.mjs <command> [args...]
// Existing environment variables win over .env values. Stdlib only (Node 22).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile); // never overrides variables already set in the shell
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: node scripts/with-env.mjs <command> [args...]');
  process.exit(2);
}
// Windows needs a shell to resolve pnpm.cmd/tsx.cmd, which re-parses arguments: re-quote the ones with spaces or quotes.
const win = process.platform === 'win32';
const quoted = win ? args.map((a) => (/[s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
const result = spawnSync(cmd, quoted, {
  stdio: 'inherit',
  shell: win,
  cwd: root,
  env: process.env,
});
process.exit(result.status ?? 1);
