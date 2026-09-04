#!/usr/bin/env bash
# Install the repo's skills into the agents that read a SKILL.md folder:
# Claude Code (.claude/skills), Cursor (.cursor/skills), and Codex (.codex/skills).
#
# It symlinks each skill under skills/ into those directories, project scoped
# (inside this repo), so the skills are available to whichever agent you use.
# Idempotent: safe to run repeatedly. Run from the repo root:
#   bash skills/install.sh
set -u

# Resolve the repo root as the parent of this script's directory.
SKILLS_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SKILLS_DIR/.." && pwd)"

TARGETS=(".claude/skills" ".cursor/skills" ".codex/skills")

# Every subdirectory of skills/ that contains a SKILL.md is a skill.
installed=0
for skill_path in "$SKILLS_DIR"/*/; do
  [ -f "${skill_path}SKILL.md" ] || continue
  name="$(basename "$skill_path")"
  for t in "${TARGETS[@]}"; do
    dir="$REPO_ROOT/$t"
    mkdir -p "$dir"
    link="$dir/$name"
    # relative link from the target dir back to the canonical skill
    rel="$(cd "$dir" && python3 -c "import os,sys;print(os.path.relpath(sys.argv[1]))" "$skill_path" 2>/dev/null)"
    [ -n "$rel" ] || rel="$skill_path"
    rm -rf "$link"
    ln -s "$rel" "$link"
    echo "linked $t/$name -> $rel"
  done
  installed=$((installed + 1))
done

echo ""
echo "installed $installed skill(s) into: ${TARGETS[*]}"
echo "Cursor also reads .claude/skills and .codex/skills, so it is covered as well."
echo "Next: invoke /xrpl-agentic-resources in your agent, or run its refresh once:"
echo "  bash skills/xrpl-agentic-resources/scripts/refresh.sh"
