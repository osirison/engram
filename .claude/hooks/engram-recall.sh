#!/usr/bin/env bash
# ENGRAM SessionStart hook (WP5 T6). Prints a recalled-memory block to stdout,
# which Claude Code injects into the session context. MUST never block a session:
# it always exits 0, even when `engram` is not installed or the server is down.
#
# Enable by adding this to .claude/settings.json (see docs/agent-memory-clients.md):
#   "SessionStart": [{ "matcher": "startup",
#     "hooks": [{ "type": "command",
#       "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/engram-recall.sh", "timeout": 15 }] }]
set -uo pipefail

input="$(cat 2>/dev/null || true)"
cwd="$(printf '%s' "$input" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
[ -n "$cwd" ] || cwd="${CLAUDE_PROJECT_DIR:-$PWD}"

root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$cwd")"
slug="$(basename "$root" | tr '[:upper:]' '[:lower:]')"

run_engram() {
  if command -v engram >/dev/null 2>&1; then
    engram "$@"
  elif [ -f "${CLAUDE_PROJECT_DIR:-.}/packages/agent-bridge/dist/cli.js" ]; then
    node "${CLAUDE_PROJECT_DIR:-.}/packages/agent-bridge/dist/cli.js" "$@"
  fi
}

# recall-context prints the block to stdout and logs to stderr; never fails the hook.
run_engram recall-context --scope "project:${slug}" 2>/dev/null || true
exit 0
