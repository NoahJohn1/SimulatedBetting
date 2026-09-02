#!/usr/bin/env bash
# PostToolUse hook — layer 2 of the three-layer money defence in docs/repo-health.md 3.3.
#
# Prints one line when an edit lands on a money path. Deliberately a flag and not a review:
# a hook that spawns an agent review on every save is slow enough that someone disables it,
# and a disabled hook enforces nothing.
#
# The harness matches hooks on TOOL NAMES, not paths, so this fires on every Edit and Write
# and does its own path filtering. Never blocks, never fails a tool call: always exits 0.
set -u

payload=$(cat)

# node rather than jq: jq is not installed everywhere this repo is developed, and Node 22+
# is already a hard requirement (package.json engines).
path=$(printf '%s' "$payload" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d));
  process.stdin.on("end", () => {
    try {
      const i = JSON.parse(s).tool_input ?? {};
      process.stdout.write(i.file_path ?? i.notebook_path ?? "");
    } catch {
      process.stdout.write("");
    }
  });
' 2>/dev/null) || exit 0

[ -n "$path" ] || exit 0

# Paths where the four money invariants apply. Kept in sync with the money-invariants skill.
case "$path" in
  *src/server/money/*|\
  *src/server/bets/*|\
  *src/server/p2p/*|\
  *src/server/events/resolve.ts|\
  *src/db/schema/money.ts)
    echo "money path touched (${path##*/}) — run /money-invariants before committing"
    ;;
esac

exit 0
