---
title: WP5 — Engram as Primary Agent Memory Plan
description: Integration plan for per-agent MCP wiring + hooks so agents use Engram as primary memory (D1–D8, T1–T13)
---

# WP5 — Engram as Primary Agent Memory (Integration Plan)

> **Audience:** one executor (Opus 4.8 / Sonnet 5) running **one** task from the Work
> Breakdown with no other context. Read `CLAUDE.md` and `AGENTS.md` at repo root first.
> This is a **planning deliverable only** — no code is written by producing this file.
> Every task below is self-contained; do not assume you have read any other section.

## Context

qp uses five AI coding agents — **Claude Code**, **GitHub Copilot (VS Code)**, **Cursor**,
**OpenAI Codex CLI**, and **Gemini CLI** — each with its own native, file-based memory
(`CLAUDE.md`/`~/.claude` auto-memory, `.github/copilot-instructions.md`, `.cursor/rules/*`,
`AGENTS.md`, `GEMINI.md`). Memory is therefore siloed per-agent and per-machine, never
shared, never semantically searchable.

**Goal of WP5:** make the ENGRAM MCP server the _primary_ memory store and recall source
for all five agents, so they **automatically store** new memories to Engram and
**automatically recall** from it at the start of / during a task — rather than (or in
addition to) their native file memory. "Automatic" must not depend on the model
remembering to call a tool: we use client hooks, instruction-file directives, and a
file-watcher fallback bridge.

This WP **consumes WP4's importers** (see
`docs/plans/2026-07-memory-platform/WP4-agent-memory-import/PLAN.md`, authored
concurrently) for the one-time migration of each agent's existing native memory into
Engram, and for the file-watcher bridge that keeps native files synced. WP5's plan can be
written/executed in parallel, but the importer code from WP4 must ship before T11 (bridge)
and the initial-migration steps run.

## Current state (verified file:line references)

### How the MCP server is exposed

- **Transport is selected by `MCP_TRANSPORT`** env var, default **`stdio`**; the only
  other supported value is **`streamable-http`** — `apps/mcp-server/src/main.ts:84`
  (`const mcpTransport = process.env.MCP_TRANSPORT ?? 'stdio'`).
- Over HTTP the server listens on `PORT` (default **3000**) and serves MCP at the
  **`POST/GET/DELETE /mcp`** route with per-session `mcp-session-id` headers —
  `apps/mcp-server/src/main.ts:234-314`, `:330-331`. Health is `GET /health` (SETUP.md:400).
- Over stdio the handler is started with `mcpHandler.start(serverConfig)` —
  `apps/mcp-server/src/main.ts:316`. Server identity: `name: 'engram', version: '0.1.0'`
  (`main.ts:148-153`).
- The example client config (`claude_desktop_config.json.example`) spawns the server as a
  **stdio** child: `command: "node"`, `args: ["…/apps/mcp-server/dist/main.js"]`, with
  `DATABASE_URL`/`REDIS_URL`/`QDRANT_URL` in `env`. No `MCP_TRANSPORT` set ⇒ stdio.
- Deployment: production is Docker Compose (`docker-compose.prod.yml`) or the
  `apps/mcp-server/Dockerfile`, port 3000 (`docs/deploy.md:13-15,51`). SETUP.md documents
  running `pnpm --filter mcp-server dev` on `http://localhost:3000` and the Claude Desktop
  config-file locations (`docs/SETUP.md:343-371`). **There is no documented persistent
  HTTP-transport "always-on local server" recipe today** — the only client wiring shown is
  stdio spawn (SETUP.md §"MCP Client Setup").

### Exact MCP tool inventory available today (store / recall)

Built-in (`packages/core`, registered in `packages/core/src/mcp/tools/index.ts:160`):

| Tool   | Auth     | Purpose                         |
| ------ | -------- | ------------------------------- |
| `ping` | `public` | Connectivity check (no userId). |

Memory + admin + api-key tools registered by the app via `registerAdditionalTools`
(`apps/mcp-server/src/main.ts:144-146`; definitions at
`apps/mcp-server/src/memory/memory.controller.ts:1075-1265` and
`apps/mcp-server/src/api-keys/api-keys.controller.ts:163-196`):

