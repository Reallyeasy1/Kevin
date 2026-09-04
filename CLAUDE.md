# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

SubBuddy is our Singhacks 2026 entry for the Ripple challenge: "Build an AI-Native Business on XRPL". The product is a wallet-native AI inference router: it classifies a prompt, ranks purchasable inference offers, pays the chosen seller through x402 settled on XRPL Testnet, and returns the model response plus a verifiable receipt.

`PRD_SPECS.md` is the source of truth. Every P0 behaviour has a requirement ID (FR, INV, SEC, AT, NFR); reference them in commits. If code and the PRD disagree, the PRD wins until it is deliberately amended. Product code is not scaffolded yet.

`ripple/` is a vendored, read-only copy of the organiser's challenge repo: brief (`ripple/README.md`), tool list (`ripple/resources.md`), challenge PDF, the feedback hook, and the source of the XRPL skill.

## Stack and layout (PRD §10)

TypeScript strict, Node 20+, pnpm workspaces. Next.js + Tailwind in `apps/web`, Fastify in `apps/api`, the x402-protected seller in `apps/seller`. Shared packages under `packages/` for contracts (Zod), routing, payments (xrpl.js + x402 adapter), database (Prisma + PostgreSQL), and config. Vitest for unit and integration tests, Playwright for e2e, Pino with redaction for logs, decimal.js for money.

The buyer and seller must talk over HTTP even in local dev. Calling the seller in-process bypasses the x402 boundary and is a PRD violation. External SDK types stay inside `packages/payments`; the rest of the code sees only the `PaymentClient` and `WalletSigner` interfaces.

Live Testnet tests are manual and must never run on ordinary CI commits (PRD §18.3).

## Hard constraints from the challenge

- All on-chain logic runs on the XRP Ledger. The XRPL EVM Sidechain and any other chain are judged invalid.
- The demo must produce at least one real XRPL transaction and cite its hash or explorer link.
- Mainnet configuration must be rejected while `APP_ENV=hackathon` (SEC-010). Default asset is Testnet RLUSD with Testnet XRP as a config-only fallback.
- Judging: 20% each for reachability, creativity, feasibility, technical depth; 10% UX; 10% builder feedback. Builder feedback depends on the Stop hook below staying on for the whole build plus a Google form at the end (link in `ripple/README.md`).

## Claude Code setup in this repo

- `.claude/settings.json` registers two hooks and a permission allowlist. It loads when Claude Code is launched from this folder. The parent `singhacks/.claude/settings.json` carries a copy of the Stop hook for sessions launched one level up.
- `.claude/hooks/guard-secrets.mjs` (PreToolUse) blocks Edit and Write to `.env*` files and `pnpm-lock.yaml`. Edit `.env.example` and ask the user to set real values. Reads of `.env*` are denied by permissions as well.
- `.claude/rules/xrpl-payments.md` loads automatically when touching `packages/payments`, `apps/seller`, or `apps/api`. It is the INV and SEC checklist.
- `.claude/agents/xrpl-payment-reviewer.md` reviews payment diffs against that checklist and the challenge constraints. Run it before committing payment work.
- `.mcp.json` adds context7 for live xrpl.js, Fastify, Prisma, and Next.js docs. Use it before quoting SDK APIs.
- Format and lint hooks are not set up yet. Add a PostToolUse prettier/eslint hook once `package.json` exists.

## XRPL feedback Stop hook

Required for the hackathon. After a sampled fraction of turns it asks Claude to reflect on whether the turn surfaced genuine XRPL developer feedback. If so, submit with:

```bash
node ripple/hook/submit.mjs --text "<one specific paragraph, 50 to 2000 chars>"
```

Submit only concrete XRPL or XRPL-tooling friction actually observed. Do not resubmit an issue already sent in the session.

- Identity config: `~/.xrpl-feedback-hook.json` (team LookingForEmployment, hacker Lo Yong Zhe). Set `"sample": 1` there to fire every turn; default is 0.2.
- Run `/hooks` to confirm the Stop hook is registered.
- Test without submitting:

```bash
printf '%s' '{"hook_event_name":"Stop","stop_hook_active":false}' | node ripple/hook/agents/claude-code/stop-hook.mjs; echo "exit $?"   # exit 2 = injected
```

## XRPL agentic-resources skill

Installed as a copy at `.claude/skills/xrpl-agentic-resources/` (invoke with `/xrpl-agentic-resources`). It carries the xrpl.org llms.txt index, live amendment and fee snapshots, docs indexes for t54 and x402, and on-demand vendored repos (x402-secure, rlusd-skills, Open Wallet Standard, XRPL-Standards, the official xrpl-dev-portal agent-wallet and payments skills). Check `resources/xrpl-amendments.json` before asserting an amendment is live.

Refresh vendored repos and snapshots (needs git, curl, network):

```bash
bash .claude/skills/xrpl-agentic-resources/scripts/refresh.sh
```

Do not use `ripple/skills/install.sh`. It symlinks with `ln -s`, which under Windows Git Bash writes plain stub files instead of links; the entries under `ripple/.claude/skills`, `ripple/.codex/skills`, and `ripple/.cursor/skills` are those broken stubs from upstream. The vendored clones are gitignored by the skill's own `.gitignore`.

## Windows notes

- `mv` of a directory with a nested `.git` fails with permission denied under Git Bash. Use `cp -r` then `rm -rf`.
- `git clean -fdx` skips nested repositories; remove vendored clones with `rm -rf` if a full clean is needed.
- Heredocs in Bash collapse `\\` inside JS regex literals. Use the Edit tool for lines containing backslashes.
