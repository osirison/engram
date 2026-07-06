#!/usr/bin/env bash
# Verify the persistent ENGRAM MCP server (WP5 T2/T4). Checks that it:
#   1. answers /health with 200,
#   2. speaks the MCP Streamable-HTTP handshake (initialize -> mcp-session-id),
#   3. advertises the memory tools (tools/list includes `recall`),
#   4. refuses an unauthenticated protected tools/call with 401 when AUTH_REQUIRED=true.
#
# Usage:
#   [ENGRAM_MCP_URL=http://127.0.0.1:3000/mcp] [ENGRAM_API_KEY=eng_…] \
#   [AUTH_REQUIRED=true] ./scripts/verify-engram-server.sh
#
# There is no REST memory API — every call is MCP JSON-RPC over the /mcp route.
set -euo pipefail

MCP_URL="${ENGRAM_MCP_URL:-http://127.0.0.1:3000/mcp}"
HEALTH_URL="${ENGRAM_HEALTH_URL:-${MCP_URL%/mcp}/health}"
CT='Content-Type: application/json'
ACCEPT='Accept: application/json, text/event-stream'
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify-engram-server","version":"1.0.0"}}}'

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

session_id_from_headers() { tr -d '\r' | awk -F': ' 'tolower($1)=="mcp-session-id"{print $2; exit}'; }

# 1. Health ────────────────────────────────────────────────────────────────
code="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL")" || fail "health endpoint unreachable at $HEALTH_URL"
[ "$code" = "200" ] || fail "health returned HTTP $code (expected 200)"
pass "health 200 at $HEALTH_URL"

# 2. MCP initialize handshake ────────────────────────────────────────────────
auth_args=()
[ -n "${ENGRAM_API_KEY:-}" ] && auth_args=(-H "Authorization: Bearer ${ENGRAM_API_KEY}")
headers="$(curl -sS -D - -o /dev/null -H "$CT" -H "$ACCEPT" "${auth_args[@]}" -X POST "$MCP_URL" -d "$INIT")" \
  || fail "initialize request failed"
sid="$(printf '%s' "$headers" | session_id_from_headers)"
[ -n "$sid" ] || fail "no mcp-session-id header returned by initialize"
pass "MCP initialize handshake -> session ${sid}"

# 3. tools/list advertises the memory tools ─────────────────────────────────
curl -sS -o /dev/null -H "$CT" -H "$ACCEPT" -H "mcp-session-id: $sid" "${auth_args[@]}" \
  -X POST "$MCP_URL" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' || true
tools="$(curl -sS -H "$CT" -H "$ACCEPT" -H "mcp-session-id: $sid" "${auth_args[@]}" \
  -X POST "$MCP_URL" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')"
echo "$tools" | grep -q '"recall"' || fail "tools/list did not advertise recall (got: $(echo "$tools" | head -c 200))"
pass "tools/list advertises the memory tools (recall present)"

# 4. Unauthenticated protected tools/call must be 401 when auth is on ────────
UNAUTH_HEADERS="$(curl -sS -D - -o /dev/null -H "$CT" -H "$ACCEPT" -X POST "$MCP_URL" -d "$INIT")"
UNAUTH_SID="$(printf '%s' "$UNAUTH_HEADERS" | session_id_from_headers)"
CALL='{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"recall","arguments":{"userId":"qp","query":"connectivity probe"}}}'
sid_args=()
[ -n "$UNAUTH_SID" ] && sid_args=(-H "mcp-session-id: $UNAUTH_SID")
code="$(curl -s -o /dev/null -w '%{http_code}' -H "$CT" -H "$ACCEPT" "${sid_args[@]}" -X POST "$MCP_URL" -d "$CALL")"
if [ "${AUTH_REQUIRED:-}" = "true" ]; then
  [ "$code" = "401" ] || fail "expected 401 for unauthenticated recall, got HTTP $code (is AUTH_REQUIRED=true on the server?)"
  pass "unauthenticated recall -> 401 (auth enforced)"
else
  echo "NOTE: AUTH_REQUIRED is not 'true' in this shell; skipping the 401 assertion (unauthenticated recall returned HTTP $code)."
  echo "      Run the server AND this script with AUTH_REQUIRED=true to enforce the auth gate (WP5 D6/R1)."
fi

echo "OK: ENGRAM MCP server verification passed."
