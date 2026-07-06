---
title: Per-Agent API Keys for the Shared ENGRAM Server
description: How to mint, distribute, and rotate least-privilege per-agent API keys so one shared ENGRAM MCP server is safe for multiple AI coding agents
---

## Why authentication must be on

WP5 points five AI coding agents (Claude Code, Copilot, Cursor, Codex, Gemini)
plus the `engram` CLI bridge at **one** always-on ENGRAM server over
`MCP_TRANSPORT=streamable-http`. That shared surface changes the threat model.

When `AUTH_REQUIRED=false`, the server reads the tenant `userId` **from the
request body**, which is fully **spoofable**: any local process that can reach
the port can send any `userId` and thereby read, write, or delete any tenant's
memories (WP5 R1 / GAPS G1). There is no identity — only an unverified string.

The mitigation is non-negotiable for a multi-agent host:

- `AUTH_REQUIRED=true` — every protected `tools/call` must carry a valid key.
- **One least-privilege API key per agent** (below).
- **Loopback bind** (`127.0.0.1`) so the port is not exposed off-host.

With auth on, the server **injects the key's `userId`** over any client-supplied
`userId` for identity tools — the tenant is the token, not the body — and
enforces per-key **scopes** (`memories:read`, `memories:write`,
`memories:delete`; `admin` satisfies any). That enforcement is unit-tested in
`apps/mcp-server/src/**/dispatch-auth.spec.ts`. See the server runbook
`docs/agent-memory-server.md` for turning auth on and binding loopback, and the
[Agent Memory Contract](../agent-memory-contract.md) for the `userId`
convention and scope grammar.

## One least-privilege key per agent

Every agent gets its **own** key. All keys share the single tenant
`userId: "qp"` (per WP5 R1 and the standing convention) — the **key**, not the
`userId`, is what distinguishes agents for provenance and revocation. Give each
key only the scopes that agent actually uses.

| Agent                 | Key `name`    | `userId` | Scopes                            |
| --------------------- | ------------- | -------- | --------------------------------- |
| Claude Code           | `claude-code` | `qp`     | `memories:read`, `memories:write` |
| GitHub Copilot        | `copilot`     | `qp`     | `memories:read`, `memories:write` |
| Cursor                | `cursor`      | `qp`     | `memories:read`, `memories:write` |
| Codex                 | `codex`       | `qp`     | `memories:read`, `memories:write` |
| Gemini                | `gemini`      | `qp`     | `memories:read`, `memories:write` |
| CLI bridge (`engram`) | `cli-bridge`  | `qp`     | `memories:read`, `memories:write` |

**Delete is opt-in, default-deny.** The table above deliberately omits
`memories:delete`. Grant `memories:delete` **only** for an agent that is
actually wired to call `forget` / `delete_memory`; omit it for every other
agent. A read+write key cannot delete, so an agent that never deletes cannot be
tricked (or bugged) into destroying memories. Never grant the `admin` scope to
an agent key — `admin` satisfies every scope check and is meant for operators
only.

## Minting a key

Keys are minted with the **admin** MCP tool `create_api_key`. There is **no REST
endpoint** — `create_api_key` is invoked as an MCP `tools/call`, and the call
must present the admin credential (`adminToken`, see below). Two practical ways
to make the call:

- **MCP Inspector** — run `pnpm inspector` and point it at the server
  (`http://127.0.0.1:3000/mcp`), then invoke `create_api_key` from the tool UI.
- **An authenticated admin MCP client** — any client that speaks MCP
  Streamable-HTTP and can send the `tools/call` below.

