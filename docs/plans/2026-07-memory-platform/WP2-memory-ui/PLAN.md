# WP2 — Memory Management UI (Implementation Plan)

> Conventions (worktree-per-task rebased on `origin/main`, conventional commits ≤300-char
> body, never `--no-verify`, tests at BOTH service and wiring level, Postgres = source of
> truth, `userId: "qp"` in examples) live in `../README.md`. This plan does not restate them.
> Cross-cutting gaps this WP must honor: `../GAPS.md` — **G1** (authz), **G4** (concurrency),
> **G5** (edit history / soft delete), **G12** (STM TTL).

## Context

qp wants to view / edit / delete memories from the web UI, with search, filtering, and
pagination as supporting features. **A working memory-management UI already exists** in
`apps/web` (Next.js 15 App Router + tRPC v11 + NextAuth v5 + Prisma). List, detail, edit
(content + tags), single delete with inline confirm, semantic search with keyword fallback,
tag/type/scope/date filters, and offset pagination are all implemented and tested.

Therefore WP2 is **"harden + complete the delta,"** not greenfield. This plan targets only
what is missing or subtly broken against the task's required coverage: STM (Redis) vs LTM
(Postgres) in one UI, re-embedding + vector sync on edit, vector cleanup on delete, authz,
audit trail for destructive ops, bulk operations, optimistic-vs-confirmed UX, and
confirmation UX. Parts that already work are cited in **Current state** and left alone.

## Current state (verified)

Data flow: `apps/web` never writes Postgres directly. It reads Postgres for
list/get/analytics and **proxies all writes + semantic recall to the MCP server** over an
MCP Streamable-HTTP session. The seam is the `EngramBackend` interface.

- **Backend seam** — `apps/web/server/backend/types.ts:207-222` (`EngramBackend`), DTOs at
  `:13-91`, `BackendError` at `:225-238`. Delegation model documented at `:175-205`
  (`admin` / `tenant-limited` / `unrestricted` / `unknown`).
- **Prisma backend** — `apps/web/server/backend/prisma-backend.ts`.
  - `listMemories` reads Postgres directly, **offset cursor** (`parseInt`), `+1`-less
    `count`+`findMany` (`:258-287`).
  - `getMemory` Postgres-direct (`:289-297`); `hasEmbedding` derived from
    `array_length(embedding,1)>0` (`:250-256`).
  - `searchMemories` calls MCP `recall`, hydrates rows from Postgres, falls back to keyword
    `listMemories` when MCP is absent/unreachable (`:303-356`).
  - `updateMemory` → MCP `update_memory`, then re-reads via `getMemory` (`:362-381`).
  - `deleteMemory` → MCP `delete_memory`, **returns `{deleted:true}` unconditionally**,
    ignoring the tool's not-found text (`:383-396`). ← correctness gap.
  - `capabilities()` probes `/auth/me` for the key's scopes → delegation mode (`:130-218`).
- **MCP tool client** — `apps/web/server/backend/mcp-client.ts` (lazy Streamable-HTTP
  session, reconnect on failure).
- **Backend singleton / factory** — `apps/web/server/backend/index.ts:9-18`
  (`mcpUrl`, `mcpApiKey` from env).
- **tRPC memory router** — `apps/web/server/trpc/routers/memory.ts`: `list/get/search`
  (queries) + `update/delete` (mutations). Zod inputs `:9-46`. Every input carries
  `userId` **taken from the request**, not the session.
- **tRPC plumbing** — `apps/web/server/trpc/trpc.ts`: `protectedProcedure` only asserts a
  signed-in operator (`:66-76`); `BackendError→TRPCError` middleware (`:53-59`).
  Context builds session + singleton backend (`server/trpc/context.ts:15-21`).
