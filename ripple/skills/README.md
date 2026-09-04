# Skills

Agent skills for this hackathon. A skill is a folder with a `SKILL.md` (YAML
frontmatter plus instructions) that Claude Code, Cursor, and Codex all load in
the same format. The only difference between agents is which directory they scan.

## Available skills

- `xrpl-agentic-resources/` a context pack for building AI and agent ideas on the
  XRP Ledger: agent wallets, x402 pay-per-call, agent credit, RLUSD, and the XLS
  specs. It ships small curated snapshots (xrpl.org llms.txt, live amendment and
  fee status, docs indexes) and a `scripts/refresh.sh` that clones the vendored
  repos on demand and re-crawls the live docs.

## Install (Claude Code, Cursor, Codex)

From the repo root:

```bash
bash skills/install.sh
```

That symlinks every skill here into `.claude/skills/`, `.cursor/skills/`, and
`.codex/skills/` (project scoped, inside this repo). Cursor also reads
`.claude/skills` and `.codex/skills`, so it is covered too.

Then invoke it in your agent by typing `/xrpl-agentic-resources`, or just start
XRPL agent work and the agent will load it by description. On first use, run its
refresh once to pull the vendored repos and fresh docs indexes:

```bash
bash skills/xrpl-agentic-resources/scripts/refresh.sh
```

## Manual install (per agent)

If you prefer not to use `install.sh`, point the agent's skills directory at the
skill folder. Each of these reads a `SKILL.md` folder:

- Claude Code: copy or symlink `skills/xrpl-agentic-resources` into `.claude/skills/`
- Cursor: `.cursor/skills/` or `.agents/skills/` (Cursor also reads `.claude/skills/` and `.codex/skills/`)
- Codex: `.codex/skills/`

Example symlink for one agent:

```bash
mkdir -p .claude/skills
ln -s ../../skills/xrpl-agentic-resources .claude/skills/xrpl-agentic-resources
```

## Notes

- The vendored repos (`ows`, `rlusd-skills`, `x402-secure`, `xrpl-dev-portal`,
  `XRPL-Standards`) are cloned on demand by `refresh.sh` and are gitignored, so
  the repo stays small. The committed `resources/` snapshots work offline.
- `refresh.sh` needs `git`, `curl`, and network access.
