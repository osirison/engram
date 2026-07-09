---
title: WP2 — Memory Management UI Plan
description: Implementation plan for the STM+LTM memory-management console (SHARED-2 + T1–T9)
---

# WP2 — Memory Management UI: Implementation Plan

> Suite conventions (worktree-per-task rebased on `origin/main`, conventional commits with
> body ≤300 chars, never `--no-verify`, tests at BOTH service and wiring level, Zod
> `.strict()` on all tool inputs, Postgres = source of truth, `userId: "qp"` in examples)
> live in [`../README.md`](../README.md) — this plan does not restate them. Read repo
> `CLAUDE.md` and `AGENTS.md` first. Cross-cutting gaps this WP must honor:
> [`../GAPS.md`](../GAPS.md) — **G1** (authz), **G4** (concurrent-writer safety, required
> here), **G5** (edit history / restore), **G12** (STM TTL), and WP2 items **A6–A10**.
> All paths below are relative to the repo root.

## Context

qp wants to manage memory items (list/view, edit, delete; search/filter/pagination as
supporting features) from the web UI. Exploration shows **a working v1 already exists** in
`apps/web` (Next.js 16 App Router + tRPC 11 + Prisma 7 + NextAuth v5): filterable list,
semantic search with keyword fallback, detail sheet with edit (content + tags) and single
delete with inline confirmation, all writes proxied to the MCP server. WP2 is therefore a
**gap-closing plan, not a green-field build**. The verified gaps:

1. **STM (Redis) memories are invisible** (GAPS A6): the UI lists from Postgres only; STM
   lives exclusively in Redis, so the "Short-term" type filter can never match a live item.
2. **No optimistic concurrency** (G4): qp's concurrent agents + the console can race on the
   same memory; updates are last-write-wins with no version check.
3. **No persistent audit trail / restore path** for destructive ops (G5, A7) — only
   transient log lines.
4. **No bulk operations** (multi-select delete).
5. **Offset pagination** breaks under concurrent inserts/deletes (skipped/duplicated rows).
6. **Silent vector drift on edit** (A9): when re-embedding fails during a content edit the
   old vector is kept with no flag and no in-UI repair.
7. **Coarse authz**: any allow-listed operator manages any tenant; nothing binds an
   operator to a set of userIds (G1 — WP2 mitigates, does not solve).
8. **Server-side blockers found during verification**: `get_memory` / `list_memories` /
   `promote_memory` are **not `delegable`**, so the console's admin API key is silently
   pinned to its own tenant for those tools; the `list_memories` tool **drops its `type`
   filter**; the web backend's `deleteMemory` **returns `{deleted: true}` unconditionally**
   (A10); `delete_memory`/`get_memory` return prose (not JSON) for some outcomes.

## Current state (verified file:line references)

### How apps/web talks to data today

- **Seam**: every tRPC procedure depends on the `EngramBackend` interface
  (`apps/web/server/backend/types.ts:207-222`; DTOs `:13-91`; `BackendError` `:225-238`;
  delegation model documented `:175-205`). Sole implementation `PrismaEngramBackend`
  (`apps/web/server/backend/prisma-backend.ts:106`), process-wide singleton
  (`apps/web/server/backend/index.ts:9-18`).