- **Auth** — `apps/web/auth.ts`: NextAuth JWT, Google/GitHub/dev-credentials, sign-in gated
  by `ENGRAM_ADMIN_EMAILS` allow-list (`:71-101`). `session.user.id` = OAuth subject,
  **unrelated** to memory `userId`. Env at `apps/web/server/env.ts`: `defaultUserId`
  (`:52`), `adminEmails` (`:49`), `isAllowedOperator` open-outside-prod (`:72-76`),
  web DB is intended read-only (`:34-36`, #206).
- **UI** — `app/(dashboard)/memories/page.tsx` → `components/memories/memory-navigator.tsx`
  (URL-synced filters, `useInfiniteQuery` for list, `useQuery` for search, `Load more`
  pager `:211-222`). Detail/edit/delete: `components/memories/memory-detail-sheet.tsx`
  (edit content+tags `:175-206`, inline delete confirm `:279-303`, write-disabled tooltip
  via `capabilities.writes` `:50-51,320-368`). List: `memory-list.tsx` (**no multi-select**).
  Filters: `memory-filters.tsx`. Tests: `memory-list.test.tsx`, `states.test.tsx`,
  `lib/memory-filters.test.ts`.

MCP server (write authority):

- **MemoryService** — `apps/mcp-server/src/memory/memory.service.ts`. `getMemory` tries STM
  then LTM (`:360-399`); `updateMemory` routes STM-first then LTM (`:461-521`); `deleteMemory`
  tries **both** stores (`:526-567`). `listMemories` **merges STM+LTM** by fetching `limit`
  from each, concatenating, slicing — **cursor applies only to LTM**, so STM rows re-inject
  on every page (`:404-456`). ← do not build pagination on this.
- **Tools** — `apps/mcp-server/src/memory/memory.controller.ts`: `list_memories` (`:1094`),
  `update_memory` (`:1102`), `delete_memory` (`:1113`, reuses `getMemoryToolSchema`,
  returns plain text not JSON `:325-360`), `recall` (`:1132`). Required scopes:
  `update_memory`→`memories:write`, `delete_memory`→`memories:delete` (`:1275-1279`).
- **Delegation (#200)** — identity-mode tools opt into delegation: an **admin-scoped** key
  honors a client-supplied `userId`; a **non-admin** key has its `userId` overwritten
  (pinned) to the key's own tenant (`mcp-delegation-wiring.spec.ts:119-156`). When the
  server runs with auth disabled, the supplied `userId` is trusted as-is.
- **LTM service** — `packages/memory-ltm/src/memory-ltm.service.ts`.
  - `update` **re-embeds on content change** (non-fatal; keeps old embedding on failure)
    and re-indexes the vector when a new embedding exists **or** tags change (`:311-415`,
    esp. `:344-405`). Content edit while embeddings are null/failing ⇒ **vector stays
    stale** until a reindex.
  - `delete` `deleteMany` then **best-effort vector removal** (non-fatal) (`:422-460`,
    `removeVector` `:1345-1354`). Postgres-as-truth honored.
  - `reindex` cursor-resumable, per-item failures counted/skipped (`:1184-1287`).
- **STM service** — `packages/memory-stm/src/memory-stm.service.ts`. Redis-only; **no
  Postgres row, no vector-store entry**. `update` **resets `expiresAt` to a full TTL** on
  every edit (`:166-181`). `delete` removes the Redis key (`:197-234`). `list` via SCAN
  (`:239-310`). ← **STM memories never appear in the Postgres-direct UI list today.**
- **Schema** — `prisma/schema.prisma:84-117` (`Memory`): `type 'short-term'|'long-term'`,
  `expiresAt`, `embedding Float[]`, `embeddingVec vector(1536)`. **No audit / revision /
  soft-delete / version column exists** (verified across the schema).

### The three concrete gaps that follow from the above

1. **STM is invisible.** The UI list/get read Postgres, where STM rows do not exist. The
   type filter offers `short-term`, but it can only ever return LTM rows mislabeled or
   nothing. Writes would route correctly (STM-first) _if_ an STM id ever surfaced — it can't.
2. **No audit trail** for edit/delete, and delete is a hard delete. Agent-originated deletes
   (multiple agents per `../GAPS.md`) are invisible and unrecoverable.
3. **No operator→data-owner authorization** and **no bulk operations**; delete is
   server-confirmed only; edit-under-embedding-outage silently desyncs the vector.

## Goals / Non-goals

**Goals**

- Surface STM (Redis) alongside LTM (Postgres) in one UI, correctly labeled, with edit/delete.
- Guarantee vector-store sync semantics on edit/delete are correct and _visible_ (embedding
  stale/pending signal); no per-item vector failure corrupts Postgres.
- Add an append-only **audit trail** for destructive ops (update + delete), written on the
  server (covers console **and** agent operations), readable in the UI.
- Add **bulk delete** (and bulk tag as a stretch) with partial-failure UX and strong
  confirmation.
- Define **optimistic-vs-server-confirmed** behavior explicitly (optimistic delete; edit
  stays server-confirmed because re-embedding is server-side).
- Harden authz _proportionately_: document the admin-console model, disable cross-tenant
  destructive ops when the key is `tenant-limited`, and flag the `userId`-trust risk (G1).
- Answer the **G12/TTL** question for STM edits explicitly.

**Non-goals** (push to the referenced gap / a later WP; **WP2 must not depend on them**)

- Full per-agent/per-user authentication & scopes (G1) — WP2 only flags + gates.
- Optimistic-concurrency version columns / idempotency keys (G4) — noted as risk; an
  _optional_ SHARED task only.
- Memory lifecycle (dedup/decay/contradiction, G3), export history (G6), embedding cost
  controls on bulk (G7) — out of scope; T4 must stay within existing rate limits.

## Design decisions (with rationale)

- **D1 — STM as a separate, un-paginated group; never interleaved.** LTM keeps its correct
  Postgres-direct paginated path; STM is fetched once per view from the MCP server and shown
  as its own labeled section. Rationale: `MemoryService.listMemories`'s merge cursor is
  broken for STM (see Current state); STM sets are small and ephemeral, so pagination is
  unnecessary. Avoids importing a known bug into the UI.
- **D2 — Audit is written server-side in `memory-ltm`/mcp-server, read-only in the UI.**
  Rationale: the web DB role is intended read-only (#206) and, decisively, only the MCP
  server observes agent-originated destructive ops. Auditing at the UI would break the
  read-only posture _and_ miss every non-console delete. The UI gains a new tRPC **read**
  query backed by a new MCP read tool.
- **D3 — Soft-delete via audit snapshot, not a `deletedAt` column (default).** Keep hard
  delete (so vector cleanup / quota / dedup stay simple) but snapshot the full row into the
  audit table before deletion, enabling a **restore** path. Rationale: minimal schema
  surface, no rewrite of every `where` clause to exclude soft-deleted rows, and it satisfies
  G5's "restore path + queryable trail." (Open question in Risks weighs the `deletedAt`
  alternative.)
- **D4 — Optimistic delete, server-confirmed edit.** Delete removes the row from the list
  cache immediately and rolls back on error (fast, reversible via audit). Edit waits for the
  server round-trip because content changes trigger server-side re-embedding + re-index
  whose result (new `updatedAt`, embedding state) the UI must reflect truthfully.
- **D5 — G12/TTL on STM edit: preserve remaining TTL, offer explicit "extend."** Change STM
  edit so a content/tag edit keeps the _remaining_ TTL rather than resetting to a full TTL
  (current behavior silently prolongs STM), and expose a distinct "Extend TTL" affordance +
  a live countdown in the detail sheet. Rationale: editing a nearly-expired note should not
  silently make it near-permanent; make lifetime changes intentional and visible.
- **D6 — Proportionate authz.** Reuse `capabilities.delegation`/`limitation` (already
  surfaced): when mode is `tenant-limited`, disable cross-tenant destructive actions in the
  UI and label why; the real fix (per-operator scoping) is G1's prerequisite. Document that
  the operator allow-list makes every signed-in operator a full admin over whatever the API
  key can reach.
- **D7 — Bulk delete = client-side fan-out with `Promise.allSettled`.** Mirror the existing
  `forget` pattern (`memory.service.ts:710-719`); no new bulk MCP tool. Rationale: keeps the
  MCP surface small, gives per-item success/failure, and each delete still audits + cleans
  its vector individually. Cap selection size to bound embedding/DB load (G7 boundary).

## Schema changes

### SHARED-2: `MemoryAuditLog` table + migration (shared prerequisite)

> **Serialize with other WPs' Prisma migrations** (WP3/WP4 also touch schema — see
> `../README.md` dependency graph). Everything else in WP2 runs in parallel once this lands.

Add an append-only audit model to `prisma/schema.prisma`. Written by the server on every
destructive op; the pre-image `snapshot` powers restore.

```prisma
model MemoryAuditLog {
  id             String   @id @default(cuid(2))
  memoryId       String                       // not an FK: survives hard delete of the memory
  userId         String                       // data owner
  organizationId String?
  scope          String?
  action         String                       // 'update' | 'delete' | 'restore' | 'bulk-delete'
  actor          String                       // e.g. 'console:<operatorEmail>' | 'agent:<scope>' | 'system'
  actorType      String                       // 'operator' | 'agent' | 'system'
  snapshot       Json                          // full pre-image (content, tags, metadata, type, expiresAt…)
  diff           Json?                         // optional {before,after} for updates
  createdAt      DateTime @default(now())

  @@index([memoryId])
  @@index([userId, createdAt])
  @@map("memory_audit_log")
}
```

- Steps: edit `prisma/schema.prisma`; `pnpm db:generate`; `pnpm db:migrate` (dev migration
  named `add_memory_audit_log`). Add the new table to the nightly backup/restore
  verification set (per `../GAPS.md` G9).
- Acceptance: `pnpm db:generate` succeeds; migration applies cleanly on a fresh DB;
  `prisma.memoryAuditLog` is typed in `@engram/database`.
- Tests: a migration/round-trip check (create → query by `memoryId`) in
  `packages/database` (or `memory-ltm.integration.spec.ts`).
- Size: **S**. Depends-on: none.

## Work breakdown

Each task is self-contained. Executor reads `../README.md` for conventions, this file's
Current-state for grounding, then touches only the listed files.

---

### T1 — Surface STM memories in the UI as a separate group (STM vs LTM)

**Description.** Give the UI a read path to Redis STM and render STM as its own labeled,
un-paginated section above/below the paginated LTM list (D1). Edit/delete already route
STM-first through `update_memory`/`delete_memory`, so only the read/display seam is new.

**Files.**

- Modify `apps/web/server/backend/types.ts` — add `listStmMemories(userId: string, scope?: string): Promise<{ items: MemoryDTO[]; count: number }>` to `EngramBackend`.
- Modify `apps/web/server/backend/prisma-backend.ts` — implement via a new MCP call. Prefer
  a **dedicated** MCP tool `list_stm_memories` (thin wrapper over `stmService.list`, strict
  Zod `{ userId, scope?, limit? }`) added in `apps/mcp-server/src/memory/memory.controller.ts`
  - registration; fall back to calling `list_memories` and filtering `type==='short-term'`
    only if a new tool is rejected in review. Map STM rows through the existing `mapRow`
    shape (STM has no `embedding` in Postgres ⇒ `hasEmbedding:false`).
- Modify `apps/web/server/trpc/routers/memory.ts` — add `listStm` query (strict input `{ userId, scope? }`).
- Modify `apps/web/components/memories/memory-navigator.tsx` — fetch STM group when
  `filters.type` is `all`/`short-term`; render a labeled "Short-term (expiring)" section
  with per-item TTL countdown; suppress STM when `type==='long-term'`.
- Modify `apps/web/components/memories/memory-list.tsx` — accept an optional group
  label/`tier` badge.

**Implementation steps.**

1. Add the STM MCP read tool (strict schema, scope-aware) + register it; it must respect the
   same delegation contract as other identity-mode tools (userId pinned for non-admin keys).
2. Add `listStmMemories` to the backend interface + `PrismaEngramBackend`; return empty group
   (not an error) when MCP is unconfigured/unreachable, matching `searchMemories` resilience.
3. Add the tRPC `listStm` query.
4. Render STM as a distinct section; disable "Load more" for it; show TTL via `expiresAt`.

**Acceptance criteria.**

- With STM data present, the memories page shows STM items in a labeled group with a
  visible expiry/countdown; LTM pagination is unaffected.
- Opening an STM item's detail sheet and editing/deleting it succeeds (routes STM-first).
- MCP unconfigured/unreachable ⇒ STM group renders empty, no page error.
- STM group is hidden when the type filter is `long-term`.

**Tests (both levels).**

- Service: extend `apps/web/server/backend/prisma-backend.test.ts` — `listStmMemories`
  success, MCP-absent empty, delegation-pinned userId. If a new MCP tool is added, extend
  `apps/mcp-server/src/memory/memory.controller.spec.ts` + a delegation assertion in
  `mcp-delegation-wiring.spec.ts`; and `packages/memory-stm/src/memory-stm.service.spec.ts`
  for the list shape it relies on.
- Wiring/UI: extend `apps/web/server/trpc/routers/routers.test.ts` (`listStm`) and
  `apps/web/components/memories/memory-list.test.tsx` (STM group renders + TTL badge).

**Size:** M. **Depends-on:** none (independent of SHARED-2).

---

### T2 — Server-side audit write on update + delete (+ MCP read tool)

**Description.** Write a `MemoryAuditLog` row every time a memory is updated or deleted, in
the LTM/STM service paths so **both** console and agent operations are captured (D2).
Snapshot the pre-image for restore (D3). Expose a read tool for T3.

**Files.**

- Modify `packages/memory-ltm/src/memory-ltm.service.ts` — in `update` capture the pre-image
  before the row update and write a `'update'` audit row (with `{before,after}` diff); in
  `delete` capture the full row before `deleteMany` and write a `'delete'` audit row with the
  snapshot. Non-fatal: audit failure must be logged, not abort the op (Postgres-as-truth).
- Modify `packages/memory-stm/src/memory-stm.service.ts` — same for STM `update`/`delete`
  (snapshot the Redis payload).
- Add an `actor`/`actorType` param threaded from the tool layer
  (`apps/mcp-server/src/memory/memory.service.ts` + `memory.controller.ts`), defaulting to
  `agent`/`system` when not a console call. (Console actor identity arrives via T7.)
- Add MCP tool `get_memory_audit` (strict Zod `{ userId, memoryId?, limit?, cursor? }`,
  scope `memories:read`) in `memory.controller.ts` + registration; service method
  `listAuditLog` in `memory-ltm` (Postgres query).
- Add a restore path: `restore_memory` tool (scope `memories:write`) that re-creates a
  memory from a `'delete'` snapshot and writes a `'restore'` audit row.

**Implementation steps.**

1. Introduce a small `AuditWriter` (inject `PrismaService`) used by both services, or a
   method on `memory-ltm` reused by STM, to keep the write in one place.
2. Thread `actor`/`actorType` through `update_memory`/`delete_memory` handlers (default
   `agent`); T7 overrides with `console:<email>` for dashboard calls.
3. Implement `listAuditLog` (keyset by `createdAt,id`) and `restore`.

**Acceptance criteria.**

- Every successful update/delete (STM or LTM, console or agent) yields exactly one audit row
  with correct `action`, `actor`, and a complete `snapshot`.
- An audit-write failure is logged and does **not** fail or roll back the user's operation.
- `restore_memory` recreates a deleted memory's content/tags/metadata and re-indexes its
  vector (LTM), writing a `'restore'` row.

**Tests (both levels).**

- Service: extend `packages/memory-ltm/src/memory-ltm.service.spec.ts` (update+delete write
  audit; audit failure non-fatal; restore round-trips) and
  `packages/memory-stm/src/memory-stm.service.spec.ts` (STM audit).
- Wiring: extend `apps/mcp-server/src/memory/memory.service.spec.ts` +
  `memory.controller.spec.ts` (`get_memory_audit`/`restore_memory` tools; actor propagation)
  and a `mcp-delegation-wiring.spec.ts` assertion for the new tools' scopes.

**Size:** L. **Depends-on:** SHARED-2.

---

### T3 — Audit-trail read UI (history + restore)

**Description.** Show a memory's audit history in the detail sheet and offer restore for a
deleted memory (D2/D3), backed by a tRPC read query over the T2 tools.

**Files.**

- Modify `apps/web/server/backend/types.ts` — `listAuditLog(userId, memoryId?, cursor?)` +
  `restoreMemory(userId, auditId|memoryId)` on `EngramBackend`; add `AuditEntryDTO`.
- Modify `apps/web/server/backend/prisma-backend.ts` — implement via `get_memory_audit` /
  `restore_memory` MCP calls.
- Modify `apps/web/server/trpc/routers/memory.ts` — `audit` query + `restore` mutation.
- Modify `apps/web/components/memories/memory-detail-sheet.tsx` — add a "History" section
  (actor, action, timestamp, diff summary); a "Restore" action when viewing a delete entry.
- Optional: a small recent-destructive-ops feed on `app/(dashboard)/page.tsx`.

**Acceptance criteria.**

- Detail sheet lists audit entries newest-first with actor + action + relative time.
- Restoring a deleted memory repopulates the list and toasts success; invalidates
  list/search/analytics caches (reuse `invalidate()` in the sheet, `:78-85`).
- Audit query returns empty (not error) when the MCP server is unconfigured.

**Tests (both levels).**

- Service: extend `apps/web/server/backend/prisma-backend.test.ts` (`listAuditLog`/`restoreMemory`).
- Wiring/UI: extend `apps/web/server/trpc/routers/routers.test.ts` (`audit`/`restore`) and a
  new `memory-detail-sheet.test.tsx` (history renders; restore calls mutation).

**Size:** M. **Depends-on:** T2.

---

### T4 — Bulk operations + confirmation UX

**Description.** Add multi-select to the list and bulk delete (bulk add/remove-tag as a
stretch) via client-side `Promise.allSettled` fan-out (D7), with a strong confirmation
dialog and per-item partial-failure reporting.

**Files.**

- Add `apps/web/components/ui/checkbox.tsx` (shadcn Checkbox; not present today).
- Modify `apps/web/components/memories/memory-list.tsx` — selection checkboxes, "select all
  on page," a selection action bar.
- Modify `apps/web/components/memories/memory-navigator.tsx` — hold selection state; wire the
  bulk bar; clear selection after completion.
- Add `apps/web/components/memories/bulk-delete-dialog.tsx` — a `Dialog` (component exists,
  `ui/dialog.tsx`) requiring explicit confirm (show count; for large N require typing the
  count). Reuse it to replace the ad-hoc inline single-delete confirm for consistency.
- Modify `apps/web/server/trpc/routers/memory.ts` — a `bulkDelete` mutation accepting
  `{ userId, memoryIds[] (max N), scope? }` that fans out `deleteMemory` with
  `Promise.allSettled`, returning `{ deleted, failed: {id,reason}[] }`. (Keep it in the
  router/backend, not a new MCP tool.)
- Modify `apps/web/server/backend/prisma-backend.ts` — `bulkDeleteMemories` fan-out helper.

**Implementation steps.**

1. Add Checkbox; add selection state (Set of ids) scoped to the current result set.
2. Cap `memoryIds` (e.g. ≤100) in the Zod schema to bound load (G7 boundary).
3. Fan out with `Promise.allSettled`; surface a summary toast ("Deleted 47, 3 failed") and a
   detail list of failures; do not close on partial failure.
4. Each delete still audits + cleans its vector individually (via T2 / existing LTM delete).

**Acceptance criteria.**

- Selecting rows and confirming deletes them; a partial failure leaves failed rows selected
  and reports which failed and why.
- Large-N delete requires the stronger typed confirmation.
- Selection clears on success; caches invalidated once.

**Tests (both levels).**

- Service: extend `apps/web/server/backend/prisma-backend.test.ts` (`bulkDeleteMemories`
  success + partial-failure aggregation).
- Wiring/UI: extend `routers.test.ts` (`bulkDelete` shape + cap enforcement) and
  `memory-list.test.tsx` (selection + bulk bar); a `bulk-delete-dialog.test.tsx`.

**Size:** L. **Depends-on:** none for the fan-out (works today); audit rows require T2 to be
merged for the destructive-op trail to be complete (soft dependency, not a build blocker).

---

### T5 — Optimistic delete + delete-result correctness

**Description.** Make single + bulk delete optimistic with rollback (D4), and fix
`deleteMemory` to report real not-found instead of always `{deleted:true}`.

**Files.**

- Modify `apps/web/server/backend/prisma-backend.ts:383-396` — parse the `delete_memory`
  tool result; return `{ deleted: false }` (and let the router map to `NOT_FOUND`) when the
  memory was not found. (Tool returns text "…not found"; detect it, or switch the tool to a
  JSON `{deleted}` payload in `memory.controller.ts` and parse that.)
- Modify `apps/web/components/memories/memory-detail-sheet.tsx` and
  `memory-navigator.tsx` — use tRPC optimistic update (`onMutate` snapshot + cancel queries +
  remove from `memory.list` infinite-query cache; `onError` rollback; `onSettled` invalidate).
- Keep **edit server-confirmed** (unchanged) — document why (re-embedding is server-side).

**Acceptance criteria.**

- Deleting an item removes it from the list instantly; a server error restores it and toasts.
- Deleting an already-gone memory surfaces a not-found message (no false success).
- Editing still waits for the server and reflects the new `updatedAt`/embedding state.

**Tests (both levels).**

- Service: extend `prisma-backend.test.ts` (delete not-found path returns `{deleted:false}`).
- Wiring/UI: extend `memory-detail-sheet.test.tsx` / `memory-list.test.tsx` (optimistic
  removal + rollback on error) and `routers.test.ts` (delete NOT_FOUND mapping).

**Size:** M. **Depends-on:** none (T4 shares the optimistic helper if merged first — coordinate).

---

### T6 — Vector-sync correctness on edit: embedding staleness signal + G12 TTL

**Description.** Cover the required "edit → re-embedding + vector sync" explicitly: expose
when a memory's vector is **stale/pending** relative to its content (the LTM
edit-under-embedding-outage case), and implement the D5 STM-TTL behavior.

