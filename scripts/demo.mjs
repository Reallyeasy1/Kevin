#!/usr/bin/env node
/**
 * One-command local demo (NFR-010): Postgres up, migrate, then seller + api + web as children with
 * prefixed logs, stopped together on Ctrl+C. Stdlib only.
 *
 *   pnpm demo            # = node scripts/with-env.mjs node scripts/demo.mjs
 *
 * Honours POSTGRES_PORT, API_PORT, SELLER_PORT and WEB_PORT (default 3000, or 3100 when 3000 is busy).
 * Prints the three URLs and the agent wallet address (fetched from GET /v1/wallet; the seed is never read).
 */
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, line) => console.log(`[${tag}] ${line}`);
const fail = (msg) => {
  console.error(`[demo] ${msg}`);
  stopAll();
  process.exit(1);
};

// --- children ---------------------------------------------------------------
const children = [];
let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode !== null) continue;
    // Windows: the shell wrapper's children (tsx, next) survive a plain kill; take the whole tree.
    if (win) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGINT');
  }
}
process.on('SIGINT', () => {
  console.log('\n[demo] stopping');
  stopAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopAll();
  process.exit(0);
});

/** Spawn `cmd args` in the repo root, prefixing every stdout/stderr line with [tag]. */
function start(tag, cmd, args) {
  const child = spawn(cmd, args, {
    cwd: root,
    shell: win,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) log(tag, l);
    });
    stream.on('end', () => buf.trim() && log(tag, buf));
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    if (!stopping) fail(`${tag} exited with code ${code}; stopping the rest`);
  });
  children.push(child);
  return child;
}

function run(tag, cmd, args) {
  log('demo', `$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: root, shell: win, env: process.env, stdio: 'inherit' });
  if (r.status !== 0) fail(`${tag} failed (exit ${r.status ?? 'signal'})`);
}

// --- helpers ----------------------------------------------------------------
function portFree(port) {
  // Connect, do not listen: on Windows a listen on 127.0.0.1 succeeds even when Docker holds 0.0.0.0:port.
  return new Promise((res) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.setTimeout(1_000);
    sock.once('connect', () => sock.destroy(res(false)));
    sock.once('timeout', () => sock.destroy(res(true)));
    sock.once('error', () => res(true));
  });
}

async function waitFor(tag, url, { timeoutMs = 120_000, accept = (r) => r.ok, headers } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(3_000) });
      if (accept(r)) return r;
    } catch {
      /* not up yet */
    }
    await sleep(1_000);
  }
  fail(`${tag} did not answer at ${url} within ${timeoutMs / 1000}s`);
}

// --- 1. Docker + Postgres ---------------------------------------------------
if (spawnSync('docker', ['info'], { shell: win, stdio: 'ignore' }).status !== 0)
  fail('Docker is not running or not installed; start Docker Desktop and retry');
const pgPort = Number(process.env.POSTGRES_PORT ?? 5432);
if (!(await portFree(pgPort))) {
  // ponytail: something already listens there (e.g. a hand-started container); compose up would fail on the bind.
  log('demo', `port ${pgPort} already in use; assuming Postgres is up and skipping docker compose`);
} else {
  run('docker compose', 'docker', ['compose', 'up', '-d', 'postgres']);
  log('demo', `waiting for postgres (host port ${pgPort})`);
  for (let i = 0; ; i++) {
    const r = spawnSync(
      'docker',
      ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'subbuddy'],
      { cwd: root, shell: win, stdio: 'ignore' },
    );
    if (r.status === 0) break;
    if (i >= 30) fail('postgres did not become ready in 30s');
    await sleep(1_000);
  }
}

// --- 2. Migrate -------------------------------------------------------------
run('migrate', 'pnpm', ['--filter', '@subbuddy/database', 'db:migrate']);

// --- 3. Services ------------------------------------------------------------
const apiPort = process.env.API_PORT ?? '4010';
const sellerPort =
  process.env.SELLER_PORT ??
  (process.env.SELLER_BASE_URL && new URL(process.env.SELLER_BASE_URL).port) ??
  '4020';
const webPort = process.env.WEB_PORT ?? ((await portFree(3000)) ? '3000' : '3100');
if (!process.env.WEB_PORT && webPort === '3100') log('demo', 'port 3000 is busy; web on 3100');

start('seller', 'pnpm', ['--filter', '@subbuddy/seller', 'dev']);
start('api', 'pnpm', ['--filter', '@subbuddy/api', 'dev']);
start('web', 'pnpm', [
  '--filter',
  '@subbuddy/web',
  'exec',
  'next',
  'dev',
  '--webpack',
  '--port',
  webPort,
]);

const seller = `http://localhost:${sellerPort}`;
const api = `http://localhost:${apiPort}`;
const web = `http://localhost:${webPort}`;
await waitFor('seller', `${seller}/health`);
await waitFor('api', `${api}/health`);
await waitFor('web', web, { accept: (r) => r.status < 500 });

// Address only (INV-007): /v1/wallet returns address + balances, never the seed.
let address = '(set DEMO_API_KEY to show the wallet address)';
if (process.env.DEMO_API_KEY) {
  try {
    const r = await fetch(`${api}/v1/wallet`, {
      headers: { authorization: `Bearer ${process.env.DEMO_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) address = (await r.json()).address ?? address;
    else address = `(GET /v1/wallet -> ${r.status})`;
  } catch (e) {
    address = `(GET /v1/wallet failed: ${e.message})`;
  }
}

console.log(`
[demo] ready
[demo]   web     ${web}
[demo]   api     ${api}
[demo]   seller  ${seller}
[demo]   agent wallet ${address}
[demo] Ctrl+C stops all three.
`);
