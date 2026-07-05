# WP2 Memory-UI — Execution State

Resumable progress index for executing WP2 (Memory Management UI). The durable record
of completed work is the git history on this execution branch — this file is the
human-readable index.

## Pointers

- **Canonical plan (source of truth):**
  `/home/qp/Cloud/Projects/engram/.claude/worktrees/plans-suite-2026-07/docs/plans/2026-07-memory-platform/WP2-memory-ui/PLAN.md`
- **Suite conventions:** `../README.md` (same plans worktree), repo `CLAUDE.md` + `AGENTS.md`.
- **Execution worktree:** `/home/qp/Cloud/Projects/engram/.claude/worktrees/wp2-memory-ui`
- **Execution branch:** `feat/memory-ui-wp2` (branched from `origin/main` @ `fdc0d7d`;
  origin/main and the planning branch differ only by `docs/plans/**`, so the code baseline
  is identical).
- **Services:** Docker `engram-postgres` / `engram-redis` / `engram-qdrant` up (shared —
  do NOT `db:reset`). `EMBEDDING_PROVIDER=local`, `VECTOR_BACKEND=qdrant`,
  `PGVECTOR_TEST_URL` unset (pgvector integration tests skip).

## Baseline (untouched tree @ fdc0d7d) — all green

- `pnpm build` ✓ (16 tasks) · `pnpm typecheck` ✓ (15) · `pnpm lint` ✓ (17)
- `pnpm test` ✓ — 25 turbo tasks. Notable: mcp-server 620 passed/2 skipped;
  memory-ltm 195/2 skipped; memory-stm 76; core 68; web 73; redis 39.
  (Skips = pgvector integration, no `PGVECTOR_TEST_URL`.)

## Task status

Order respects the dependency graph (server foundations before UI consumers); sequential
in one worktree because tasks overlap heavily on shared files (parallel worktrees would
collide). Legend: ⬜ todo · 🟨 in-progress · ✅ done (committed).

| #        | Task                                                       | Depends  | Status | Commit                                                                            |
| -------- | ---------------------------------------------------------- | -------- | ------ | --------------------------------------------------------------------------------- |
| SHARED-2 | `Memory.version` + `MemoryAudit` schema + migration        | none     | ✅     | migration `20260705190357_memory_version_and_audit`                               |
| T2       | STM read path: delegation, type filter, structured results | none     | ✅     | live Redis SCAN paging verified — caught+fixed a real drop-items paging bug       |
| T1       | Keyset pagination                                          | none     | ✅     | cursor.ts + listMemories; walk verified on real PG                                |
| T4       | Optimistic concurrency (version CAS)                       | SHARED-2 | ✅     | stores+mcp+web+UI; full suite green                                               |
| T7       | Re-embed integrity (`embeddingStale` + `reembed_memory`)   | (T4)     | ✅     | LTM flag+reembed (no version bump); tool 21; UI badge/button                      |
| T5       | Persistent audit trail + restore (`ToolCallContext`)       | SHARED-2 | ✅     | core ctx + audit svc + restore/get_audit tools (23) + web history; suite green    |
| T6       | Bulk delete (`bulk_delete_memories`)                       | SHARED-2 | ✅     | tool (24) + per-item report; audit each; UI checkbox+dialog (type-to-confirm)     |
| T3       | STM UI (live tier, TTL, promote)                           | T2       | ✅     | short-term source switch, StmStrip, expiry badge, promote+extendTTL; promote JSON |
| T8       | Optimistic delete UX                                       | T2       | ✅     | onMutate evicts list+listStm+search caches, onError restores; pure evict tested   |
| T9       | Proportionate authz (operator→tenant binding)              | (last)   | ⬜     |                                                                                   |

## Decisions / notes log

- Sequential-in-one-worktree confirmed with advisor: dissolves the plan's merge-conflict
  hotspots (they only exist for parallel worktrees).
- Anchor edits on symbols/content, not the plan's absolute line numbers — they drift after
  each task shifts shared files.
- SHARED-2 migration is additive (defaulted `version`, new `MemoryAudit`) — apply with
  `pnpm db:migrate`, verify SQL has no destructive statements; never `db:reset` the shared DB.
- Per-task gate: affected package tests + `pnpm build` + `pnpm typecheck`; full `pnpm test`
  at milestones (post-SHARED-2, post-server-tasks, end).
- **T2 live-verification debt** (advisor): T2 is entirely mock-verified. Its acceptance
  criteria need a live STM round-trip (web → `list_memories(type:'short-term')` → real
  Redis SCAN → paged back), proving: the loosened SCAN cursor survives the schema +
  re-enters `stm.list` across pages, the real `StmMemory` JSON shape matches
  `mapMcpMemory`, and delegation injects `userId` end-to-end. Redis is up (`engram-redis`).
  Add a Redis-backed paging integration test (mirroring T1's 60-row walk) BEFORE T3, which
  builds the STM UI on this seam.
- Commit bodies: the `Co-Authored-By` footer (~66 chars) counts toward commitlint
  `body-max-length` (300). Empirically keep body PROSE ≤ ~200 chars to pass first try
  (224 passed, 270 failed).
- T4 seams to thread: `MemoryDTO.version`, `memorySelect` + `mapRow` in prisma-backend (none
  carry `version` yet), and confirm STM `create` stamps `version:1` into the Redis payload
  (CAS compares against it).
