#!/usr/bin/env bash
# ENGRAM SessionEnd hook (WP5 T6). Distills memory-worthy facts from the finished
# session transcript and stores them in ENGRAM (backstop for the in-session
# `remember` directive). MUST never block: always exits 0. Storage only happens
# when a distillation LLM key is configured (ENGRAM_DISTILL_API_KEY / OPENAI_API_KEY);
# otherwise it is a no-op. Server-down writes are spooled and replayed later.
#
# Enable by adding this to .claude/settings.json (see docs/agent-memory-clients.md):
#   "SessionEnd": [{ "hooks": [{ "type": "command",
#     "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/engram-capture.sh", "timeout": 30 }] }]
set -uo pipefail

input="$(cat 2>/dev/null || true)"
transcript="$(printf '%s' "$input" | sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
cwd="$(printf '%s' "$input" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
[ -n "$cwd" ] || cwd="${CLAUDE_PROJECT_DIR:-$PWD}"

# Nothing to capture without a transcript path — safe no-op.
[ -n "$transcript" ] || exit 0

root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$cwd")"
slug="$(basename "$root" | tr '[:upper:]' '[:lower:]')"

run_engram() {
  if command -v engram >/dev/null 2>&1; then
    engram "$@"
  elif [ -f "${CLAUDE_PROJECT_DIR:-.}/packages/agent-bridge/dist/cli.js" ]; then
    node "${CLAUDE_PROJECT_DIR:-.}/packages/agent-bridge/dist/cli.js" "$@"
  fi
}

ENGRAM_AGENT="${ENGRAM_AGENT:-claude-code}" \
  run_engram capture --transcript "$transcript" --scope "project:${slug}" >/dev/null 2>&1 || true
exit 0