**Files.**

- Modify `apps/mcp-server`/`packages/memory-ltm` update path to record an embedding-state
  marker (e.g. `metadata.embeddingStale=true` when a content edit could not re-embed), and
  clear it on successful reindex. Surface it through the existing `MemoryDTO.hasEmbedding` +
  a new `embeddingStale` flag in `apps/web/server/backend/types.ts` and `mapRow`.
- Modify `apps/web/components/memories/memory-detail-sheet.tsx` — show "Embedding: stale —
  reindex pending" and, when the operator is admin (T7), a "Reindex this user" affordance
  that calls the existing `queue_reindex_memories`/`reindex_memories` admin tool.
- Modify `packages/memory-stm/src/memory-stm.service.ts:166-181` — preserve remaining TTL on
  edit; add/confirm an explicit `extendTtl` path (already exists `:337-364`) surfaced to the
  UI; expose remaining TTL in the STM read (T1).
- Modify the detail sheet to render an STM countdown + "Extend TTL" button.

**Acceptance criteria.**

- Editing LTM content while embeddings are unavailable marks the memory stale; a subsequent
  reindex clears it; the UI reflects both states.
- Editing an STM memory preserves its remaining TTL (does not reset to full); "Extend TTL"
  visibly lengthens it; the sheet shows a live countdown.
