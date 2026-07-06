---
title: WP4 — Agentic Memory Import Execution State
description: What was built and verified for WP4 (SHARED-1 + T1–T16), plus residual follow-ups.
---

# WP4 — Execution State

- **Executed:** 2026-07-06 (qp session). Worktree `worktree-wp4-agent-memory-import`.
- **Package:** `@engram/memory-import` (new). App wiring in `apps/mcp-server`.
- **Gate:** `typecheck` ✅ · `lint` ✅ · `test` ✅ (184 memory-import + 11 mcp-server import tests) · `docs:check` ✅ · `build` ✅ (turbo).

## Status by task

Legend: ✅ done+verified · 🟨 partial.

| Task     | Deliverable                                                | Status | Notes                                                                    |
| -------- | ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| SHARED-1 | `MemoryLink` (canonical) schema + migration                | ✅     | FK source Cascade / target SetNull; DB-gated spec proves both directions |
| T1       | Import IR + `SourceAdapter` + parse utils                  | ✅     | reuses `@engram/memory-interchange` (wikilink/slug/edge-types)           |
| T2       | `MemoryImportSource` ledger + service                      | ✅     | unique `(userId, sourceKey)`; `listByUser` added for T5 Pass B           |
| T3       | `MemoryImportService` pipeline                             | ✅     | skip/update/create/merge, quota-graceful stop, dry-run                   |
| T4       | Secret / PII scanner                                       | ✅     | 9 reused + 5 new patterns; redact/flag/skip/fail                         |
| T5       | Link resolver (two-pass + deferred)                        | ✅     | resolved→`id:` locator, original retained for re-resolution              |
| T6–T11   | Adapters: claude-code/copilot/cursor/codex/gemini/markdown | ✅     | built via parallel workflow; each with fixtures + service tests          |
| T12      | CLI `import.cli.ts` + `pnpm --filter mcp-server import`    | ✅     | mirrors reindex.cli; `parseArgs` spec                                    |
| T13      | MCP tool `import_agent_memory` (admin-gated)               | ✅     | wired into `MemoryModule`; hidden without Postgres; `.strict()` DTO      |
| T14      | Embedding cost estimator                                   | ✅     | pure `estimateEmbeddingCost`; dry-run + disabled path                    |
| T15      | WP3↔WP4 round-trip contract                                | ✅     | durable-projection round-trip via serialize→buildFacts (no DB needed)    |
| T16      | Docs                                                       | ✅     | `docs/IMPORT.md`; `__fixtures__` excluded from `docs:check`              |

## Key decisions / deviations from the plan

1. **Canonical `MemoryLink` FKs** — followed `SHARED-1-memory-link.md` (FK to
   `Memory`, source `Cascade` / target `SetNull`), which supersedes the PLAN §6
   / SHARED-1-step-1 "no FK" draft. Consequence: the app-level
   `deleteLinksForMemory` hook is **unnecessary** — the DB `foreignKeys` mode
   fires cascade/set-null even on `deleteMany` (used by `delete()`/`clear()`).
2. **IR link `relType: EdgeType`** — from interchange `EDGE_TYPES`; untyped
   source links default to `relates-to`, `origin: 'authored'`. There is no
   `references` type (it is not in the closed vocabulary).
3. **`MemoryImportService` wired directly in `MemoryModule`** (not via nested
   `MemoryImportModule`) so it reuses the single `MemoryLtmService` — mirrors
   `MemoryExportService`. `MemoryImportModule.forRoot` remains for standalone use.
4. **One combined migration** `add_memory_link_and_import_source` (both WP4-owned
   tables), applied via generated SQL + `migrate deploy` to an **isolated verify
   DB** (`engram_wp4_verify`) — the shared dev DB was left untouched. CI applies
   it to its own fresh DB.
5. **Canonical-export links** — `extractLinks` suppresses the inline `## Related`
   wikilink mirror when frontmatter carries `schemaVersion` (a WP3 export), so a
   round-trip import doesn't create spurious dangling `slug:<id>` links.

## Residual follow-ups (not blocking)

1. **`flag` secrets policy + inline embedding.** `flag` keeps raw content and
   sets `metadata.embeddingExcluded=true`, but `MemoryLtmService.create()` still
   embeds inline. Strict non-external-embedding for `flag` relies on running the
   import with a non-external provider or `--no-embed` (then reindex, which should
   honor `embeddingExcluded`). Best-effort per G2/R6. Making `create()` skip
   embedding per-fact is the clean fix (out of WP4 scope — non-goal).
2. **WP3 export seam not implemented.** `MemoryExportService.loadMemoryLinks`
   still returns `undefined` (a stub). Landing SHARED-1's schema does NOT by
   itself make WP3 emit first-class edges — a follow-up must implement the
   `prisma.memoryLink` query there. SHARED-1's own acceptance (insertability /
   uniqueness / cascade) is met and DB-verified.
3. **T5 Pass B ledger scan is in-memory** (`listByUser` per resolve call).
   Fine for current corpus sizes; add an index/query if it becomes hot.
4. **`[A]`-fact web verification** for Cursor/Codex/Gemini adapters was
   best-effort (findings recorded in each adapter's header comment).
