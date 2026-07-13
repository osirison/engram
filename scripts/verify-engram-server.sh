#!/usr/bin/env bash
# Verify the persistent ENGRAM MCP server (WP5 T2/T4). Checks that it:
#   1. answers /health with 200,
#   2. speaks the MCP Streamable-HTTP handshake (initialize -> mcp-session-id),
#   3. advertises the memory tools (tools/list includes `recall`),
#   4. refuses an unauthenticated protected tools/call with 401 when AUTH_REQUIRED=true,
#   5. enforces scoped keys (read-ok / write-403 / spoofed-userId-ignored, #238)
#      when ENGRAM_READONLY_KEY / ENGRAM_WRITE_KEY are provided (skipped otherwise).
#
# Usage:
#   [ENGRAM_MCP_URL=http://127.0.0.1:3000/mcp] [ENGRAM_API_KEY=eng_…] \
#   [AUTH_REQUIRED=true] \
#   [ENGRAM_READONLY_KEY=eng_…] [ENGRAM_WRITE_KEY=eng_…] \
#   ./scripts/verify-engram-server.sh
#
#   ENGRAM_READONLY_KEY  a key with scopes ["memories:read"] only
#                        (drives the read-ok and write-403 checks)
#   ENGRAM_WRITE_KEY     a key holding memories:read + memories:write
#                        (drives the spoofed-userId-ignored check)
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

# 5. Scoped-key checks (WP5 T4, #238) ────────────────────────────────────────
# Automates the "Manual verification checklist" of the Provision-agent-keys doc
# (apps/docs/src/content/docs/how-to/provision-agent-keys.mdx): a read-only key
# can recall (read-ok), the same key is scope-denied on remember (write-403),
# and a spoofed body userId is overridden by the key's tenant. A presented key
# is validated and scoped even on an auth-off server, so these checks work
# there too — they only need real keys.

excerpt() { printf '%s' "$1" | tr -d '\n' | head -c 220; }

# Open an MCP session authenticated with a key; prints the session id.
scoped_session() { # $1=key $2=label
  local headers http_code sid
  headers="$(curl -sS -D - -o /dev/null -H "$CT" -H "$ACCEPT" -H "Authorization: Bearer $1" -X POST "$MCP_URL" -d "$INIT")" \
    || fail "initialize with the $2 key failed (network error)"
  http_code="$(printf '%s' "$headers" | awk 'NR==1{print $2}')"
  [ "$http_code" = "200" ] || fail "initialize with the $2 key returned HTTP $http_code — invalid/revoked key, or this server cannot validate API keys"
  sid="$(printf '%s' "$headers" | session_id_from_headers)"
  [ -n "$sid" ] || fail "no mcp-session-id returned by initialize with the $2 key"
  curl -sS -o /dev/null -H "$CT" -H "$ACCEPT" -H "mcp-session-id: $sid" -H "Authorization: Bearer $1" \
    -X POST "$MCP_URL" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' || true
  printf '%s' "$sid"
}

# tools/call under a key+session; prints the body with JSON escapes flattened
# (so nested-JSON substrings like `"userId": "qp"` become grep-able).
scoped_call() { # $1=key $2=sid $3=json-rpc body
  # shellcheck disable=SC1003 # tr deletes backslashes; not an escaped quote
  curl -sS -H "$CT" -H "$ACCEPT" -H "mcp-session-id: $2" -H "Authorization: Bearer $1" \
    -X POST "$MCP_URL" -d "$3" | tr -d '\\'
}

if [ -z "${ENGRAM_READONLY_KEY:-}" ] && [ -z "${ENGRAM_WRITE_KEY:-}" ]; then
  echo "NOTE: ENGRAM_READONLY_KEY / ENGRAM_WRITE_KEY are not set; skipping the scoped-key checks"
  echo "      (read-ok / write-403 / spoofed-userId-ignored). Mint a read-only key (scopes"
  echo "      [\"memories:read\"]) plus a read+write key — see the Provision-agent-keys doc —"
  echo "      and re-run with both variables set to automate that checklist."