- Deleting LTM removes its vector (verify via existing `removeVector`); STM delete removes
  only the Redis key.

**Tests (both levels).**

- Service: extend `memory-ltm.service.spec.ts` (stale marker set on failed re-embed, cleared
  on reindex; vector removed on delete) and `memory-stm.service.spec.ts` (TTL preserved on
  edit; extend works).
- Wiring/UI: extend `memory-detail-sheet.test.tsx` (stale badge + countdown) and
  `prisma-backend.test.ts` (`embeddingStale` mapping).

**Size:** M. **Depends-on:** T1 (STM read) for the TTL surface; otherwise independent.

---

### T7 — Proportionate authz: gate destructive ops by delegation; document + flag userId-trust

**Description.** Without solving G1, make the UI honest and safer: bind console actor
identity for the audit trail, and disable cross-tenant destructive actions when the key is
`tenant-limited` (D6).

**Files.**

- Modify `apps/web/server/trpc/context.ts` / `trpc.ts` — pass the signed-in operator email
  into the backend call context so writes carry `actor='console:<email>'` (feeds T2).
- Modify `apps/web/server/backend/prisma-backend.ts` — pass actor metadata on
  `update_memory`/`delete_memory` calls; in `updateMemory`/`deleteMemory`/`bulkDelete`, when
  `capabilities().delegation==='tenant-limited'` and the target `userId !== keyTenant`,
  throw `BackendError('…', 'WRITES_DISABLED')` with the `limitation` text instead of a
  confusing downstream not-found.