- **Reads go straight to Postgres** via `@prisma/client`: `listMemories`
  (`prisma-backend.ts:258-287`), `getMemory` (`:289-297`, **Postgres-only** — an STM id
  yields `null` → tRPC `NOT_FOUND` at `apps/web/server/trpc/routers/memory.ts:66-72`);
  `hasEmbedding` via `array_length(embedding,1)>0` raw SQL (`:250-256`). The web DB role
  is intended read-only (`WEB_DATABASE_URL`, `apps/web/server/env.ts:29-36`, #206).
- **Writes + semantic search go through the MCP server** over a lazy Streamable-HTTP
  session (`apps/web/server/backend/mcp-client.ts:20-108` — parses the **first text
  content item as JSON**, reconnects on transport failure). `updateMemory` → `update_memory`
  tool, then re-reads Postgres (`prisma-backend.ts:362-381`). `deleteMemory` →
  `delete_memory` but **returns `{deleted: true}` unconditionally**, ignoring the tool's
  not-found text (`:383-396`). `searchMemories` → `recall` with keyword-ILIKE fallback
  (`:303-356`). No `ENGRAM_MCP_URL` ⇒ writes throw `BackendError('WRITES_DISABLED')` and
  the UI disables Edit/Delete with a tooltip
  (`apps/web/components/memories/memory-detail-sheet.tsx:117-119, 344-367`).
- **tRPC wiring**: root router `apps/web/server/trpc/root.ts:9-14`
  (`memory`/`health`/`analytics`/`meta`); context = `{ session, backend }`
  (`apps/web/server/trpc/context.ts:15-21`); `protectedProcedure` only asserts a signed-in
  operator (`apps/web/server/trpc/trpc.ts:66-77`); `BackendError`→tRPC translation
  middleware (`trpc.ts:26-59`). Memory router procedures `list/get/search/update/delete`
  with Zod inputs (`apps/web/server/trpc/routers/memory.ts:9-46, 48-103`). Every input
  carries a **client-supplied `userId`** — never derived from the session.
- **Pagination is offset-based**: `cursor` is a stringified offset consumed by Prisma
  `skip` (`prisma-backend.ts:261, 269-272`), `nextCursor = String(offset + items.length)`
  (`:284`).

### Auth model

- **Web console**: NextAuth v5 JWT sessions, Google/GitHub OAuth + dev-only credentials
  (`apps/web/auth.ts:44-112`); sign-in gated by the `ENGRAM_ADMIN_EMAILS` allow-list
  (`auth.ts:72-89`), re-validated per request (`:97-99`); empty allow-list fails closed in
  production (`apps/web/server/env.ts:72-76`). `session.user.id` is the OAuth subject —
  **unrelated** to memory `userId`.
- **Operator = admin over all tenants**: the "viewing as" userId is a client-side switcher
  persisted in localStorage (`apps/web/components/user-scope.tsx:8-11, 18`); no tRPC-level
  restriction on which `userId` an operator may pass.
- **MCP server side**: tools declare `auth` / `requiredScope` / `delegable`
  (`packages/core/src/mcp/tools/index.ts:33-61`). The tenant boundary is the API key:
  `resolveActingUserId` (`index.ts:133-155`) pins identity tools to the verified tenant
  unless the tool is `delegable` **and** the principal holds the `admin` scope; delegated
  calls are logged (`:285-291`). Scope map: `update_memory`→`memories:write`,
  `delete_memory`→`memories:delete`, reads→`memories:read`
  (`apps/mcp-server/src/memory/memory.controller.ts:1273-1288`). **`MCP_ADMIN_TOKEN` gates
  only reindex/consolidate admin tools, not memory CRUD** (verified —
  `memory.controller.ts:1267-1272`); the real per-user controls are API-key scopes +
  delegation + the operator allow-list.
- **Delegable today**: `update_memory` (`memory.controller.ts:1102-1111`), `delete_memory`
  (`:1113-1122`), `recall` (`:1132-1139`) only. `get_memory` (`:1086-1092`),
  `list_memories` (`:1094-1100`), `promote_memory` (`:1124-1130`) are **not** — an admin
  key calling them for `userId: "qp"` is silently pinned back to the key's own tenant
  (delegation contract: `mcp-delegation-wiring.spec.ts`).
- **Capability surface**: the web backend probes `GET /auth/me` and reports
  `admin` / `tenant-limited` / `unrestricted` / `unknown` with a human `limitation`
  (`prisma-backend.ts:130-218`); UI gates writes on `meta.capabilities`
  (`memory-detail-sheet.tsx:50-51`).

### Memory tiers & CRUD

- **Prisma `Memory` model** (`prisma/schema.prisma:84-117`): `type` String
  (`'short-term' | 'long-term'`), `expiresAt DateTime?`, `embedding Float[]`,
  `embeddingVec Unsupported("vector(1536)")?`, `tags String[]`, `metadata Json?`,
  `scope String?`, `organizationId String?`. **No `version` column; no audit, revision, or
  soft-delete model anywhere in the schema** (verified across the file).
- **STM** (`packages/memory-stm/src/memory-stm.service.ts`): Redis-only JSON blobs with
  TTL — **no Postgres row, no vector-store entry** (the embedding, if generated, lives
  inside the Redis JSON, `:52-78`). `findById` bumps `accessCount`, preserves remaining TTL
  (`:97-144`). **`update` resets the expiry clock**: `newTtl = input.ttl ?? existing.ttl`,
  `expiresAt = now + newTtl`, `SET ... EX newTtl` (`:166-188`) — an edit silently restores
  the full TTL window (GAPS A8/G12). `delete` verifies scope by reading the payload first
  (`:197-234`). `list` uses Redis `SCAN` with the scan cursor as the pagination cursor and
  client-side tag/scope filtering (`:239-310`). `extendTtl` exists (`:337-364`), `getTtl`
  returns remaining seconds (`:315-332`).
- **LTM** (`packages/memory-ltm/src/memory-ltm.service.ts`): Postgres via Prisma. DI is
  heavily `@Optional()` — `EmbeddingsService`, `VectorStore` and friends may be absent
  (`:80-91`). `update` (`:311-415`): re-embeds when content changes, **non-fatal**
  (`.catch(() => null)`, `:345-353`) — on failure the old embedding is kept and, unless
  tags changed, the vector store is not touched (`:399-405`) → **stale vector, no marker**.
  `delete` (`:422-460`): `deleteMany` then best-effort `removeVector`. Vector upsert/delete
  are non-fatal by design (`indexVector` `:1325-1340`, `removeVector` `:1345-1354`) —
  **per-item vector failures never corrupt Postgres**. Vector payload holds only
  `userId/type/tags/createdAt/organizationId/scope`, not content (`:1631-1645`).
  `reindex` is cursor-resumable with per-item failures counted/skipped (`:1184-1292`).
- **Tier routing** (`apps/mcp-server/src/memory/memory.service.ts`): `getMemory` STM-then-
  LTM (`:360-399`); `updateMemory` STM-first then LTM (`:461-521`); `deleteMemory` tries
  **both** stores (`:526-567`); `promoteMemory` → `ltm.promote` (`:572-584`).
  `listMemories` (`:404-456`) **merges STM+LTM** by fetching `limit` from each,
  concatenating, sorting, slicing — the cursor applies only to LTM, so STM rows re-inject
  on every page (**do not build pagination on this merge**), and the `type` filter accepted
  by the tool schema (`apps/mcp-server/src/memory/dto/list-memories.dto.ts:4-14`) is
  **dropped** by the controller (`memory.controller.ts:242-251`).
- **Tool contracts**: registry `Tool = {name, description, inputSchema, handler, auth?,
requiredScope?, delegable?}` (`packages/core/src/mcp/tools/index.ts:33-61`); dispatch
  calls `tool.handler(validatedInput)` with **no actor context** (`:296-299`) — relevant to
  audit. `update_memory` input: `userId, memoryId, content?, metadata?, tags?, ttl?
(60..604800), scope?` — no version field
  (`apps/mcp-server/src/memory/dto/update-memory.dto.ts:4-22`); `metadata` is
  **full-replace** at this boundary. `delete_memory` reuses `getMemoryToolSchema`
  (`apps/mcp-server/src/memory/dto/get-memory.dto.ts`). Result shapes: `list_memories`
  returns parseable JSON `{memories, pagination}` (`memory.controller.ts:253-273`);
  `get_memory` returns JSON when found but the **plain string** `"Memory <id> not found"`
  when missing (`:202-211`); `delete_memory` returns prose either way (`:345-354`).

### UI components (existing conventions)

- Page `apps/web/app/(dashboard)/memories/page.tsx` → `MemoryNavigator`
  (`apps/web/components/memories/memory-navigator.tsx`): URL-synced filters (`:27-44,
61-76`), `useInfiniteQuery` list + `useQuery` semantic search (`:83-110`), "Load more"
  pager (`:211-222`). Detail sheet `memory-detail-sheet.tsx`: edit content+tags
  (`:71-76, 105-114`), **server-confirmed** mutations invalidating
  list/search/analytics/get caches (`:78-103`), inline delete confirm (`:279-303`),
  capability-gated buttons (`:320-368`); type badge + `expiresAt` row already render
  (`:138-141, 234-240`). List `memory-list.tsx` (**no multi-select**). Filters
  `apps/web/lib/memory-filters.ts` + `memory-filters.tsx`; tag editor `tag-input.tsx`;
  shadcn-style primitives under `apps/web/components/ui/` (dialog, sheet, table, sonner
  toasts; **no checkbox component yet**).
- Test conventions: router tests via `createCaller` over a mocked `EngramBackend`
  (`apps/web/server/trpc/routers/routers.test.ts:8-56`); component tests via Testing
  Library (`apps/web/components/memories/memory-list.test.tsx`); backend unit +
  DB-gated integration tests (`apps/web/server/backend/prisma-backend.test.ts`,
  `prisma-backend.integration.test.ts`). Server side: `memory.service.spec.ts`,
  `memory.controller.spec.ts`, and the delegation wiring spec
  `apps/mcp-server/src/memory/mcp-delegation-wiring.spec.ts`. Run with
  `pnpm --filter web test`, `pnpm --filter mcp-server test`.

## Goals / Non-goals

### Goals

1. STM (Redis) and LTM (Postgres) manageable side-by-side in one UI with tier-appropriate
   affordances (TTL countdown, near-expiry warning, promote to long-term).
2. Edit flow that keeps vectors consistent: re-embed on content change; visible staleness
   marker + one-click repair when re-embedding fails (EmbeddingsService is `@Optional()` —
   the UI must degrade gracefully when it is absent).
3. Delete flow where per-item vector failures never corrupt Postgres (already true at the
   store level — preserve and test end-to-end), and delete results are truthful (fix A10).
4. Optimistic concurrency for edits via a `version` compare-and-swap (G4 — **required**,
   not optional: qp's agents race the console on the same rows).
5. Persistent, queryable audit trail for update/delete/bulk-delete/promote/restore,
   attributing API key, delegation target, and web operator; restore path from delete
   snapshots (G5).
6. Bulk delete with per-item results and hardened confirmation UX.
7. Stable keyset pagination.
8. Proportionate authz: document the operator-console trust model, add optional
   per-operator tenant binding, and fail cross-tenant writes clearly under a
   `tenant-limited` key (G1 mitigation).

### Non-goals

- Creating memories from the UI (agents create; the console curates).
- Memory relationship/graph visualisation (WP3 territory — the metadata links written by
  duplicate/contradiction detection, `memory-ltm.service.ts:1531-1596`, stay raw JSON).
- Semantic search over STM (STM vectors are not indexed anywhere).
- Full per-agent/per-user authentication rework (G1 proper) — WP2 only mitigates.
- A `deletedAt` soft-delete column or `MemoryRevision` table (see D6/D12 rationale).
- Editing `scope` or `type` of an existing memory (scope is immutable by design,
  `update-memory.dto.ts:16-20`; tier changes go through promote).
- Org-level (`organizationId`) management.

## Design decisions (with rationale)

- **D1 — STM reads go through the MCP server, not Redis-from-web.** Preserves the
  dashboard's data rule (_Postgres reads direct, everything else via MCP_ —
  `types.ts:1-8`) and the read-only web DB posture (#206). Adding `ioredis` + STM key
  logic to `apps/web` would duplicate `StmKeyBuilder`/scope-isolation logic and widen the
  attack surface. STM listing uses the existing `list_memories` tool with a **working
  `type` filter** (fixed in T2) rather than a brand-new tool — smallest MCP surface;
  the buggy STM+LTM merge is bypassed because a typed call queries exactly one tier.
- **D2 — Fix delegation + structured tool results as in-WP server work.** `get_memory`,
  `list_memories`, `promote_memory` gain `delegable: true` (same rationale as
  `update_memory`, `memory.controller.ts:1105-1107`, #200) — without this every STM read
  from the console silently targets the wrong tenant. `get_memory` (not-found) and
  `delete_memory` (both outcomes) start returning **structured JSON** as the first text
  item so the web client (`mcp-client.ts:85-107`) stops string-matching prose, which also
  fixes the web backend's unconditional `{deleted: true}` (A10).
- **D3 — STM is a separate live data source, never interleaved into the Postgres page.**
  Merging a Redis SCAN stream into a keyset Postgres page gives unstable ordering and
  double-counting (see the broken service merge, `memory.service.ts:404-456`).
  UI: `type=short-term` switches the list to the STM source (SCAN cursor passthrough,
  client-side sort by `expiresAt`); `type=long-term`/`all` keep the Postgres list, with a
  compact "Live short-term" strip above the list on `all` so STM is visible by default.
- **D4 — STM TTL on edit: store semantics unchanged; the console defaults to preserving
  the remaining TTL.** Verified behavior: saving resets `expiresAt` to a full window
  (`memory-stm.service.ts:166-188`). Changing the store would silently alter agent
  workflows that rely on edit-refreshes-TTL (rejected — behavior-change risk). Instead the
  edit form pre-fills its TTL field with the **remaining** seconds (min-clamped to 60) so
  a console save keeps roughly the current expiry, shows "Saving sets a new expiry window
  from now", and offers explicit **Extend TTL** and **Promote to long-term** affordances.
  Near-expiry (<15 min) items get a warning badge. This answers G12/A8 for the UI without
  touching agent-facing semantics.
- **D5 — Optimistic concurrency via an integer `version` column, enforced in the stores
  (G4, required).** `updatedAt` CAS was rejected: it is `@updatedAt`-managed, ISO-
  serialised across two hops (precision risk), and STM rewrites it on every `findById`
  access bump. `version` increments only on real updates. LTM: add
  `version: expectedVersion` to the update `where` (`memory-ltm.service.ts:378-385`) +
  `version: { increment: 1 }`. STM: compare the payload `version` after `findById`
  (read-compare-set; the race window is milliseconds on TTL-bounded data — documented,
  Lua CAS deferred). Conflict → typed error → tool message prefixed `CONFLICT:` →
  `BackendError('CONFLICT')` → tRPC `CONFLICT` (409) → UI conflict panel.
  `expectedVersion` is **optional** in the tool schema so existing agent callers keep
  last-write-wins.
- **D6 — Audit is a Postgres table written by the mcp-server layer; actor comes from the
  dispatch; restore comes from delete snapshots.** Auditing in `apps/web` would miss every
  agent-originated mutation and break the read-only web DB role (A7). The core dispatch is
  the only place that knows the verified principal + delegation decision
  (`packages/core/src/mcp/tools/index.ts:276-292`), so `Tool.handler` gains an optional
  second parameter `ToolCallContext` (backward-compatible). The console additionally sends
  an `actorLabel` (operator email, injected server-side in tRPC — never trusted from the
  browser); it is stored as a display label only. The `before` snapshot on delete rows
  powers a `restore_memory` tool (G5's restore path) — cheaper than a `deletedAt` column,
  which would force every `where` clause (list/count/recall/dedup/quota) to exclude
  soft-deleted rows and complicate vector cleanup.
- **D7 — Server-confirmed edits, optimistic single-delete with rollback.** Edits stay
  server-confirmed (current behavior, `memory-detail-sheet.tsx:87-94`): D5 conflicts and
  re-embedding state must surface before the cache lies to the operator. Single deletes
  become optimistic (`onMutate` cache eviction, `onError` restore + toast) — no conflict
  semantics, large UX win. Bulk delete is server-confirmed with a per-item report
  (partial failure is the expected case there).
- **D8 — Keyset pagination.** Cursor becomes opaque base64 JSON `{v: <sortValue>, id}`
  applied as a direction-aware `(sortField, id)` comparison, replacing `skip`. Offset
  cursors skip/duplicate rows under qp's concurrent-agent churn. `totalCount` stays a
  separate `count()` (existing pattern `prisma-backend.ts:265-274`). The cursor is already
  opaque to the client (`routers/memory.ts:21`), so no UI contract change.
- **D9 — Bulk delete is one MCP tool call, not a client-side fan-out.** A fan-out of N
  `delete_memory` calls was rejected: the MCP path is rate-limited/cost-accounted
  (`apps/mcp-server/src/auth/mcp-rate-limit.middleware.ts`,
  `apps/mcp-server/src/auth/tool-call-cost.ts`), N round-trips are slow over Streamable
  HTTP, and partial-failure aggregation belongs server-side. New `bulk_delete_memories`
  tool (`memoryIds` ≤100, `memories:delete`, `delegable`) loops
  `MemoryService.deleteMemory` with bounded concurrency so STM/LTM routing, scope
  isolation, and non-fatal vector cleanup are inherited; per-item failures never abort the
  batch and never touch rows that failed only at the vector layer.
- **D10 — Embedding staleness is a first-class flag.** On a content edit whose re-embed
  fails, set `metadata.embeddingStale = true` in the same update; clear it whenever an
  embedding is successfully written. UI shows "Vector stale" plus a **Re-embed** action
  backed by a new `reembed_memory` tool (`memories:write`, delegable) that regenerates the
  embedding for current content and upserts the vector **without bumping `version`**
  (re-sending identical content through `update_memory` would trip D5 conflicts for other
  writers). Full-user rebuilds remain the existing admin reindex tools.
- **D11 — Authz: keep the operator-console trust model; add an optional tenant binding and
  honest tenant-limited failures.** Verified: `MCP_ADMIN_TOKEN` is unrelated to memory
  CRUD; controls are the operator email allow-list (web) + API-key scopes/delegation (MCP).
  WP2 adds: (a) `ENGRAM_OPERATOR_TENANTS` (`alice@x.com:qp|ci-bot;bob@x.com:*`) enforced
  server-side by `assertCanManageUser` on every userId-taking tRPC procedure — unset ⇒
  current behavior, so qp's single-operator setup stays zero-config; (b) when
  `capabilities().delegation === 'tenant-limited'` and the target `userId ≠ keyTenant`,
  mutations fail fast with the `limitation` text instead of a confusing downstream
  not-found (A10); (c) a documented security-model note. The audit trail (D6) is the
  detective control either way. Full per-agent auth remains G1.
- **D12 — No `MemoryRevision` table.** Audit rows carry `before`/`after` snapshots
  (content, tags, metadata, version), giving edit history + delete recovery in one model.
  Revisit only if in-UI point-in-time restore of _edits_ becomes a requirement.

## Schema changes

### SHARED-2: `memory-version-audit` schema + migration (shared prerequisite)

> **Serialize with other WPs' Prisma migrations** (WP3/WP4 also touch the schema — suite
> README dependency graph). Everything else in WP2 can be developed in parallel and merged
> after this lands. G4 names this the shared schema task consumed by WP2 and WP4.

Modify `prisma/schema.prisma`:

1. Add to `model Memory` (after `type`, `prisma/schema.prisma:92`):

   ```prisma
   version   Int      @default(1)   // optimistic-concurrency counter; bumped on every update
   ```

2. New append-only model (no FK to `Memory` — rows must survive hard deletes):

   ```prisma
   model MemoryAudit {
     id             String   @id @default(cuid(2))
     memoryId       String
     userId         String   // data owner (tenant)
     organizationId String?
     scope          String?
     action         String   // 'update' | 'delete' | 'bulk-delete' | 'promote' | 'reembed' | 'restore'
     actorType      String   // 'api-key' | 'anonymous' | 'system'
     actorId        String?  // ApiKey.id when actorType = 'api-key'
     actorLabel     String?  @db.VarChar(256) // untrusted display label (e.g. operator email)
     delegated      Boolean  @default(false)  // admin key acting on another tenant
     before         Json?    // pre-image: { content, tags, metadata, type, scope, expiresAt, version }
     after          Json?    // post-image (null for delete; { deleted: bool } for delete outcomes)
     createdAt      DateTime @default(now())

     @@index([memoryId])
     @@index([userId, createdAt])
     @@map("memory_audits")
   }
   ```

STM needs no migration: its `version` lives in the Redis JSON payload (absent ⇒ treated
as 1). No backfill: `version` defaults to 1 for existing rows.

Task card below (**SHARED-2** — per the suite registry in `../README.md`:
SHARED-1 is the `MemoryLink` model, canonical in `../SHARED-1-memory-link.md`; this
version/audit task is SHARED-2).

## Work breakdown

Every task is self-contained: read `../README.md` (conventions) and this file's Current
state (grounding), then touch only the listed files. Register any new MCP tool in
`MemoryController.getMcpTools()` (`apps/mcp-server/src/memory/memory.controller.ts:1075`)
and its scope in the `scopeByTool` map (`:1273-1288`). Quality gate before commit:
`pnpm build && pnpm lint && pnpm typecheck && pnpm test`.

---

### SHARED-2 — `memory-version-audit` schema + migration

- **Description**: Add `Memory.version` and `MemoryAudit` exactly as in "Schema changes";
  regenerate the Prisma client; create the dev migration.
- **Files**: modify `prisma/schema.prisma`; generated
  `prisma/migrations/<ts>_memory_version_and_audit/migration.sql`.
- **Implementation steps**:
  1. Edit the schema per the section above.
  2. `pnpm db:generate`, then `pnpm db:migrate` against local docker Postgres
     (`pnpm docker:up` first; image must be `pgvector/pgvector:pg16+`, per `CLAUDE.md`).
  3. Verify the SQL adds NOT NULL `version` default 1 and `memory_audits` with both
     indexes; no destructive statements.
  4. Check raw-SQL surfaces that touch `memories`
     (`apps/web/server/backend/prisma-backend.ts:252, 549, 558, 594, 605`) — none use
     `SELECT *`, so no changes; note this in the PR body.
- **Acceptance criteria**: migration applies cleanly on a fresh DB (`pnpm db:reset`) and
  on a DB with existing rows; `prisma.memory.findFirst()` exposes `version: 1`;
  `prisma.memoryAudit.create()` round-trips.
- **Tests**: _(service)_ integration assertion in
  `packages/memory-ltm/src/memory-ltm.integration.spec.ts` that a created memory has
  `version 1`; _(wiring)_ `apps/web/server/backend/prisma-backend.integration.test.ts`
  passes unchanged (guards the raw-SQL surface).
- **Size**: S. **Depends-on**: none. **Merge first** (serialized with other WPs' migrations).

---

### T1 — Keyset pagination for the dashboard list

- **Description**: Replace the offset cursor in `PrismaEngramBackend.listMemories` with a
  direction-aware keyset cursor (D8).
- **Files**: create `apps/web/server/backend/cursor.ts`; modify
  `apps/web/server/backend/prisma-backend.ts` (`listMemories` `:258-287`) and
  `apps/web/server/backend/prisma-backend.test.ts`.
- **Implementation steps**:
  1. `cursor.ts`: `encodeCursor({v, id})` → base64url JSON; `decodeCursor(s)` → `null` on
     any parse error (treat as first page — never throw on user input);
     `keysetWhere(sortBy, sortOrder, cursor)` → Prisma `OR` clause: for `desc`
     `[{[sortBy]: {lt: v}}, {[sortBy]: v, id: {lt: id}}]` (asc: `gt`). Serialise Date
     sort values as epoch ms.
  2. `listMemories`: drop `skip`; AND the keyset clause into `buildWhere` output; add `id`
     as orderBy tiebreak (`orderBy: [{[sortBy]: sortOrder}, {id: sortOrder}]`);
     `take: limit + 1` to compute `hasMore`; `nextCursor` from the last returned row.
     Keep `totalCount` from the existing `count()`.
  3. Legacy numeric cursors (`"25"`) decode to `null` → first page; stale tabs self-heal.
     Bump the router's cursor max length if needed (`routers/memory.ts:21`).
- **Acceptance criteria**: walking 3+ pages while rows are inserted/deleted between
  fetches never skips or duplicates an item; tRPC `memory.list` contract unchanged.
- **Tests**: _(service)_ `cursor.ts` unit tests (round-trip, tamper, direction) + mocked-
  Prisma assertions on generated `where`/`orderBy`/`take` in `prisma-backend.test.ts`;
  _(wiring)_ `prisma-backend.integration.test.ts`: seed 60 rows with duplicate
  `createdAt`s, walk asc+desc, delete a row mid-walk, assert no gaps/dupes;
  `routers.test.ts` list case stays green.
- **Size**: M. **Depends-on**: none.

---

### T2 — STM read path: delegation fixes, type filter, structured results, backend source

- **Description**: Make STM reachable and tool results machine-readable (D1/D2): mark
  `get_memory`/`list_memories`/`promote_memory` delegable; honor the `type` filter
  end-to-end; return structured JSON from `get_memory` (not-found) and `delete_memory`;
  add `EngramBackend.listStmMemories()` + an MCP fallback in `getMemory`; fix the web
  backend's unconditional `{deleted: true}` (A10).
- **Files**:
  - Modify `apps/mcp-server/src/memory/memory.controller.ts` (tool defs `:1086-1130`;
    `listMemories` handler `:231-278`; `getMemory` not-found `:202-211`; `deleteMemory`
    result `:345-354`), `apps/mcp-server/src/memory/memory.service.ts` (`listMemories`
    `:404-456` + `ListMemoryOptions` type).
  - Modify `apps/web/server/backend/types.ts` (DTO + interface),
    `apps/web/server/backend/prisma-backend.ts` (new method, `getMemory` fallback,
    `deleteMemory` result parsing), `apps/web/server/trpc/routers/memory.ts` (`listStm`
    procedure; `delete` maps `{deleted:false}` → `NOT_FOUND`).
- **Implementation steps**:
  1. Add `delegable: true` with a `#200`-style comment to `get_memory`, `list_memories`,
     `promote_memory`.
  2. `MemoryService.listMemories`: accept `type?: 'short-term' | 'long-term'`; when
     `'short-term'` query STM only (pass through the Redis SCAN cursor + tags/scope); when
     `'long-term'` LTM only; undefined keeps today's merge. Controller passes
     `validatedInput.type` (currently dropped at `:242-251`).
  3. Structured results: `get_memory` not-found → first text item
     `{"found": false, "memoryId": ...}`; `delete_memory` → `{"deleted": true|false,
"memoryId": ...}`. Keep a human sentence as a **second** content item (the web client
     parses only the first — `mcp-client.ts:85-107`). Update prose-asserting specs
     (`apps/mcp-server/src/memory/memory.controller.spec.ts`; grep other consumers —
     `packages/client`, `apps/vscode-copilot-compressor`).
  4. `MemoryDTO`: add `ttlSeconds: number | null`, `accessCount: number | null` (null for
     LTM). New `listStmMemories({userId, scope?, tags?, limit, cursor?})` on the backend:
     call `list_memories` with `type: 'short-term'`, map `StmMemory` JSON to `MemoryDTO`
     (`hasEmbedding` false — STM is never vector-indexed), return `{items, totalCount,
nextCursor (SCAN cursor, null when '0'), hasMore, unavailableReason?}` — when
     `this.mcp` is null return empty with `unavailableReason` (STM view degrades, no error).
  5. `getMemory`: on Postgres miss with MCP configured, call `get_memory`; `found:false`
     ⇒ null; else map (STM items carry `expiresAt`/`ttl`).
  6. `deleteMemory` (`prisma-backend.ts:383-396`): parse the JSON result; return the real
     `{deleted}`; router maps false → `NOT_FOUND`.
  7. tRPC `memory.listStm` protected procedure (`.strict()` input, limit 1-100 default 25).
- **Acceptance criteria**: with the mcp-server running and an admin-scoped
  `ENGRAM_API_KEY`, `memory.listStm({userId: "qp"})` returns qp's live Redis STM items
  (not the key tenant's); `memory.get` on an STM id returns it with
  `expiresAt`/`ttlSeconds`; `list_memories(type:'long-term')` excludes STM; deleting an
  already-gone memory surfaces `NOT_FOUND` (no false success); MCP unconfigured ⇒
  `listStm` returns empty + `unavailableReason` and `get` stays Postgres-only.
- **Tests**: _(service)_ `apps/mcp-server/src/memory/memory.service.spec.ts` — type-filter
  routing (STM-only path never calls `ltm.list`, and vice versa);
  `prisma-backend.test.ts` — `listStmMemories` mapping, `getMemory` fallback (found /
  `found:false` / legacy-prose), `deleteMemory` not-found parsing. _(wiring)_ extend
  `apps/mcp-server/src/memory/mcp-delegation-wiring.spec.ts` — the three tools are
  delegable and an admin principal's explicit `userId` is honoured;
  `memory.controller.spec.ts` — structured result shapes; web `routers.test.ts` —
  `listStm` delegation + unauthenticated rejection + delete `NOT_FOUND` mapping.
- **Size**: L. **Depends-on**: none.

---

### T3 — STM UI: live tier view, TTL affordances, promote

- **Description**: Surface STM per D3/D4: `type=short-term` switches the list source;
  "Live short-term" strip on `type=all`; countdown + near-expiry badges; TTL field in the
  edit form (pre-filled with **remaining** TTL); Extend-TTL and Promote actions.
- **Files**:
  - Modify `apps/web/components/memories/memory-navigator.tsx`, `memory-list.tsx`,
    `memory-detail-sheet.tsx`, `apps/web/lib/memory-filters.ts` (relabel "All
    (persisted)"), `apps/web/lib/format.ts` (add `formatCountdown`).
  - Create `apps/web/components/memories/stm-strip.tsx`, `expiry-badge.tsx`.
  - Modify `apps/web/server/backend/types.ts` + `prisma-backend.ts` +
    `apps/web/server/trpc/routers/memory.ts`: `promoteMemory` backend method →
    `promote_memory` tool; `memory.promote` mutation; `updateInput` gains
    `ttl: z.number().int().min(60).max(604800).optional()`
    (mirror `update-memory.dto.ts:15`) threaded to `update_memory`.
- **Implementation steps**:
  1. Navigator: when `filters.type === 'short-term'` and not searching, use
     `trpc.memory.listStm.useInfiniteQuery` (cursor = SCAN cursor); hide sort + date-range
     controls with a tooltip (SCAN order is undefined — sort client-side by `expiresAt`
     asc). When `type === 'all'`, render `<StmStrip userId={userId} />` above the list:
     `listStm` with `limit: 10`, `refetchInterval: 30_000`, "view all" link that sets
     `type=short-term`.
  2. `expiry-badge.tsx`: relative countdown from `expiresAt`; `<15 min` ⇒ destructive
     "Expiring soon" variant; ticks every 30s. Pure formatting lives in `lib/format.ts`.
  3. Detail sheet (STM items): TTL row (`ttlSeconds`) + expiry badge; edit mode adds a
     numeric "TTL (seconds)" input **defaulting to remaining TTL** (from
     `expiresAt - now`, clamped ≥60) with helper text "Saving sets a new expiry window
     from now" (D4); footer gains **Extend TTL** (+1h quick action → `memory.update` with
     `ttl = remaining + 3600`) and **Promote to long-term** (→ `memory.promote`, toast,
     invalidate `listStm`+`list`+`analytics`). Embedding row shows "n/a (live tier)"
     instead of "Not indexed" (`memory-detail-sheet.tsx:225-227`).
- **Acceptance criteria**: an STM memory created via MCP (`create_memory`,
  `type: 'short-term'`, `userId: "qp"`) appears in the strip within one refetch interval,
  opens with a live countdown, edits with TTL preserved-by-default (assert new
  `expiresAt ≈ old remaining`), extends, promotes (moves to LTM list, leaves strip), and
  deletes; with `ENGRAM_MCP_URL` unset the page still works (strip hidden, short-term tab
  shows the `unavailableReason` empty state).
- **Tests**: _(service/component)_ `formatCountdown` + `expiry-badge` unit tests;
  `stm-strip` Testing Library test (items, near-expiry variant, empty state); detail-sheet
  test for TTL field default/visibility (STM only) and promote/extend buttons. _(wiring)_
  `routers.test.ts` promote + ttl-threading cases; `prisma-backend.test.ts`
  `promoteMemory` tool-args assertion; navigator test that `type=short-term` switches
  query source (mock tRPC per `memory-list.test.tsx` patterns).
- **Size**: L. **Depends-on**: T2.

---

### T4 — Optimistic concurrency for edits (version CAS)

- **Description**: Thread `expectedVersion` from UI to both stores; bump `version` on
  every update; surface conflicts as tRPC `CONFLICT` with a reload-and-rediff UX (D5, G4).
- **Files**:
  - Modify `packages/memory-ltm/src/types.ts` (`LtmMemory.version`,
    `LtmVersionConflictError`), `packages/memory-ltm/src/memory-ltm.service.ts`
    (`update` `:311-415`, `mapToLtmMemory` `:1650-1660`).
  - Modify `packages/memory-stm/src/types.ts` (`StmMemory.version`,
    `StmVersionConflictError`), `packages/memory-stm/src/memory-stm.service.ts`
    (`create` `:63-78`, `update` `:149-192`, `deserializeStmMemory` `:519-527`).
  - Modify `apps/mcp-server/src/memory/dto/update-memory.dto.ts`
    (`expectedVersion: z.coerce.number().int().min(1).optional()`),
    `apps/mcp-server/src/memory/memory.service.ts` (`updateMemory` `:461-521`
    pass-through), `apps/mcp-server/src/memory/memory.controller.ts` (`updateMemory`
    `:284-322` — map conflicts to messages prefixed `CONFLICT:`; follow the pattern in
    `apps/mcp-server/src/security/client-error.util.ts`, read it first).
  - Modify `apps/web/server/backend/types.ts` (`MemoryDTO.version`,
    `UpdateMemoryParams.expectedVersion?`, `BackendError` code union + `'CONFLICT'`),
    `prisma-backend.ts` (`memorySelect`, `mapRow`, update `:362-381` — detect the
    `CONFLICT:` prefix and throw `BackendError(..., 'CONFLICT')`),
    `apps/web/server/trpc/trpc.ts` (`toTRPCError` `:26-46` + `'CONFLICT'` mapping),
    `apps/web/server/trpc/routers/memory.ts` (input + pass-through),
    `apps/web/components/memories/memory-detail-sheet.tsx` (send
    `expectedVersion: data.version`; on `CONFLICT` show an inline alert with "Reload
    latest" that refetches `memory.get`, re-seeds the draft, and preserves the operator's
    unsaved text in a collapsible block).
- **Implementation steps**:
  1. LTM: select `version`; when `expectedVersion` provided add it to `updateWhere`
     (`:378-385`); always `version: { increment: 1 }`. A non-matching where throws Prisma
     `P2025` — catch, re-fetch via `findRawMemory`: row exists at another version ⇒
     `LtmVersionConflictError(memoryId, currentVersion)`; else keep
     `LtmMemoryNotFoundError`.
  2. STM: stamp `version: 1` on create; on update, conflict when `expectedVersion` is set
     and ≠ `(existing.version ?? 1)`; write `version + 1`. Document the read-compare-set
     window (D5).
  3. mcp-server: pass `expectedVersion` through `UpdateMemoryDto`; conflicts serialise as
     `CONFLICT: memory <id> was modified (currentVersion=N)`. Deletes stay version-free by
     design.
  4. Web: as listed; `mapRow` gains `version` (client regenerated by SHARED-2).
- **Acceptance criteria**: two callers read version 3; A updates with `expectedVersion: 3`
  → success, version 4, vector reflects A's content; B updates with stale 3 → tRPC
  `CONFLICT`, Postgres unchanged by B; omitting `expectedVersion` keeps last-write-wins
  for legacy agents; the conflict panel shows latest content and preserves B's draft.
- **Tests**: _(service)_ `packages/memory-ltm/src/memory-ltm.service.spec.ts` — CAS
  success / stale-conflict (P2025→conflict when the row exists, not-found when it
  doesn't) / increment-always / no-expectedVersion bypass;
  `packages/memory-stm/src/memory-stm.service.spec.ts` — same matrix + version stamping +
  legacy payloads without `version`. _(wiring)_ `memory.service.spec.ts` or a wiring spec
  following `mcp-delegation-wiring.spec.ts` bootstrap — `update_memory` with
  `expectedVersion` reaches the store and a conflict yields a `CONFLICT:`-prefixed tool
  error; web `routers.test.ts` — `BackendError('CONFLICT')` surfaces `code: 'CONFLICT'`;
  detail-sheet component test for the conflict panel.
- **Size**: L. **Depends-on**: SHARED-2.

---

### T5 — Persistent audit trail + restore

- **Description**: Record update/delete/bulk-delete/promote/reembed in `memory_audits`
  with verified actor + delegation facts (D6); add `restore_memory` from delete snapshots
  (G5); expose history + restore in the UI.
- **Files**:
  - Modify `packages/core/src/mcp/tools/index.ts` — define + export `ToolCallContext
{ actorUserId?, apiKeyId?, scopes?, delegated? }`; build it where delegation is
    decided (`:276-292`); call `tool.handler(validatedInput, context)` (`:296-299`;
    handler type gains an optional 2nd arg — backward-compatible).
  - Create `apps/mcp-server/src/memory/memory-audit.service.ts` (+ provider in
    `apps/mcp-server/src/memory/memory.module.ts`).
  - Modify `apps/mcp-server/src/memory/memory.controller.ts` — mutating handlers
    (`updateMemory` `:284-322`, `deleteMemory` `:328-359`, `promoteMemory` `:365+`, plus
    T6/T7 tools) accept the context, snapshot `before` via `memoryService.getMemory`,
    call the audit service; add tools `restore_memory` (`memories:write`, delegable) and
    `get_memory_audit` (`memories:read`, delegable) with strict DTOs in
    `apps/mcp-server/src/memory/dto/`.
  - Modify mutating tool input DTOs (`dto/update-memory.dto.ts`, delete/bulk/reembed
    DTOs) — optional `actorLabel: z.string().max(256).optional()`.
  - Modify `packages/memory-ltm/src/memory-ltm.service.ts` +
    `apps/mcp-server/src/memory/memory.service.ts` — `restoreMemory` support: allow an
    explicit `id` in `CreateLtmMemoryData`/`createRowWithQuota`
    (`memory-ltm.service.ts:803-842`) so restore preserves the original id; re-embed +
    `indexVector` on restore.
  - Modify `apps/web/server/backend/types.ts` + `prisma-backend.ts` — send `actorLabel`
    on mutations; `listMemoryAudit(userId, memoryId, limit)` reads Postgres directly
    (read path stays Prisma); `restoreMemory(userId, memoryId)` → `restore_memory` tool.
  - Modify `apps/web/server/trpc/routers/memory.ts` — `auditLog` query + `restore`
    mutation; inject `ctx.session.user.email` as `actorLabel` **server-side** (override
    anything client-sent); `memory-detail-sheet.tsx` — collapsible "History" section
    (action, relative time, actor, delegated badge, expandable before/after) with a
    Restore button on delete entries.
- **Implementation steps**:
  1. Core context param (step above) — check `packages/core/src/mcp/tools/index.spec.ts`,
     `dispatch-auth.spec.ts`, `mcp.handler.spec.ts` for arity assumptions.
  2. `MemoryAuditService.record(entry)`: `prisma.memoryAudit.create`, try/catch-log —
     **never throws, never blocks the mutation**. For deletes: fetch `before` first, then
     delete, then record with `after: { deleted }` (attempts are recorded even when the
     delete reports not-found).
  3. `actorType = context?.apiKeyId ? 'api-key' : 'anonymous'`; `delegated` from context.
  4. Restore: rebuild the row from the newest `'delete'` audit `before` (preserved id,
     content, tags, metadata, scope; LTM only — an STM snapshot restores as STM via
     `stm.create` with a fresh default TTL); write a `'restore'` audit row.
- **Acceptance criteria**: a console edit writes an `update` row with
  `actorType 'api-key'`, `delegated: true` (admin key acting for qp), operator email in
  `actorLabel`, correct before/after; a delete row's `before.content` equals the deleted
  content; audit-write failure (mocked) does not fail the mutation; direct agent calls
  (no actorLabel) produce rows with `actorLabel: null`; Restore recreates the memory under
  its original id with a rebuilt vector and shows up in the list; History renders in the
  sheet.
- **Tests**: _(service)_ `memory-audit.service.spec.ts` (payload mapping, swallow
  failure); `dispatch-auth.spec.ts` — context passed with `delegated`/`apiKeyId`, absent
  when unauthenticated; `memory-ltm.service.spec.ts` — create-with-explicit-id.
  _(wiring)_ `memory.controller.spec.ts` / a wiring spec — `update_memory`/`delete_memory`
  produce audit rows carrying the dispatch's delegation facts; `restore_memory` round-trip;
  web `routers.test.ts` — mutations inject the session email as `actorLabel` and
  `auditLog`/`restore` delegate; detail-sheet history/restore component test.
- **Size**: L. **Depends-on**: SHARED-2.

---

### T6 — Bulk delete (multi-select + `bulk_delete_memories` tool)

- **Description**: Multi-select in the list; one MCP call with per-item results (D9);
  hardened confirmation (D7).
- **Files**:
  - Create `apps/mcp-server/src/memory/dto/bulk-delete.dto.ts` —
    `{ userId, memoryIds: z.array(memoryIdSchema).min(1).max(100), scope?, actorLabel? }`
    `.strict()`.
  - Modify `apps/mcp-server/src/memory/memory.service.ts` — `bulkDeleteMemories(userId,
ids, scope?)` looping `deleteMemory` with bounded concurrency (reuse `runConcurrent`
    `:1228-1244`); collect `{deleted: string[], failed: {id, reason}[]}`; not-found ⇒
    `failed` with reason `'not-found'`; never abort the batch.
  - Modify `apps/mcp-server/src/memory/memory.controller.ts` — handler + tool def
    (`requiredScope: 'memories:delete'`, `delegable: true`, JSON result) + `scopeByTool`.
  - Modify `apps/web/server/backend/types.ts` + `prisma-backend.ts`
    (`bulkDeleteMemories` → tool call, parse JSON), `apps/web/server/trpc/routers/memory.ts`
    (`bulkDelete` mutation, ids ≤100).
  - Create `apps/web/components/ui/checkbox.tsx` (shadcn checkbox — none exists today)
    and `apps/web/components/memories/bulk-delete-dialog.tsx` (uses `ui/dialog.tsx`).
  - Modify `memory-list.tsx` (selection checkboxes + select-page header) and
    `memory-navigator.tsx` (selection state + "Delete N selected" action bar).
- **Implementation steps**:
  1. Server tool + service (single JSON text item so the web client parses directly).
     Vector cleanup stays per-item/non-fatal inside `ltm.delete` — an id whose Postgres
     row deleted but whose vector removal failed **must still count as `deleted`**
     (Postgres is truth); assert in tests.
  2. Audit each deleted id with `action: 'bulk-delete'` via `@Optional()` injection of
     `MemoryAuditService` so T5/T6 can merge in either order.
  3. UI: selection survives paging within loaded pages; dialog shows count + first 5
     truncated contents; require typing `delete` when N > 10; completion toast
     "Deleted X of N" with an expandable failure list; invalidate
     list/listStm/search/analytics; exit selection mode.
- **Acceptance criteria**: selecting across two loaded pages deletes in one MCP call;
  mixed STM+LTM selections work (tier routing inherited); a mocked vector-store outage
  still deletes Postgres rows and reports them `deleted`; per-item not-found lands in
  `failed` without aborting; >100 selection blocked client-side with a hint.
- **Tests**: _(service)_ `memory.service.spec.ts` — partial failures, concurrency cap,
  STM+LTM mix, vector-failure-still-deleted; DTO bounds spec. _(wiring)_
  tool-registration assertions (name/scope/delegable — extend the existing tool-list
  checks near `mcp-delegation-wiring.spec.ts`); web `routers.test.ts` bulkDelete
  delegation + cap; `bulk-delete-dialog` component test (type-to-confirm gate, failure
  list).
- **Size**: L. **Depends-on**: SHARED-2 (audit hook is optional-injected — see step 2).

---

### T7 — Re-embedding integrity on edit (`embeddingStale` + `reembed_memory`)

- **Description**: Stop silent content/vector drift (D10, A9): flag failed re-embeds,
  surface the flag, add a repair action that does not disturb `version`.
- **Files**:
  - Modify `packages/memory-ltm/src/memory-ltm.service.ts` — `update` (`:344-353,
355-373, 397-405`) + new public `reembed(userId, memoryId, organizationId?, scope?)`.
  - Create `apps/mcp-server/src/memory/dto/reembed.dto.ts` (getMemory shape +
    `actorLabel?`); modify `memory.controller.ts` (tool `reembed_memory`,
    `memories:write`, delegable) and `memory.service.ts` (pass-through; STM ids return a
    clear error — STM has no vector index).
  - Modify `apps/web/server/backend/types.ts` (`MemoryDTO.embeddingStale`),
    `prisma-backend.ts` (`mapRow` derives from `metadata.embeddingStale === true`;
    `reembedMemory` method), `routers/memory.ts` (`reembed` mutation),
    `memory-detail-sheet.tsx` (Embedding row: `Indexed` / `Stale — content changed but
vector didn't` / `Not indexed`, plus a Re-embed button for the last two).
- **Implementation steps**:
  1. LTM `update`: when content changed and embedding generation returned null, merge
     `embeddingStale: true` into the metadata written in the same Prisma update (extend
     the metadata-resolution block `:355-373`); clear the flag whenever generation
     succeeds. Scope the flag strictly to "embedding column stale vs content" — an
     `indexVector` throw already leaves a correct embedding in Postgres and is
     rebuildable by reindex (document in JSDoc).
  2. `reembed`: load row → `embeddingsService.generate(content)`; on success write
     `embedding` + cleared flag via a targeted update (**no `version` bump**; `updatedAt`
     bumping is acceptable) → `indexVector`. Absent provider / generation failure ⇒ typed
     error mapped to "embedding provider unavailable".
  3. UI: mutation with toasts; invalidate `memory.get` + list.
- **Acceptance criteria**: with `EMBEDDING_PROVIDER=disabled`, editing content marks the
  memory stale and the sheet shows it; with `local` provider, Re-embed clears the flag,
  `hasEmbedding` true, `vectorStore.upsert` called with the new vector; reembed does not
  change `version` (no spurious T4 conflicts); reembed of an STM id fails with the clear
  error.
- **Tests**: _(service)_ `memory-ltm.service.spec.ts` — flag set on failed re-embed /
  cleared on success; `reembed` happy, absent-provider, vector-throw paths; version
  untouched. _(wiring)_ tool registration + handler spec (scope, delegable, error
  mapping) in `memory.controller.spec.ts`; web `routers.test.ts` reembed delegation;
  detail-sheet stale-badge/button component test.
- **Size**: M. **Depends-on**: none (if T4 is already merged, the no-version-bump
  property is load-bearing — it is in the acceptance criteria).

---

### T8 — Optimistic delete UX + cache surgery

- **Description**: Make single deletes optimistic with rollback (D7); edits stay
  server-confirmed. Purely client-side.
- **Files**: modify `apps/web/components/memories/memory-detail-sheet.tsx` (`remove`
  mutation `:96-103`).
- **Implementation steps**:
  1. `onMutate`: cancel outgoing `memory.list`/`memory.listStm`/`memory.search` queries,
     snapshot caches, remove the item from cached infinite pages
     (`utils.memory.list.setInfiniteData`), close the sheet immediately. `onError`:
     restore snapshot + error toast. `onSettled`: invalidate as today (`:78-85`).
  2. Keep the inline confirm step (`:279-303`) — optimism applies after confirmation.
     Accurate rollback for the not-found case relies on T2's truthful `{deleted}` result.
- **Acceptance criteria**: confirmed delete removes the row instantly; a forced backend
  failure restores it with a toast; totals refresh after settle.
- **Tests**: _(service/component)_ detail-sheet test simulating success + failure (mocked
  tRPC) asserting cache eviction/restore — follow `memory-list.test.tsx` setup.
  _(wiring)_ `routers.test.ts` delete path unchanged (regression guard).
- **Size**: S. **Depends-on**: T2 (truthful delete result); rebase after T6 if both touch
  the sheet.

---

### T9 — Proportionate authz: operator→tenant binding + honest tenant-limited failures

- **Description**: Bind operators to tenants (optional, D11), fail cross-tenant writes
  clearly under a `tenant-limited` key (A10), document the security model.
- **Files**:
  - Modify `apps/web/server/env.ts` — parse `ENGRAM_OPERATOR_TENANTS`
    (`email:tenant1|tenant2;email2:*`) → `Map<string, string[] | '*'>`, defensive on
    malformed segments.
  - Modify `apps/web/server/trpc/trpc.ts` — export `assertCanManageUser(session, userId)`
    (unset map or `'*'` ⇒ allow; else membership or `FORBIDDEN`).
  - Modify `apps/web/server/trpc/routers/memory.ts` — guard every userId-taking procedure
    (list/listStm/get/search/update/delete/bulkDelete/promote/reembed/auditLog/restore) —
    and `apps/web/server/trpc/routers/analytics.ts` (read it first; same guard on its
    userId-taking procedures).
  - Modify `apps/web/server/backend/prisma-backend.ts` — in
    `updateMemory`/`deleteMemory`/`bulkDeleteMemories`/`promoteMemory`, when
    `capabilities().delegation === 'tenant-limited'` and target `userId !== keyTenant`,
    throw `BackendError(limitation, 'WRITES_DISABLED')` pre-flight instead of a confusing
    downstream not-found.
  - Modify `apps/web/server/trpc/routers/meta.ts` (read it first) — `allowedTenants`
    query (`'*'` or list); `apps/web/components/layout/scope-switcher.tsx` — filter the
    owner list client-side (server remains the enforcement point);
    `apps/web/app/(dashboard)/settings/page.tsx` — surface binding + delegation
    `limitation`; `apps/web/README.md` — a short "Security model" note (allow-listed
    operators are full admins over whatever the API key reaches; `userId` is a data-owner
    selector honoured only under an admin key or auth-disabled server; per-operator
    scoping is this binding; full per-agent auth is G1).
- **Acceptance criteria**: env unset ⇒ behavior unchanged; with `op@example.com:qp` the
  operator manages `qp` but gets `FORBIDDEN` for `other` even via a crafted tRPC call
  (server-side enforcement), and the switcher offers only `qp`; under a `tenant-limited`
  key, cross-tenant destructive actions fail fast with the `limitation` text and the UI
  shows the blocked-tooltip pattern (`memory-detail-sheet.tsx:320-368`).
- **Tests**: _(service)_ env-parser cases in `apps/web/server/env.test.ts` (exists);
  `assertCanManageUser` unit tests; `prisma-backend.test.ts` tenant-limited pre-flight
  block. _(wiring)_ `routers.test.ts` allowed/forbidden matrix across memory + analytics
  procedures with a bound session.
- **Size**: M. **Depends-on**: functionally none, but it guards procedures added by
  T2/T5/T6/T7 — **land last** (or guard existing procedures first and extend as others
  merge).

## Dependency graph

```
SHARED-2 (schema, merge first, serialized with other WPs) ──┬─▶ T4 (version CAS)
                                                            ├─▶ T5 (audit + restore)
                                                            └─▶ T6 (bulk delete; audit hook optional-injected)

T2 (STM read path + structured results) ──┬─▶ T3 (STM UI)
                                          └─▶ T8 (optimistic delete — needs truthful {deleted})

Independent from the start: SHARED-2, T1 (keyset), T2, T7 (re-embed)
Land last: T9 (guards every procedure incl. those added by T2/T5/T6/T7)
```

- **Parallel lanes** (one worktree each): {SHARED-2 → T4}, {SHARED-2 → T5},
  {SHARED-2 → T6}, {T2 → T3 → T8}, {T1}, {T7}; T9 last.
- **Merge-conflict hotspots**: `memory-detail-sheet.tsx` (T3, T4, T5, T7, T8) and
  `apps/web/server/trpc/routers/memory.ts` (T2, T4, T5, T6, T7, T9) — additive sections,
  rebase in depends-on order.
- **Critical path**: SHARED-2 → T5 (audit + restore is the largest new capability);
  T2 → T3 is comparable and fully parallel to it.
- **Max parallelism at kickoff**: SHARED-2 + T1 + T2 + T7 by four agents.

## Risks & open questions

1. **`Tool.handler` signature change (T5)** touches `packages/core` used by every tool.
   Optional-arg backward-compatible, but specs that assert handler arity or mock
   `registerTools` internals must be checked
   (`packages/core/src/mcp/tools/index.spec.ts`, `dispatch-auth.spec.ts`,
   `packages/core/src/mcp/mcp.handler.spec.ts`).
2. **Structured tool-result changes (T2) are visible to agent callers** that parsed the
   prose from `get_memory`/`delete_memory`. Grep consumers (`packages/client`,
   `apps/vscode-copilot-compressor`, docs) before merging; the human sentence stays as a
   second content item.
3. **STM listing rides Redis SCAN** — non-deterministic cursors, approximate counts,
   possibly short pages. The UI treats the STM view as a live snapshot, not a stable
   ledger (D3); a large STM set would need a secondary index (out of scope; cap the strip
   at 10 and the tab page at `limit`).
4. **Version CAS on STM is read-compare-set**, not atomic — a true CAS needs a Lua script
   in `packages/redis` (deferred; window is milliseconds on TTL-bounded data; documented
   in code, T4 step 2).
5. **`update_memory.metadata` is full-replace** at the tool boundary
   (`update-memory.dto.ts:13`; merge exists only as LTM-internal `metadataMerge`,
   `memory-ltm.service.ts:355-361`). The UI keeps metadata view-only, and T7's flag is
   written server-side, so there is no corruption path — but any future metadata-editing
   UI must add a merge-patch input. **Open question for qp: should the UI edit metadata?**
6. **Edit during an embeddings outage still serves stale recall** until re-embed/reindex —
   T7 makes it visible and repairable, not automatic. Open question: auto-queue a targeted
   re-embed on stale-mark? (Auto risks embedding-cost spikes — G7; manual chosen.)
7. **Delegation probe caching**: `capabilities()` caches for 60s
   (`prisma-backend.ts:127, 172-183`) — after rotating `ENGRAM_API_KEY` the UI may show
   stale write availability for up to a minute. Accepted; noted in Settings copy (T9).
8. **Two Prisma clients** (web reads via `WEB_DATABASE_URL`; mcp-server writes): the
   post-update re-read (`prisma-backend.ts:376-380`) assumes one Postgres instance; a
   read replica would show skew. Assumption documented; no replica support planned.
9. **Audit rows record attempts** (delete audit is written around the destructive call
   with `after: {deleted}`) — audit can over-report attempts but never under-reports
   successes. Accepted trade-off (T5 step 2).
10. **Restore semantics** (T5): restore preserves the original id, so an id-keyed vector
    upsert is idempotent — but a memory re-created _after_ another memory reused links to
    it (dedup/supersede metadata) may resurrect stale relationships. Accepted for now;
    WP3's relationship work should treat audit restores as new events.
11. **`memory_audits` retention**: no pruning planned; fine at qp's scale. Follow-up cron
    could reuse the decay/consolidation scheduler patterns
    (`apps/mcp-server/src/memory/decay.service.ts`).
12. **Open question — STM strip refresh interval** (30s chosen to keep countdowns honest
    without hammering the MCP server): make configurable if multiple operators run the
    console concurrently.