| Tool                     | Auth mode           | Scope (`scopeByTool`) | Key input fields (verified in `src/memory/dto/*`)                                                                                                                    |
| ------------------------ | ------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_memory`          | identity            | `memories:write`      | `userId`, `content` (1–10240), `type` `'short-term'\|'long-term'`, `scope?` (≤256), `metadata?`, `tags?` (≤50) — `create-memory.dto.ts`                              |
| `get_memory`             | identity            | `memories:read`       | `userId`, `id`, `scope?` — `get-memory.dto.ts`                                                                                                                       |
| `list_memories`          | identity            | `memories:read`       | `userId`, `type?`, `scope?`, `tags?`, `search?`, pagination cursor — `list-memories.dto.ts`                                                                          |
| `update_memory`          | identity, delegable | `memories:write`      | `userId`, `id`, content/metadata/tags — `update-memory.dto.ts`                                                                                                       |
| `delete_memory`          | identity, delegable | `memories:delete`     | `userId`, `id`, `scope?` (reuses `get-memory` schema)                                                                                                                |
| `promote_memory`         | identity            | `memories:write`      | `userId`, `id` (STM→LTM)                                                                                                                                             |
| `recall`                 | identity, delegable | `memories:read`       | `userId`, `query` (1–2048), `limit?`=10 (1–50), `scope?`, `tags?`, `createdFrom?`, `createdTo?` — `recall.dto.ts`                                                    |
| `remember`               | identity            | `memories:write`      | `userId`, `content` (1–10240), `type?` `'auto'\|'short-term'\|'long-term'`=`auto`, `scope?`, `metadata?`, `tags?`, `ttl?`, `skipDuplicateCheck?` — `remember.dto.ts` |
| `forget`                 | identity            | `memories:delete`     | `userId`, concept query, `scope?`, `confirm?` (dry-run default) — `forget.dto.ts`                                                                                    |
| `reflect`                | identity            | `memories:read`       | `userId`, query — synthesises cross-memory insights — `reflect.dto.ts`                                                                                               |
| `compress_context`       | identity            | `memories:read`       | `userId`, query, char budget, `scope?` — `context.dto.ts`                                                                                                            |
| `load_context`           | identity            | `memories:read`       | `userId`, char budget, `scope?`, `tags?` — session-priming block (recent × important) — `context.dto.ts`                                                             |
| `prompt_context`         | identity            | `memories:read`       | `userId`, query, token budget, `scope?`, `tags?` — token-budgeted packed block — `context.dto.ts`                                                                    |
| `ingest_conversation`    | identity            | `memories:write`      | `userId`, conversation turns — idempotent bulk per-turn LTM ingest — `ingest-conversation.dto.ts`                                                                    |
| `reindex_memories`       | **admin**           | — (`MCP_ADMIN_TOKEN`) | `adminToken`, `userId?` — rebuild vector store                                                                                                                       |
| `queue_reindex_memories` | **admin**           | —                     | `adminToken`, … — async reindex job                                                                                                                                  |
| `get_reindex_status`     | **admin**           | —                     | `adminToken`, `jobId`                                                                                                                                                |
| `cancel_reindex_job`     | **admin**           | —                     | `adminToken`, `jobId`                                                                                                                                                |
| `retry_reindex_job`      | **admin**           | —                     | `adminToken`, `jobId`                                                                                                                                                |
| `consolidate_memories`   | **admin**           | —                     | `adminToken`, `userId?` — STM→LTM promotion pass — `consolidate.dto.ts`                                                                                              |
| `create_api_key`         | **admin**           | —                     | `adminToken`, `userId`, scopes — mints a per-user API key                                                                                                            |
| `list_api_keys`          | identity            | (identity)            | `userId`                                                                                                                                                             |
| `revoke_api_key`         | identity            | (identity)            | `userId`, keyId                                                                                                                                                      |

> \*\*The two tools WP5 relies on for the store/recall loop are `remember` (smart auto STM/LTM
>
> - dedup) and `recall`/`load_context`/`prompt_context` (semantic recall + session priming).\*\*
>   `remember` is preferred over `create_memory` for agents because it auto-routes and dedups.

### `recall` ranking (verified `packages/core/.../tools/README.md:66-85`)

Blended re-rank: `finalScore = 0.7·similarity + 0.2·recency(exp decay, half-life 30d) + 0.1·importance`
(weights normalised; `importance` from `metadata.importance`, default 0.5). Over-fetches
`limit×3` (cap 100) candidates before re-ranking. Returns `{ results: [] }` (never errors)
when the vector store / embeddings are unavailable — **recall degrades gracefully to empty**.

### Auth model (verified) — this is load-bearing for WP5

- **Two credential types over HTTP**: JWT session and per-user **API key**, resolved by
  `AuthResolver.authenticate(req.headers)` in `apps/mcp-server/src/auth/mcp-auth.middleware.ts:109`.
  Verified identity carries `{ userId, organizationId, email, method, apiKeyId, scopes }`
  (`McpAuthInfo`, `mcp-auth.middleware.ts:14-25`).
- **Enforcement only applies over `streamable-http` AND when `AUTH_REQUIRED` is true**
  (`main.ts:89`). Over **stdio the server is treated as trusted-local — no auth at all**
  (`main.ts:86-90`).
- When authenticated, the verified `userId` is **injected over any client-supplied `userId`**
  for identity tools (the tenant boundary is the token, not the request body) —
  `packages/core/src/mcp/tools/index.ts:277-293`, `resolveActingUserId` at `:133-155`.
  Admin-scoped keys may _delegate_ (act on another `userId`) only on `delegable` tools
  (`recall`, `update_memory`, `delete_memory`).
- **Scopes are load-bearing when authenticated**: `memories:read` / `memories:write` /
  `memories:delete`, `admin` satisfies any (`memory.controller.ts:1267-1274`,
  dispatch check `index.ts:262-268`).
- **Admin tools gate on `MCP_ADMIN_TOKEN`** via constant-time compare, independent of the
  above (`memory.controller.ts:116-128`). `MCP_ADMIN_TOKEN` is **admin-only**; it is NOT a
  per-agent credential.
- **The dangerous default**: with `streamable-http` + `AUTH_REQUIRED=false`, `userId` is
  taken from tool input and is fully **spoofable** — any client can read/write any tenant's
  memory. The server refuses to boot in that posture only when `DEPLOYMENT_PROFILE` is
  multi-tenant AND `NODE_ENV=production` AND `ALLOW_UNAUTHENTICATED_HTTP` is unset
  (`main.ts:98-118`). A single-user local `memory`/`lite` profile will happily serve HTTP
  unauthenticated. **⇒ For a shared multi-agent HTTP server, `AUTH_REQUIRED=true` + per-agent
  API keys is mandatory; see T5 and Risk R1.**

### userId format — verified constraint (affects every snippet and the scoping design)

`userId` must satisfy `userIdSchema = cuid **or** cuid2` (`packages/database/src/types.ts:6-9,142`).
Empirically (zod 4.4.3, tested against the repo's installed zod):

- `"qp"` ⇒ **valid** (cuid2 accepts lowercase-alphanumeric).
- `"q"` ⇒ valid; `"engram-user"` / `"qp-global"` / anything with a **hyphen or uppercase** ⇒ **INVALID**.

**⇒ `userId` must be lowercase-alphanumeric.** qp's `userId` is `"qp"` (matches the standing
convention in memory + suite README:47). Project/agent/session separation therefore **cannot**
live in `userId` (hyphens/paths fail) — it MUST use the tool `scope` field (a free string ≤256).
See "Scoping" in Design decisions.

### Prior art for Copilot context injection (`apps/vscode-copilot-compressor`)

A working VS Code extension (`apps/vscode-copilot-compressor/src/*`) that contributes a
**chat participant** `@compressor` (`engram.compressor`), commands, and a prompt file. Its
README states plainly: **"Built-in GitHub Copilot chat traffic interception is not supported
by VS Code extension APIs"** — the extension uses supported contribution points
(participant, commands, `*.prompt.md`) instead. **Implication for WP5:** we cannot silently
intercept Copilot's model calls to inject recall; for Copilot the realistic automatic path is
(a) the VS Code **`mcp.json`** server registration so Copilot Agent mode can _call_ Engram
tools, plus (b) `.github/copilot-instructions.md` directives, plus (c) optionally extending
this extension to auto-inject a recall block via the participant. Full transparent
interception is out of scope (unsupported by the platform).

## Goals / Non-goals

**Goals**

- One persistent Engram server that all five agents share as primary memory (one store, not
  five silos, not one-per-machine).
- **Automatic recall**: relevant memories are surfaced at session start / before a task
  without the user asking. Deterministic for Claude Code (hook), best-effort (instruction
  compliance) for the other four.
- **Automatic store**: memory-worthy facts learned during a session are persisted without
  relying on the model choosing to call a tool — via (L1) instruction directives the model
  follows inline, and (L2) a SessionEnd hook backstop (Claude Code).
- A single canonical **Agent Memory Contract** doc every instruction file references, so the
  five agents behave consistently (same `userId`, same scoping, same write rubric).
- Graceful degradation when the server is down (never block the agent; recall → empty; store
  → local spool + retry).
- A recall-quality regression **gate** (wire `packages/eval`) so "primary memory" can't
  silently get dumber.

**Non-goals**

- Replacing/removing native memory files. Native files stay (agents still read them); Engram
  becomes the _primary_ shared/searchable layer and the _authority_ on conflict (see policy).
  WP5 does not delete `CLAUDE.md` etc.
- Transparent interception of any agent's model traffic (Copilot API forbids it; others have
  no such hook). We use supported extension points only.
- New server-side memory features (dedup/consolidation/decay engines, schema changes). WP5 is
  integration + wiring + docs; it consumes existing tools and WP4 importers. Any server change
  it needs is called out as a dependency, not owned here.
- Multi-machine hosted deployment hardening (TLS/backup/uptime) beyond documenting the
  requirement — that is ops (G9 / WP6).

## Design decisions

### D1 — Run ONE persistent HTTP-transport server; all agents point at its URL

Default transport is stdio, which makes each client **spawn its own** `node dist/main.js`
(`main.ts:84,316`; `claude_desktop_config.json.example`). Those processes all connect to the
same Postgres/Redis/Qdrant, so memory _is_ technically shared — **but** (a) a full NestJS boot
per client/per hook invocation is multi-second (unacceptable for a SessionEnd hook, see D3),
(b) stdio has no auth, and (c) N processes multiply resource use and log noise.

**Decision:** run Engram **once** as a long-lived process with `MCP_TRANSPORT=streamable-http`
on `http://127.0.0.1:3000/mcp`, and register it in every agent as a **remote HTTP MCP server
by URL** (not a stdio spawn). Bind to loopback by default. Managed by systemd (Linux, qp's
platform) or Docker Compose. This is the backbone; T4 owns the recipe. Clients that only speak
stdio cleanly (verify per agent) use a stdio→HTTP bridge (e.g. `npx mcp-remote <url>`) — mark
verify-at-execution.

### D2 — `remember` + `recall`/`load_context` are the loop; scope carries project/agent

- **Store** uses `remember` (auto STM/LTM routing + server-side dedup + returns routing
  metadata — `memory.controller.ts:1203`, `remember.dto.ts`), not `create_memory`. Agents
  never have to decide the tier.
- **Recall** uses `recall` for a query and **`load_context`** for the zero-query
  session-priming block (blends recent × important — `context.dto.ts:54`,
  `memory.controller.ts:1237`). `prompt_context` when a token budget matters.
- **`userId` = tenant only** and must be lowercase-alphanumeric (cuid2; verified: `"qp"`
  passes, hyphens/uppercase fail). qp = `"qp"`.
- **Project / agent / session separation uses the `scope` field** (free string ≤256), NOT
  userId. Canonical scope grammar (define in the Contract, T1):
  - `global` — cross-project facts (preferences, standing conventions). Recalled everywhere.
  - `project:<slug>` — per-repository facts. **`<slug>` MUST be
    `basename(git rev-parse --show-toplevel)` lowercased, NOT `basename(cwd)`** — otherwise an
    agent invoked from a subdirectory computes a different slug and its project recall silently
    fragments from the others (see R10). All five agents must derive the slug identically; T1
    specifies the exact command.
  - `project:<slug>/session:<id>` — ephemeral session notes (usually STM/`ttl`).
  - `agent:<name>` may be appended as a `metadata.agent` field (not scope) for provenance.
    Recall strategy: query `scope=project:<slug>` first, then a second pass at `scope=global`
    (or omit scope for a blended recall) — the Contract specifies the exact order.

### D3 — What "automatic store" actually stores (the crux): model distills, hook backstops

A lifecycle hook receives session _metadata_ (transcript path, session id — see T6/verified
facts from the guide task), **not** a curated fact. Storing raw transcripts = noise + embedding
cost + secret-leak risk (GAPS G2). We therefore split store into two layers. **Trigger choice:** use `SessionEnd` (a clean
whole-session end-signal that carries the transcript path). **Not** `PostToolUse` (fires on every
tool call — far too noisy) and **not** `Stop` (fires per assistant response — too frequent for
whole-session capture, and can re-fire on continuation):

- **L1 (primary) — in-session directive:** the instruction file tells the agent, when it
  learns something memory-worthy per the **write rubric** (D4), to call `remember` inline with
  a _distilled one-fact_ content string and the right `scope`/`tags`. The model is the best
  distiller and is already in the loop; this is the main path and works for all five agents.
- **L2 (backstop, Claude Code only) — SessionEnd hook:** a hook invokes the Engram CLI (T3)
  with the transcript path. The CLI runs a **bounded distillation pass** (one cheap LLM call,
  provider configurable; prompt = the write rubric) to extract ≤N memory-worthy facts from the
  session, then calls `remember` for each (dedup is server-side, so re-storing L1 facts is
  safe). If no LLM key is configured **or** the server is down, the CLI **spools locally and
  exits 0** — it must never block Claude Code (D5). Raw-transcript storage is explicitly
  rejected; distillation is mandatory before any write.

Rationale for L2 distillation over `ingest_conversation`: `ingest_conversation` stores raw
per-turn memories (bulk, idempotent) — great for _explicit_ conversation archival, but as an
automatic backstop it reintroduces the noise/secret problem. Offer `ingest_conversation` only
as an opt-in "archive this whole conversation" command, not the default backstop.

### D4 — Write policy: a concrete "is this memory-worthy?" rubric (agents can follow it)

Store when the fact is **durable, reusable, and not trivially re-derivable**. Concretely, store:

1. **Decisions & rationale** — "we chose pgvector over Qdrant because X"; architectural
   choices and _why_.
2. **Conventions & preferences** — coding style, commit format, tools qp prefers, naming rules.
3. **Environment & wiring facts** — non-secret config, service URLs, ports, how to run X.
4. **Gotchas & fixes** — "test Y flakes unless Z"; root-caused bugs and their resolution.
5. **User/project facts** — stable identity, ownership, domain vocabulary.

Do **NOT** store: secrets/tokens/keys/PII (hard block — redaction is a WP4/G2 concern, but the
rubric forbids it at the source); transient state ("currently on line 40"); easily
re-derivable facts (contents of a file in the repo); speculation the agent isn't confident in;
verbatim large code blocks (store the decision, link the file). Prefer **one fact per memory**,
≤ ~500 chars, imperative/declarative, tagged. `scope` per D2. `metadata.importance` (0–1) set
higher for decisions/conventions so recency-decay doesn't bury them.

### D5 — Offline / degraded behavior (never block the agent)

- **Recall** already returns `{ results: [] }` when the vector store/embeddings are down
  (tools README:109) and any transport error must be swallowed by the client wrapper → agent
  proceeds with native memory only.
- **Store** (hooks/CLI) must be **non-blocking and exit 0 on any failure** (a hook that errors
  can stall Claude Code). On server-unreachable, append the pending `remember` payloads to a
  local spool file (e.g. `~/.engram/spool.jsonl`); a `engram sync-spool` subcommand (run on
  next SessionStart or by a timer) replays them. Spool entries carry an idempotency key so a
  double-replay is a no-op (server-side dedup covers content-level dupes too).
- Timeouts: CLI uses a short connect timeout (e.g. 2s) so a dead server never adds latency.

### D6 — Auth: per-agent API keys over HTTP; MCP_ADMIN_TOKEN is NOT for agents

Over HTTP with `AUTH_REQUIRED=false`, `userId` is client-supplied and **spoofable** — any agent
(or anything that can reach the port) can read/write any tenant (`main.ts:98-118`, verified).
For a shared multi-agent server this is unacceptable even locally once >1 identity exists.

**Decision:** the persistent server runs with **`AUTH_REQUIRED=true`**, and each agent is given
its **own per-user API key** minted via the admin `create_api_key` tool (T5) with least
privilege — `memories:read` + `memories:write` (+ `memories:delete` only if the agent needs
`forget`/`delete_memory`). Keys are passed as `Authorization: Bearer <key>` in the MCP server
registration `headers` (HTTP clients) or an `env` var the CLI reads. `MCP_ADMIN_TOKEN` is
**admin-only** (reindex/consolidate/create_api_key) and must never be handed to an agent. For a
strictly single-user, loopback-only, single-`userId` (`qp`) setup, `AUTH_REQUIRED=false` is
tolerable **only** if the port is firewalled to loopback — but the plan's default and
recommendation is auth-on. See Risk R1.

### D7 — Native-file ⇄ Engram conflict / staleness authority

With Engram "primary" but native files still present and still read by each agent, define one
authority rule:

- **Engram is the authority for shared/cross-session facts** (scope `global` and
  `project:<slug>`). Native files remain the authority for _bootstrap_ content the tool needs
  before it can reach Engram (e.g. the directive block itself, tool-permission config).
- **Conflict rule: newest-wins by `updatedAt`, surfaced not silently merged.** When the
  file-watcher bridge (T11) re-imports a native file whose content maps to an existing memory,
  it **updates** (not duplicates) via WP4's provenance/idempotency key and stamps
  `metadata.source=file:<path>` + `metadata.syncedAt`. If the Engram copy was edited more
  recently than the file (via UI/another agent), the bridge does **not** clobber it — it stores
  the file version as a new memory tagged `conflict` + `superseded-by-review` and logs it for
  qp to reconcile (avoids a file re-write silently reverting an agent's learning).
- **Staleness:** memories carry `metadata.source`/`syncedAt`; recall re-rank already decays by
  recency (30-day half-life). A future consolidation/decay job (GAPS G3, out of WP5 scope)
  handles long-term staleness; WP5 only guarantees provenance is recorded so that job can run.
- **Dedup against prior WP4 imports:** the bridge MUST reuse WP4's dedup/provenance model
  (same content-hash / idempotency key) so the initial migration and ongoing sync don't create
  duplicates. This is the concrete WP4 dependency (see Dependency graph).

### D8 — Recall guarantee is asymmetric — state it honestly per agent

Only **Claude Code** can _deterministically_ inject a recall block at session start (SessionEnd
/SessionStart hooks call the CLI — machine-enforced). Copilot, Cursor, Codex, and Gemini rely
on the model **choosing to follow** the instruction-file directive to call `recall`/`load_context`
first — best-effort, not guaranteed. Each per-agent spec states its guarantee level explicitly;
do not imply all five are equally automatic.

> **Verified:** there is **no REST memory-CRUD endpoint**. `@Controller('memory')`
> (`memory.controller.ts:96`) exposes no `@Get/@Post` routes — it only provides `getMcpTools()`.
> The only HTTP routes are `/health*`, `/auth/*`, and the raw `/mcp` JSON-RPC transport
> (`main.ts:234-314`). **⇒ The CLI (T3) and every agent must speak MCP JSON-RPC (initialize +
> `mcp-session-id` handshake) — `curl`-to-REST is not an option.**

## Per-agent integration specs

**Confidence legend:** 🟢 verified against current docs during planning · 🟡 believed correct,
**must be re-verified at execution** (config formats drift) · 🔴 platform-limited / best-effort.
Every subsection ends with a **Verify** block — do not skip it, and do not present a 🟡 snippet
as final without running the verification.

### A. Claude Code (CLI) — 🟢 primary, deterministic

> Claude Code (the CLI) ≠ Claude Desktop (§F). Only Claude Code has hooks, reads `.mcp.json`,
> and reads `CLAUDE.md`. This is the backbone: the only agent with a _deterministic_ automatic
> loop. Facts below verified against official docs (July 2026).

**MCP wiring** — project-root `.mcp.json` (checked into repo, project scope), pointing at the
persistent HTTP server (D1):

```json
{
  "mcpServers": {
    "engram": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer ${ENGRAM_API_KEY}" }
    }
  }
}
```

For a machine-wide (all-projects) registration use `claude mcp add --scope user` (writes
`~/.claude.json`). Local dev may still use the stdio spawn from
`claude_desktop_config.json.example` shape, but D1 prefers the URL form. If the running Claude
Code build does not interpolate `${ENGRAM_API_KEY}` in `headers`, use `headersHelper` (a command
that prints `{"Authorization":"Bearer …"}`) — verify at execution.

**Automatic recall (deterministic)** — `SessionStart` hook whose **stdout is injected into
context automatically** (verified). It calls the CLI (T3) `engram recall-context`, which runs
`load_context` (scope `project:<cwd-slug>` blended with `global`) and prints a compact block.
Matchers: `startup` and `resume`.

**Automatic store (backstop)** — `SessionEnd` hook (matcher `*`) calls `engram capture
--transcript "$transcript_path"` (T3): distills memory-worthy facts per the D4 rubric and calls
`remember`. Exits 0 always (non-blocking; D5). L1 in-session directive lives in `CLAUDE.md`.

**Hook config** — `.claude/settings.json` (project, shared/checked-in) so the team/agents get it;
use `${CLAUDE_PROJECT_DIR}` for the hook command path:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/engram-recall.sh",
            "timeout": 15
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/engram-capture.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

**Instruction directive** — append an "Engram memory contract" block to `CLAUDE.md` (§ contract
in T1): call `recall`/`load_context` before non-trivial tasks; call `remember` (rubric-gated)
when a durable fact is learned; `userId:"qp"`, scope grammar per D2.

**Native memory to migrate/sync (T11):** `~/.claude/projects/<project>/memory/MEMORY.md`
(+ topic files) — Claude Code's auto-memory (first 200 lines/25 KB loaded per session), and the
`CLAUDE.md` files themselves.

**Recall guarantee:** 🟢 deterministic (hook-injected). **Store guarantee:** L1 best-effort +
L2 deterministic backstop.

**Verify:** (1) `claude --version` and confirm hook event names `SessionStart`/`SessionEnd`
still exist and that `SessionStart` stdout is still auto-added to context (docs → Hooks
Reference). (2) Confirm `.mcp.json` still uses top-level `mcpServers` + `type:"http"` + `headers`.
(3) Confirm `${ENGRAM_API_KEY}`/`${CLAUDE_PROJECT_DIR}` interpolation works in the installed
build; fall back to `headersHelper`/absolute paths if not. (4) Manual: start a session in a temp
repo, confirm the recall block appears and a test fact is stored (query `recall` after).

### B. GitHub Copilot in VS Code — 🟡 wiring / 🔴 automatic-store limited

> Platform limit (verified via `apps/vscode-copilot-compressor/README.md`): **VS Code extension
> APIs cannot intercept built-in Copilot chat traffic.** So there is no hook to force
> store/recall. The realistic path: register Engram as an MCP server so **Copilot Agent mode can
> call the tools**, plus instruction-file directives, plus (optional) extend the existing
> extension to surface a recall block via its `@compressor` participant.

**MCP wiring** — VS Code reads **`.vscode/mcp.json`** (workspace) or user `settings.json`. ⚠️
**Divergent from Claude Code:** VS Code's top-level key is **`servers`** (not `mcpServers`) and
it supports an **`inputs`** array for prompted secrets. Believed shape (🟡 verify):

```json
{
  "inputs": [
    {
      "id": "engram-key",
      "type": "promptString",
      "description": "Engram API key",
      "password": true
    }
  ],
  "servers": {
    "engram": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer ${input:engram-key}" }
    }
  }
}
```

**Automatic store/recall** — 🔴 no interception. Use `.github/copilot-instructions.md`
directives (Copilot reads this automatically) telling Agent mode to call Engram `recall` before
a task and `remember` after. Best-effort only. **Optional enhancement (T7):** extend
`apps/vscode-copilot-compressor` with a command / participant turn that fetches a recall block
and injects it into the prompt the user pastes/sends — supported contribution point, not
interception.

**Native memory to migrate/sync:** `.github/copilot-instructions.md`, `.github/instructions/*.md`.

**Recall guarantee:** 🔴 best-effort (instruction compliance; Agent mode only — classic
completions cannot call tools). **Store:** best-effort.

**Verify:** (1) Current VS Code + Copilot docs — confirm `.vscode/mcp.json` still uses `servers`

- `inputs`, and `${input:id}` header interpolation. (2) Confirm the installed Copilot supports
  MCP tools in Agent mode and reads `.github/copilot-instructions.md`. (3) Manual: open Agent mode,
  confirm `engram` tools are listed and callable.

### C. Cursor — 🟡

**MCP wiring** — project-root **`.cursor/mcp.json`** (or global `~/.cursor/mcp.json`); top-level
key **`mcpServers`** (like Claude Code). Believed shape (🟡 verify):

```json
{
  "mcpServers": {
    "engram": {
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer <ENGRAM_API_KEY>" }
    }
  }
}
```

(Some Cursor versions key HTTP servers by `url` only; older ones expect a stdio `command`. If
HTTP-by-url is not honored, register a stdio bridge: `command:"npx"`, `args:["mcp-remote",
"http://127.0.0.1:3000/mcp","--header","Authorization: Bearer …"]` — verify.)

**Automatic store/recall** — Cursor **Rules** in **`.cursor/rules/*.mdc`** (front-matter
`alwaysApply: true` for an always-on rule). Add `engram-memory.mdc` directing recall-before-task
and remember-after (references the T1 contract). Best-effort (Agent must comply).

**Native memory to migrate/sync:** `.cursor/rules/*.mdc`, legacy `.cursorrules`.

**Recall guarantee:** 🔴 best-effort. **Store:** best-effort.

**Verify:** (1) Current Cursor docs — `.cursor/mcp.json` key (`mcpServers`), HTTP-by-`url`
support, `headers` support; `.mdc` rule front-matter (`alwaysApply`). (2) Manual: Cursor Settings
→ MCP shows `engram` connected; ask the agent to call `recall`.

### D. OpenAI Codex CLI — 🟡 (stdio-oriented)

**MCP wiring** — **`~/.codex/config.toml`**, TOML table **`[mcp_servers.engram]`** (note the
**underscore** in `mcp_servers`). Codex is historically stdio-oriented; HTTP support varies by
version. Believed stdio-bridge shape (🟡 verify — safest cross-version):

```toml
[mcp_servers.engram]
command = "npx"
args = ["mcp-remote", "http://127.0.0.1:3000/mcp", "--header", "Authorization: Bearer ${ENGRAM_API_KEY}"]
```

If the installed Codex supports a native HTTP/streamable transport, prefer a direct `url`/`type`
form instead of the bridge — verify.

**Automatic store/recall** — 🔴 no hooks. Directives in **`AGENTS.md`** (Codex reads `AGENTS.md`
automatically at repo root — already present in this repo). Add an Engram contract block:
recall-before-task, remember-after, `userId:"qp"`, scope grammar. Best-effort.

**Native memory to migrate/sync:** `AGENTS.md` (repo + `~/.codex/AGENTS.md` if present).

**Recall guarantee:** 🔴 best-effort. **Store:** best-effort.

**Verify:** (1) `codex --version`; current Codex docs — confirm `~/.codex/config.toml`,
`[mcp_servers.<name>]` table name, and whether native HTTP transport exists (else keep the
`mcp-remote` bridge). (2) Confirm Codex still auto-reads `AGENTS.md`. (3) Manual: run Codex, ask
it to list MCP tools / call `recall`.

### E. Gemini CLI — 🟡

**MCP wiring** — **`~/.gemini/settings.json`** (global) or project `.gemini/settings.json`;
top-level key **`mcpServers`**; HTTP servers use **`httpUrl`** (⚠️ divergent field name), stdio
use `command`/`args`. Believed shape (🟡 verify):

```json
{
  "mcpServers": {
    "engram": {
      "httpUrl": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer $ENGRAM_API_KEY" }
    }
  }
}
```

**Automatic store/recall** — 🔴 no hooks. Directives in **`GEMINI.md`** (Gemini CLI reads it
automatically, akin to CLAUDE.md). Add the Engram contract block. Best-effort. (Gemini CLI also
has a nascent extensions/tools mechanism — if a `preTool`/session hook exists at execution time,
wire a recall call there; verify.)

**Native memory to migrate/sync:** `GEMINI.md` (repo + `~/.gemini/GEMINI.md`).

**Recall guarantee:** 🔴 best-effort. **Store:** best-effort.

**Verify:** (1) Current Gemini CLI docs — confirm `settings.json` path, `mcpServers`, and
`httpUrl` vs `url` for HTTP, `headers` support. (2) Confirm `GEMINI.md` auto-load. (3) Check for
any session/pre-prompt hook mechanism to upgrade recall from best-effort. (4) Manual: `/mcp` in
Gemini CLI lists `engram`; call `recall`.

### F. Claude Desktop (bonus target) — 🟢 tool-availability only

Distinct from Claude Code: **stdio-only, no hooks, does not read `CLAUDE.md`/project files.** Its
"primary memory" story is limited to making the tools _available_ via
`claude_desktop_config.json` (existing example spawns stdio; for the shared HTTP server use an
`mcp-remote` stdio bridge). No automatic store/recall — purely on-demand tool calls. Config
locations per `docs/SETUP.md:362-368`. Include only as a documented extra; not a WP5 acceptance
target.

## Work breakdown

Each task is self-contained. **Foundational** T1–T5 unblock the rest; **per-agent** T6–T10 are
mutually independent and MUST be executable in parallel (different files, no shared edits);
**cross-cutting** T11–T13 follow. Sizes: S ≈ ≤½ day, M ≈ 1–2 days, L ≈ 3–5 days.

### T1 — Canonical "Agent Memory Contract" doc (S) — deps: none

- **What:** the single doc every instruction file references, so all five agents behave
  identically. Create `docs/agent-memory-contract.md`.
- **Content (from Design decisions):** (a) `userId` convention — lowercase-alphanumeric,
  cuid/cuid2 only; qp = `"qp"` (cite `packages/database/src/types.ts:6-9,142`; note hyphens/
  uppercase are rejected). (b) Scope grammar (D2): `global`, `project:<slug>`,
  `project:<slug>/session:<id>`, `metadata.agent` for provenance. (c) Recall protocol: call
  `load_context`/`recall` before non-trivial tasks; project scope then global. (d) Write rubric
  (D4) verbatim, with the do/don't lists and one-fact-per-memory + `metadata.importance`
  guidance. (e) Offline behavior summary (D5). (f) The exact tool names/fields agents may use
  (`remember`, `recall`, `load_context`, `prompt_context`, `forget`) copied from the Current-
  state inventory. (g) A short copy-pasteable "directive block" that T6–T10 embed into each
  instruction file (kept ≤ ~40 lines so it fits token budgets).
- **Acceptance:** doc exists, `pnpm docs:check` passes; the directive block is < 40 lines; every
  tool/field named in it matches a real schema in `apps/mcp-server/src/memory/dto/*`.
- **Tests:** docs task is prose — add a `docs:check`/link-lint assertion and a tiny test/script
  that greps the directive block's tool names and fails if any is not in the registered tool set
  (guards drift when tools are renamed).

### T2 — Persistent HTTP-transport server recipe (M) — deps: none (pairs with T4)

- **What:** a documented, always-on local server so all agents share one store (D1). No app code
  change expected — it is env + process management.
- **Paths/steps:** add a `docs/agent-memory-server.md` runbook (and link from `docs/SETUP.md`
  §"MCP Client Setup" and `docs/deploy.md`): run with `MCP_TRANSPORT=streamable-http`,
  `PORT=3000`, bind loopback, `AUTH_REQUIRED=true` (see T4), an appropriate
  `DEPLOYMENT_PROFILE`. Provide a **systemd user unit** (`engram-mcp.service`, `Restart=always`,
  reads an env file) for qp's Linux host, and a Compose snippet alternative referencing
  `docker-compose.prod.yml` (`docs/deploy.md:57-83`). Document the health probe
  (`curl http://127.0.0.1:3000/health`) and the MCP URL `http://127.0.0.1:3000/mcp`.
- **Acceptance:** following the runbook yields a server that (a) survives logout/reboot,
  (b) answers `/health` 200, (c) responds to an MCP `initialize` + `tools/list` over HTTP, and
  (d) refuses to serve a protected `tools/call` without a credential when `AUTH_REQUIRED=true`.
- **Tests / manual verification script:** a `scripts/verify-engram-server.sh` that curls
  `/health`, performs an MCP `initialize` handshake, lists tools, and asserts a `recall` call
  without a Bearer token returns 401 (auth on). This is the wiring-level check for D1+D6.

### T3 — `engram` agent-bridge CLI (MCP client) (L) — deps: T1 (rubric text)

- **What:** the small CLI that hooks/watchers invoke. It is a **real MCP client** (there is no
  REST CRUD — verified), so use `@modelcontextprotocol/sdk` client + `StreamableHTTP` client
  transport (`initialize` → `mcp-session-id` → `tools/call`). New workspace bin, e.g.
  `packages/agent-bridge` (or `apps/mcp-server` bin alongside `reindex.cli.ts:1`), published as
  `engram`.
- **Subcommands:**
  - `engram recall-context [--scope project:<slug>] [--budget N]` → calls `load_context`
    (blended recent×important) and prints a compact block to stdout (for SessionStart injection).
  - `engram recall <query>` → `recall`, prints results.
  - `engram remember <content> [--scope …] [--tags …] [--type auto]` → `remember`.
  - `engram capture --transcript <path>` → reads the transcript, runs a **bounded distillation**
    (one cheap LLM call, provider + model from env; prompt = the D4 rubric) to extract ≤N
    memory-worthy facts, then `remember`s each with an idempotency key. If no LLM key **or**
    server unreachable → spool + exit 0.
  - `engram sync-spool` → replay `~/.engram/spool.jsonl` idempotently.
- **Config/behavior:** reads `ENGRAM_URL` (default `http://127.0.0.1:3000/mcp`), `ENGRAM_API_KEY`
  (Bearer), `ENGRAM_USER_ID` (default `qp`). Short connect timeout (~2s). **Every command exits
  0 on failure** and never prints secrets (D5). Redact obvious secret patterns before any
  `remember` (defense-in-depth for D4/G2; full redaction is WP4/G2).
- **Acceptance:** all subcommands work against a running server; with the server down, `capture`/
  `remember` spool and exit 0; `sync-spool` drains the spool without creating duplicates.
- **Tests (service + wiring):** (service) unit-test the distillation prompt assembly, spool
  read/write, idempotency-key generation, secret-redaction, and exit-0-on-error paths with a
  mocked transport. (wiring) an integration test that runs against a real/in-process MCP server
  (reuse `apps/mcp-server` e2e harness) asserting `remember` then `recall` round-trips the fact,
  and that a 401 (bad key) is handled as a graceful spool, not a crash.

### T4 — Per-agent API keys + auth-on (S/M) — deps: T2

- **What:** operationalize D6. Mint one least-privilege API key per agent and turn auth on.
- **Steps:** document/script minting via the admin `create_api_key` tool
  (`api-keys.controller.ts:166`, needs `MCP_ADMIN_TOKEN`): keys for `claude-code`, `copilot`,
  `cursor`, `codex`, `gemini`, `cli-bridge`, each scoped `memories:read`+`memories:write`
  (+`memories:delete` only where `forget`/`delete_memory` is wired). Store keys in each agent's
  config (`headers` Authorization / env), never in git. Set `AUTH_REQUIRED=true` on the T2
  server. Add a `docs/security/agent-keys.md` note: `MCP_ADMIN_TOKEN` is admin-only; rotation
  via `revoke_api_key` + re-mint.
- **Acceptance:** with auth on, a `tools/call` with a valid Bearer key acts on the key's `userId`
  and is scope-limited; a call without a key is 401; a `memories:read`-only key cannot `remember`
  (403). (Behaviors already implemented — `index.ts:262-268`, `main.ts:203-216`; this task
  proves the wiring end-to-end.)
- **Tests / manual verification:** extend `scripts/verify-engram-server.sh` (T2) to mint a
  scoped key, assert read works / write is forbidden for a read-only key, and that userId
  injection ignores a spoofed body `userId` (guards R1). Reference existing coverage in
  `dispatch-auth.spec.ts`.

### T5 — Recall-quality regression gate (M) — deps: none (uses `packages/eval`)

- **What:** wire the existing `packages/eval` precision@k/recall@k/MRR/nDCG harness as a CI gate
  so "primary memory" cannot silently regress (GAPS G8).
- **Steps:** build a small **sanitized seed dataset** (labeled query→relevant-memory pairs)
  under `packages/eval` fixtures; add a `pnpm eval:gate` script that runs the harness against a
  freshly seeded DB (`EMBEDDING_PROVIDER=local` for determinism, or a recorded fixture) and fails
  if metrics drop below thresholds. Add a CI job (extend `.github/workflows/ci.yml`); record
  thresholds in `docs/RELEASE_GATES.md` (precedent exists).
- **Acceptance:** CI job runs `eval:gate` and fails when recall metrics fall below the pinned
  thresholds; passes on current main.
- **Tests (service + wiring):** (service) a unit test that the gate script correctly fails on a
  degraded fixture and passes on a good one. (wiring) the CI job green on main; a deliberately
  broken ranking weight makes it red.

### T6 — Claude Code integration (L) — deps: T1, T3 — 🟢 parallel-safe

- **What:** implement §A. Files: repo `.mcp.json` (HTTP `engram` server), `.claude/settings.json`
  (SessionStart + SessionEnd hooks), `.claude/hooks/engram-recall.sh` + `engram-capture.sh`
  (thin wrappers over T3, exit 0), and append the T1 directive block to `CLAUDE.md`.
- **Steps:** wire per §A snippets; hooks read `$transcript_path`/`$cwd` from stdin JSON and shell
  out to `engram`. Keep API key out of git (use `${ENGRAM_API_KEY}` / `headersHelper`).
- **Acceptance:** in a fresh Claude Code session, (a) a recall block is auto-injected at
  SessionStart, (b) ending the session stores ≥1 distilled fact (verify via `recall`), (c) with
  the server down the session is unaffected (hooks exit 0, spool grows).
- **Tests / manual verification:** `scripts/verify-claude-code.sh` runbook that drives the four
  acceptance checks; hook scripts get a bats/shell unit test for the exit-0-on-error contract.
  Run the §A **Verify** block first (hook/`.mcp.json` field names).

### T7 — GitHub Copilot (VS Code) integration (M) — deps: T1 — 🟡/🔴 parallel-safe

- **What:** implement §B. Files: `.vscode/mcp.json` (`servers` key + `inputs`), append the T1
  directive to `.github/copilot-instructions.md`. **Optional:** extend
  `apps/vscode-copilot-compressor` with a "Load Engram context" command/participant turn.
- **Acceptance:** Copilot Agent mode lists and can call `engram` tools; instructions tell it to
  recall-before / remember-after. (Automatic guarantee is best-effort — documented.)
- **Tests / manual verification:** `scripts/verify-copilot.md` checklist (Agent mode shows
  tools; a manual recall/remember round-trip). If the extension is extended, add extension unit
  tests for the new command. Run §B **Verify** first (`servers` vs `mcpServers`, `inputs`).

### T8 — Cursor integration (M) — deps: T1 — 🟡 parallel-safe

- **What:** implement §C. Files: `.cursor/mcp.json` (`mcpServers`, HTTP-by-`url` or `mcp-remote`
  bridge), `.cursor/rules/engram-memory.mdc` (`alwaysApply: true`) embedding the T1 directive.
- **Acceptance:** Cursor shows `engram` connected; the rule is always applied; agent can recall/
  remember on request.
- **Tests / manual verification:** `scripts/verify-cursor.md` checklist. Run §C **Verify** first
  (key name, HTTP support, `.mdc` front-matter).

### T9 — OpenAI Codex CLI integration (M) — deps: T1 — 🟡 parallel-safe

- **What:** implement §D. Files: `~/.codex/config.toml` (`[mcp_servers.engram]`, `mcp-remote`
  bridge unless native HTTP exists), append the T1 directive to repo `AGENTS.md`.
- **Acceptance:** Codex lists `engram` MCP tools; `AGENTS.md` directs recall/remember.
- **Tests / manual verification:** `scripts/verify-codex.md` checklist. Run §D **Verify** first
  (table name `mcp_servers`, transport support, `AGENTS.md` auto-load).

### T10 — Gemini CLI integration (M) — deps: T1 — 🟡 parallel-safe

- **What:** implement §E. Files: `~/.gemini/settings.json` (`mcpServers`, `httpUrl`), create/append
  `GEMINI.md` with the T1 directive.
- **Acceptance:** `/mcp` in Gemini CLI lists `engram`; `GEMINI.md` directs recall/remember; if a
  session/pre-prompt hook exists, recall is upgraded from best-effort.
- **Tests / manual verification:** `scripts/verify-gemini.md` checklist. Run §E **Verify** first
  (`httpUrl` vs `url`, settings path, hook availability).

### T11 — File-watcher sync bridge (L) — deps: T3, **WP4 importers**

- **What:** a daemon that watches each agent's native memory files and upserts them into Engram
  as a fallback so nothing lives only on disk (D7). Consumes **WP4's importer/IR + provenance/
  dedup** — do not re-implement parsing.
- **Watched paths:** `~/.claude/projects/*/memory/MEMORY.md` (+ topic files), `CLAUDE.md`,
  `.github/copilot-instructions.md`, `.cursor/rules/*.mdc`/`.cursorrules`, `AGENTS.md`,
  `GEMINI.md` (+ their `~/.<agent>` globals).
- **Steps:** on change, run the WP4 importer → IR → dedup by content-hash/idempotency key →
  `create_memory`/`update_memory` with `metadata.source=file:<path>`, `syncedAt`,
  `metadata.agent`. Apply the D7 conflict rule (newest-wins by `updatedAt`; if the Engram copy is
  newer, store the file version tagged `conflict`, do not clobber). Debounce writes; run as a
  systemd user service alongside T2.
- **Acceptance:** editing a watched file creates/updates exactly one memory (no dup on repeat);
  a concurrent newer Engram edit is not clobbered (conflict recorded); server-down defers via
  spool.
- **Tests (service + wiring):** (service) file→IR mapping and conflict-resolution unit tests
  (reuse WP4 fixtures). (wiring) an integration test: touch a fixture file → assert a single
  upsert with correct provenance; touch again → assert no duplicate; simulate newer server copy →
  assert conflict path.

### T12 — Initial migration runbook (S/M) — deps: **WP4 importers**, T4

- **What:** the one-time bulk import of qp's existing native memory across all five agents into
  Engram, using WP4 importers (distinct from T11's ongoing watch).
- **Steps:** `docs/agent-memory-migration.md` runbook: run each WP4 importer in dry-run (cost/
  count estimate — GAPS G7), then execute with `EMBEDDING_PROVIDER=local` + `reindex_memories`
  after (cursor-resumable) to control embedding cost/rate. Assign `scope`/`userId:"qp"` per D2.
- **Acceptance:** after migration, `recall` over known historical facts returns them; counts
  match importer dry-run; no secrets embedded (spot-check + rely on WP4/G2 redaction).
- **Tests / manual verification:** runbook includes a verification step (sample `recall` queries
  with expected hits). Ties into T5's gate dataset where overlap exists.

### T13 — Memory-ops observability per agent (S, OPTIONAL) — deps: T2 — GAPS G10 (low)

- **What (optional, non-blocking):** so qp can tell whether each agent actually uses Engram, add
  per-agent store/recall counters. Tag metrics by the authenticated `apiKeyId`/agent label.
- **Steps:** extend `MetricsService` (`apps/mcp-server/src/metrics`) with store/recall counters
  labeled by agent; expose on `/health/metrics`; document a dashboard query.
- **Acceptance:** metrics increment per agent on store/recall; documented.
- **Tests (service + wiring):** metrics service unit test for the counters; a wiring test that a
  `remember` call from a labeled key increments the right series on the scrape endpoint.

## Dependency graph

```
WP4 importers ───────────────┐            (external dep: ship WP4 first)
                             ▼
T1 Contract ──┬────────────► T6 Claude Code
              ├────────────► T7 Copilot
              ├────────────► T8 Cursor
              ├────────────► T9 Codex
              └────────────► T10 Gemini
T1 ─► T3 CLI ─┬────────────► T6 (hooks call CLI)
              ├────────────► T11 File-watcher ◄── WP4 importers
              └───(bridge used by T7 optional)
T2 Server ─┬─► T4 API keys ─► (T6..T10 consume keys), T12
           └─► T13 Observability (optional)
T5 Eval gate — independent (can run any time; overlaps T12 dataset)
T12 Migration ◄── WP4 importers + T4
```

- **Critical path:** WP4 importers → (T1, T2, T3) → per-agent T6–T10 in parallel → T11/T12.
- **Parallelizable now (no deps):** T1, T2, T3 (T3 needs T1 text only), T5.
- **Fully parallel once T1 (+T3 for T6):** T6, T7, T8, T9, T10 — different files, no shared edits.
- **WP4 coupling (concepts, per suite README:34-35):** T11 and T12 require WP4's importer code +
  provenance/dedup/idempotency model. If WP4 is not yet merged at execution, T11/T12 stub the
  importer call behind WP4's documented IR interface and are the _only_ tasks that must wait;
  everything else proceeds. Reference `docs/plans/2026-07-memory-platform/WP4-agent-memory-import/PLAN.md`.

## Risks & open questions

- **R1 — userId spoofing when auth is off (critical; GAPS G1).** With `streamable-http` +
  `AUTH_REQUIRED=false`, `userId` is client-controlled and any process reaching the port can
  read/write any tenant (`main.ts:98-118`). WP5 makes five agents hit one server, so this becomes
  live. **Mitigation (T4):** `AUTH_REQUIRED=true` + per-agent keys + loopback bind. Open: does qp
  want a single `userId:"qp"` shared by all agents (simplest; keys only separate provenance) or
  distinct userIds per agent (stronger isolation but hyphenated ids fail cuid2 — must use plain
  alphanumeric)? Recommendation: one `userId:"qp"`, per-agent keys for provenance/scoping.
- **R2 — Config-format drift (high).** Four of five clients' MCP config formats (`servers` vs
  `mcpServers`, `httpUrl` vs `url`, `[mcp_servers]`, `inputs`) change across versions; snippets
  are 🟡. **Mitigation:** every per-agent task runs its **Verify** block before writing final
  config; treat this plan's non-Claude snippets as drafts.
- **R3 — Automatic store distillation quality/cost (high).** L2 `capture` runs an LLM pass per
  session; a bad prompt stores noise, a good one costs tokens. **Mitigation:** rubric-driven
  prompt (D4), dedup server-side, cap facts/session, `EMBEDDING_PROVIDER` cache; make L2 opt-in
  per project if cost is a concern. Open: which model/provider for distillation (reuse
  `OPENAI_API_KEY` vs local)?
- **R4 — Best-effort recall for 4/5 agents (medium).** Only Claude Code is deterministic (D8).
  Copilot/Cursor/Codex/Gemini rely on instruction compliance; models may skip the recall call.
  **Mitigation:** strong, short directive block (T1); revisit if any client ships a real
  session/pre-prompt hook. Open: acceptable, or should WP5 gate on a client-native hook where one
  appears?
- **R5 — Native↔Engram divergence / loops (medium).** File-watcher writing to Engram while an
  agent writes native files could ping-pong or duplicate. **Mitigation:** D7 provenance +
  newest-wins + idempotency keys + debounce; the bridge never _writes back_ to native files
  (one-way sync into Engram). Open: is one-way (files→Engram) sufficient, or does qp want
  Engram→file export too (that is WP3's job — keep separate).
- **R6 — Secret/PII leakage into embeddings (high; GAPS G2).** Instruction files and transcripts
  contain secrets; `remember`/import embeds via OpenAI. **Mitigation:** D4 rubric hard-forbids
  secrets, CLI redaction pass, and dependence on WP4/G2 redaction stage. Open: block embedding
  (an `EMBEDDING`-exclusion flag) for sensitive memories — needs a small server change (out of
  WP5 scope; flag to WP4/G2).
- **R7 — Single-server reachability (medium; GAPS G9).** "Primary memory" assumes every agent can
  reach one server; loopback-only = per-machine silo. **Mitigation:** T2 documents loopback
  default; a hosted/TLS deployment (uptime, backup coverage of new tables) is ops/WP6. Open: does
  qp run agents on >1 machine (then a hosted endpoint + auth is required, not optional)?
- **R8 — Health/backup coverage of `mcp-remote` bridge dependency (low).** Stdio-only clients rely
  on `npx mcp-remote`; a network/npx failure silently drops MCP. **Mitigation:** pin/vendor the
  bridge; the CLI/hook exit-0 contract keeps the agent usable regardless.
- **R9 — Memory poisoning / prompt-injection via auto-capture + recall (HIGH; NEW — distinct from
  R6/G2).** WP5 auto-ingests transcripts (which contain untrusted tool outputs, fetched web
  content, file contents) through the L2 distillation pass, and T11 auto-imports files that may be
  attacker-controlled (a cloned repo's malicious `.cursorrules`/`CLAUDE.md`). Recall then
  auto-injects that stored text back into a later session's context — the classic agent-memory-
  poisoning vector: attacker-controlled text becomes a stored "fact" a future session recalls and
  _acts on as if trusted_. This is the **inbound/injection** direction; R6/G2 cover only outbound
  secret leakage. **Mitigation:** (a) recalled memories MUST be framed as untrusted **data, never
  instructions** (the server already has untrusted-content fencing for context tools — reuse it,
  `context.dto.ts` framing note); (b) record a `metadata.trust` level per source (first-party
  session vs imported-file vs web-derived); (c) a **human-review gate** for file-watcher imports
  originating from untrusted/cloned repos (do not auto-trust `project:<slug>` rules from a repo
  qp just cloned); (d) never let a recalled memory silently alter tool-permission/config. Open:
  where to enforce framing — CLI wrapper vs server-side on `recall` output.
- **R10 — Cross-agent scope-key misalignment (medium; NEW).** The shared store only actually
  shares if all five agents compute `project:<slug>` identically. If Claude Code uses
  `basename(cwd)` and Codex runs from a subdir, project recall silently fragments into disjoint
  scopes and each agent sees a partial memory. **Mitigation (D2/T1):** canonical slug =
  `basename(git rev-parse --show-toplevel)` lowercased, specified once in the Contract and used by
  every hook/CLI/directive; add a `scope`-consistency check to the verify scripts.