- Modify `apps/web/components/memories/memory-detail-sheet.tsx` + list bulk bar — disable
  edit/delete (reuse the existing `WriteActions` blocked-tooltip pattern `:320-368`) with the
  `capabilities.limitation` reason when cross-tenant + tenant-limited.
- Docs: a short "Security model" note in `apps/web/README.md` — allow-listed operators are
  full admins over whatever the API key reaches; `userId` is a data-owner _selector_, trusted
  by the MCP server only under an admin key or auth-disabled; per-operator scoping is G1.

**Acceptance criteria.**

- A `tenant-limited` key: destructive actions on a non-key-tenant owner are disabled in the
  UI with an explanatory tooltip, and blocked server-side with a clear message.
- Audit rows from the console carry `actor='console:<operatorEmail>'`, `actorType='operator'`.
- `admin`/`unrestricted` modes are unchanged (full management).

**Tests (both levels).**

- Service: extend `prisma-backend.test.ts` (cross-tenant delete blocked under `tenant-limited`;
  actor metadata forwarded).
- Wiring/UI: extend `routers.test.ts` (actor threaded from session) and
  `memory-detail-sheet.test.tsx` (blocked tooltip under tenant-limited cross-tenant).

**Size:** M. **Depends-on:** T2 (actor feeds audit). Can develop in parallel; merge after T2.

