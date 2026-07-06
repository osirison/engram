#!/usr/bin/env bash
# Exit-0 contract test for the ENGRAM Claude Code hooks (WP5 T6). A hook that
# errors would break a Claude Code session, so both hooks must ALWAYS exit 0 —
# whether `engram` is missing entirely or present but the server is unreachable.
set -uo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
RECALL="$DIR/.claude/hooks/engram-recall.sh"
CAPTURE="$DIR/.claude/hooks/engram-capture.sh"
fails=0

check() { if [ "$1" -eq 0 ]; then echo "PASS: $2"; else echo "FAIL: $2 (exit $1)"; fails=$((fails + 1)); fi; }

# 1. recall hook with `engram` unavailable -> exit 0, no stdout injected
out="$(PATH=/usr/bin:/bin CLAUDE_PROJECT_DIR=/nonexistent ENGRAM_TIMEOUT_MS=500 \
  bash "$RECALL" <<<"{\"cwd\":\"$DIR\",\"source\":\"startup\"}" 2>/dev/null)"
check "$?" "recall exits 0 when engram is unavailable"
if [ -z "$out" ]; then echo "PASS: recall emits no stdout when unavailable"; else echo "FAIL: recall emitted stdout"; fails=$((fails + 1)); fi

# 2. recall hook with the real CLI but a dead server -> exit 0 (fast fail)
CLAUDE_PROJECT_DIR="$DIR" ENGRAM_URL="http://127.0.0.1:59999/mcp" ENGRAM_TIMEOUT_MS=800 \
  bash "$RECALL" <<<"{\"cwd\":\"$DIR\"}" >/dev/null 2>&1
check "$?" "recall exits 0 with the real CLI and no server"

# 3. capture hook with no transcript_path -> exit 0
CLAUDE_PROJECT_DIR="$DIR" bash "$CAPTURE" <<<"{\"cwd\":\"$DIR\"}" >/dev/null 2>&1
check "$?" "capture exits 0 when no transcript_path is provided"

# 4. capture hook with a transcript but no distillation key -> exit 0 (no-op)
tmp="$(mktemp)"; printf '%s\n' '{"type":"assistant","message":{"content":"hi"}}' >"$tmp"
CLAUDE_PROJECT_DIR="$DIR" ENGRAM_TIMEOUT_MS=800 env -u OPENAI_API_KEY -u ENGRAM_DISTILL_API_KEY \
  bash "$CAPTURE" <<<"{\"cwd\":\"$DIR\",\"transcript_path\":\"$tmp\"}" >/dev/null 2>&1
check "$?" "capture exits 0 with a transcript but no distill provider"
rm -f "$tmp"

if [ "$fails" -eq 0 ]; then echo "OK: all hook exit-0 checks passed"; exit 0; else echo "FAILED: $fails check(s)"; exit 1; fi