The tool input (validated by the Zod schema in
`apps/mcp-server/src/api-keys/dto/create-api-key.dto.ts`) takes `userId`,
`adminToken` (≥16 chars, equals `MCP_ADMIN_TOKEN`), `name` (1–100 chars),
`scopes` (1–10 of `memories:read` | `memories:write` | `memories:delete` |
`admin`), and optional `expiresInDays` (1–3650). The JSON-RPC envelope:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "create_api_key",
    "arguments": {
      "userId": "qp",
      "adminToken": "<MCP_ADMIN_TOKEN>",
      "name": "claude-code",
      "scopes": ["memories:read", "memories:write"],
      "expiresInDays": 90
    }
  }
}
```

The response returns the **plaintext key exactly once** (format `eng_…`)
alongside `{ id, prefix, name, scopes, expiresAt, createdAt, warning }`. The
server stores only a hash — it can never show the plaintext again. **Copy the
`eng_…` value immediately** into the target agent's config (next section); if
you lose it, revoke and re-mint. Repeat the call once per agent, changing only
`name` (and `scopes`).

## Where each key goes

Each agent authenticates by sending its own plaintext key on every request as an
HTTP header:

```
Authorization: Bearer eng_<the-key-for-this-agent>
```

Wire it in one of two equivalent ways, per agent:

- **MCP config header** — set the `Authorization: Bearer <key>` header on the
  `engram` server entry in that agent's MCP client configuration.
- **Environment variable** — set `ENGRAM_API_KEY=eng_…`; the `engram` CLI
  bridge and hook wrappers read it and attach the Bearer header for you.

The exact config file and header syntax for each of the five agents is in
`docs/agent-memory-clients.md`. **Never commit a key to git** — no `eng_…`
value belongs in a tracked file, a checked-in `.mcp.json`, or a commit message.
Keep keys in per-agent local config or an untracked env file.

## MCP_ADMIN_TOKEN is admin-only

`MCP_ADMIN_TOKEN` is **not an agent key** and must **never** be handed to an
agent. It guards the destructive/admin tools (`reindex_*`, consolidate,
`create_api_key`, `revoke_api_key`) via a constant-time comparison. A leaked
admin token lets any holder mint keys for any tenant and run admin operations —
it is the most sensitive secret in this system.

- Give agents only their scoped `eng_…` key. Give **no** agent the admin token.
- Store `MCP_ADMIN_TOKEN` only where an operator mints/rotates keys (the server
  env / operator shell), never in an agent config.

## Rotating a key

Rotation is **revoke, then re-mint** — there is no in-place update. Use it on a
schedule, on suspected exposure, or when an agent is retired.

1. Find the key id: call `list_api_keys` with `{ "userId": "qp" }` and read the
   `id` of the key whose `name`/`prefix` you are rotating.
2. Revoke it: call `revoke_api_key` with `{ "userId": "qp", "keyId": "<id>" }`.
   The old `eng_…` value stops working immediately.
3. Re-mint: run the `create_api_key` `tools/call` above with the same `name` and
   `scopes` to get a fresh `eng_…` (shown once).
4. Update that agent's config (the `Authorization` header or `ENGRAM_API_KEY`)
   with the new value, then confirm the agent can still `recall`.

`list_api_keys` and `revoke_api_key` are admin-guarded like `create_api_key`;
they require the admin credential and act by `userId` (and `keyId` for revoke).

## Manual verification checklist

The automated base checks — health `200`, the MCP `initialize` handshake,
`tools/list`, and that an **unauthenticated** protected `tools/call` returns
`401` when `AUTH_REQUIRED=true` — are in
[`scripts/verify-engram-server.sh`](../../scripts/verify-engram-server.sh). Run
that first. Then confirm scope and identity enforcement by hand with a freshly
minted **read-only** key (scopes `["memories:read"]`):

- [ ] **Read-only key can recall.** A `tools/call` for `recall` with the
      read-only key's `Authorization: Bearer` header **succeeds**.
- [ ] **Read-only key cannot remember.** The same key calling `remember` is
      **rejected with a scope error** (403-equivalent): the missing
      `memories:write` scope is denied, no memory is written.
- [ ] **Spoofed body `userId` is ignored.** Send a `remember`/`recall` whose
      body sets `userId` to some other value (e.g. `"attacker"`); the server
      **injects the key's `userId` (`qp`)** and the operation acts on `qp`, not
      the spoofed value. The token wins over the body.
- [ ] **No key is `401`.** A protected `tools/call` sent with **no**
      `Authorization` header returns `401` (auth is on).

If any check fails, do not distribute keys until `AUTH_REQUIRED=true`, loopback
bind, and the per-agent keys above are all in place.