else
  if [ -n "${ENGRAM_READONLY_KEY:-}" ]; then
    ro_sid="$(scoped_session "$ENGRAM_READONLY_KEY" read-only)"

    # 5a. read-ok: the read-only key must be able to recall.
    body="$(scoped_call "$ENGRAM_READONLY_KEY" "$ro_sid" \
      '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"recall","arguments":{"userId":"qp","query":"scoped-key verification probe"}}}')"
    printf '%s' "$body" | grep -q 'Forbidden: missing required scope' \
      && fail "read-only key was scope-denied on recall — does it hold memories:read? (got: $(excerpt "$body"))"
    printf '%s' "$body" | grep -Eq '"isError"[[:space:]]*:[[:space:]]*true' \
      && fail "recall with the read-only key errored (got: $(excerpt "$body"))"
    printf '%s' "$body" | grep -q '"content"' \
      || fail "recall with the read-only key returned no tool result (got: $(excerpt "$body"))"
    pass "read-only key can recall (read-ok)"

    # 5b. write-403: the same key must be scope-denied on remember.
    body="$(scoped_call "$ENGRAM_READONLY_KEY" "$ro_sid" \
      '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"remember","arguments":{"userId":"qp","content":"scoped-key verification probe: this write MUST be rejected"}}}')"
    if printf '%s' "$body" | grep -q 'Forbidden: missing required scope' \
      && printf '%s' "$body" | grep -q 'memories:write'; then
      pass "read-only key cannot remember (write denied: missing memories:write)"
    else
      fail "read-only key was NOT scope-denied on remember — scope enforcement is broken, or the key also holds memories:write (got: $(excerpt "$body"))"
    fi
  else
    echo "NOTE: ENGRAM_READONLY_KEY is not set; skipping the read-ok / write-403 checks."
  fi

  if [ -n "${ENGRAM_WRITE_KEY:-}" ]; then
    wr_sid="$(scoped_session "$ENGRAM_WRITE_KEY" write)"
    spoof_user="attacker"

    # 5c. spoofed-userId-ignored: create a self-expiring STM probe under a spoofed
    # body userId, then read it back (also spoofed). With identity injection both
    # calls act on the KEY's tenant, so the stored row must not belong to the
    # spoofed value — the token wins over the body.
    body="$(scoped_call "$ENGRAM_WRITE_KEY" "$wr_sid" \
      '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"create_memory","arguments":{"userId":"'"$spoof_user"'","content":"scoped-key verification probe (safe to ignore; self-expires in 60s)","type":"short-term","ttl":60,"tags":["verify-probe"]}}}')"
    # STM ids are UUIDs — keep the hyphens in the captured id.
    probe_id="$(printf '%s' "$body" | sed -n 's/.*Created short-term memory with ID: \([A-Za-z0-9-]*\).*/\1/p' | head -n 1)"
    [ -n "$probe_id" ] || fail "spoofed-userId probe write failed — does the write key hold memories:write? (got: $(excerpt "$body"))"

    body="$(scoped_call "$ENGRAM_WRITE_KEY" "$wr_sid" \
      '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"get_memory","arguments":{"userId":"'"$spoof_user"'","memoryId":"'"$probe_id"'"}}}')"
    acting_user="$(printf '%s' "$body" | sed -n 's/.*"userId": "\([^"]*\)".*/\1/p' | head -n 1)"
    [ -n "$acting_user" ] || fail "could not read the probe memory back (got: $(excerpt "$body"))"
    if [ "$acting_user" = "$spoof_user" ]; then
      fail "spoofed body userId was HONOURED — memory ${probe_id} was stored under \"$spoof_user\"; the server is not injecting the key's userId (auth off without key validation, or identity injection broken)"
    fi
    pass "spoofed body userId ignored — server acted as the key's tenant \"$acting_user\" (probe ${probe_id} self-expires in 60s)"
  else
    echo "NOTE: ENGRAM_WRITE_KEY is not set; skipping the spoofed-userId-ignored check."
  fi
fi

echo "OK: ENGRAM MCP server verification passed."