---

### T8 (optional) — Optimistic concurrency guard (G4)

**Description.** Optional guard against lost updates when an operator edit races a concurrent
agent write. **Not a WP2 dependency**; ship only if G4 is prioritized.

**Files/approach.** Add an `updatedAt` (or `version Int`) precondition to
`update_memory`/`delete_memory` (compare-and-set in `memory-ltm.update`/`delete`); the web
edit sends the `updatedAt` it loaded and surfaces a "changed since you opened it" conflict.
Prefer a `version` column (SHARED, serialize with SHARED-2) over `updatedAt` to avoid clock
issues.

**Acceptance / tests.** Service-level compare-and-set spec in `memory-ltm.service.spec.ts`;
UI conflict path in `memory-detail-sheet.test.tsx`. **Size:** M. **Depends-on:** optional
schema task if using `version`.

## Dependency graph

```
SHARED-2 (audit schema) ──┬─▶ T2 (audit write + tools) ──┬─▶ T3 (audit read UI)
                          │                              └─▶ T7 (actor → audit)   [merge after T2]
                          └─(only T2 needs schema)

Independent, parallel from the start (no schema dep):
  T1 (STM read seam)        ──▶ (feeds TTL surface of) T6
  T5 (optimistic delete + delete-result fix)
  T4 (bulk ops)             ── shares optimistic helper with T5; audit completeness needs T2
  T6 (embedding staleness + STM TTL)   ── needs T1 for TTL surface

Optional / separate track:
  T8 (optimistic concurrency)  — independent; own optional schema task
```

