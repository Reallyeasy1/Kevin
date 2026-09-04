#!/usr/bin/env node
// PreToolUse guard (PRD SEC-002): block Edit/Write to real env files and lockfiles.
// Exit 2 + stderr = block the tool call and tell Claude why.
// ponytail: path regex only; extend BLOCK if a new secret file type appears.
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let p = "";
  try { p = JSON.parse(raw).tool_input?.file_path ?? ""; } catch { process.exit(0); }
  const f = p.split(/[\\/]/).pop() ?? "";
  const BLOCK = [
    [/^\.env(\..+)?$/, "env files hold the wallet seed and API keys (SEC-002). Edit .env.example instead and tell the user to set the real value."],
    [/^pnpm-lock\.yaml$/, "lockfile is managed by pnpm; run pnpm install/add instead of editing it."],
  ];
  for (const [re, why] of BLOCK) {
    if (re.test(f) && !/\.example$/.test(f)) {
      process.stderr.write(`Blocked edit to ${f}: ${why}\n`);
      process.exit(2);
    }
  }
  process.exit(0);
});