- **Critical path:** SHARED-2 → T2 → T3 (audit is the largest new capability).
- **Fully parallel with the critical path:** T1, T5, T6, T7(dev), T4(dev). Only the
  _merge order_ matters: land SHARED-2 first (serialize with other WPs' migrations), then T2,
  then T3/T7; T4/T5/T6 land whenever ready.
- **Max parallelism:** SHARED-2 + T1 + T5 + T6 can all start immediately by different agents.

## Risks & open questions

- **R1 (G1, security) — `userId` is caller-supplied and trusted end-to-end when auth is
  disabled.** The tRPC layer authenticates the _operator_ but never authorizes _which data
  owner_ they may act on; enforcement collapses to the MCP key scope. WP2 mitigates (T7) but
  does not fix. **Recommend G1 (per-operator/agent scopes) as a hard prerequisite before this
  UI is exposed beyond qp's single-tenant box.**
- **R2 — Edit under embeddings outage leaves a stale vector** (`memory-ltm.service.ts:344-405`).
  T6 makes it visible but recall is still stale until reindex. Open question: auto-queue a
  targeted reindex on stale-mark vs manual only? (Auto risks embedding-cost spikes, G7.)
- **R3 — Soft-delete strategy (D3).** Snapshot-restore vs a `deletedAt` column. `deletedAt`
  gives simpler "trash" semantics but forces every `where` clause (list/count/recall/dedup/
  quota) to exclude soft-deleted rows and complicates vector cleanup. Snapshot-restore is
  lighter but restore re-creates a new row identity unless we preserve `id`. **Decide during
  SHARED-2**; default is snapshot-restore preserving `id`.
- **R4 — STM read cost.** `stmService.list` SCANs Redis; for a large STM set the un-paginated
  group could be heavy. Cap the STM group (e.g. top 50 by recency) and note "showing N of M."
- **R5 — Bulk delete + embedding cost (G7).** Even though delete doesn't embed, a future bulk
  _edit_ would; keep bulk scoped to delete/tag in WP2 and cap N.
- **R6 — G12 default TTL semantics** may surprise agents that relied on edit-extends-TTL.
  D5 changes behavior; confirm no agent workflow depends on the old reset-on-edit.
- **Open — dedicated `list_stm_memories` tool vs filtering `list_memories`.** New tool is
  cleaner (avoids the buggy STM merge) but adds MCP surface; confirm reviewer preference (T1).
- **Open — should the MCP `delete_memory` tool return structured JSON `{deleted}`** so the web
  can report not-found precisely (T5), rather than string-matching its text? Recommended.

```

```
