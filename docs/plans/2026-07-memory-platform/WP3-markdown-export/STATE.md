---
title: WP3 — Rich Markdown Export — Execution State
description: Per-task execution tracker for WP3 (markdown export). Companion to PLAN.md.
---

# WP3 — Execution State

Execution tracker for WP3 (Rich Markdown Export). Companion to [`PLAN.md`](./PLAN.md).
Update one row per task as it lands; commit incrementally.

- **Branch / worktree:** `feat/markdown-export-wp3` (worktree `.claude/worktrees/wp3-markdown-export`), branched from `origin/main` @ `ebc975f`.
- **Started:** 2026-07-06.

## Task status

Legend: ✅ done+verified · 🟨 partial · ⬜ not started.

| Task     | Deliverable                                          | Status | Both-levels tests | Notes                                                                             |
| -------- | ---------------------------------------------------- | ------ | ----------------- | --------------------------------------------------------------------------------- |
| T1       | `packages/memory-interchange` scaffold + frontmatter | ✅     | service ✓         | build/typecheck/lint/test green; 10 schema specs                                  |
| T2       | slug + wikilink utilities                            | ✅     | service ✓         | slugify/buildFilename + emit/parse/escape wikilinks; 26 specs                     |
| T3       | `serializeMemory()` + `parseDocument()`              | ✅     | service ✓         | golden doc + round-trip (---/[[x]]/## Related content) + single mode; 48 specs    |
| T4       | edge collector (metadata + MemoryLink)               | ✅     | service ✓         | all 4 metadata kinds + MemoryLink (guarded) → canonical edges; dangling; 12 specs |
| T5       | `MemoryExportService` orchestrator                   | ⬜     |                   |                                                                                   |
| T6       | CLI `export` (first surface)                         | ⬜     |                   |                                                                                   |
| T7       | MCP tool `export_memories`                           | ⬜     |                   |                                                                                   |
| T8       | Web UI download-as-zip (last surface)                | ⬜     |                   |                                                                                   |
| T9       | round-trip contract test harness                     | ⬜     |                   |                                                                                   |
| SHARED-1 | `MemoryLink` schema + migration (additive)           | ⬜     |                   | deferred; T4 reads it capability-guarded. Needs docker + serial migration         |

## Decisions locked (deviations from PLAN noted)

- **Build tooling:** package uses plain `tsc` + `vitest` (matches `packages/eval`),
  not the `tsup` the PLAN mentions — the repo has no `tsup` anywhere.
- **Dependency purity:** `memory-interchange` depends only on `zod` + `yaml` (PLAN §8
  risk 8). It defines its own id/type/datetime primitives rather than importing
  `@engram/database`, so WP4 importers can depend on it without pulling the server.
- **Edge `origin` vocabulary:** the export contract uses `durable | derived`
  (PLAN §4.2/§4.3). The `MemoryLink.origin` DB column uses `authored | derived`; the
  T4 collector maps `authored → durable`.
- **Not `"type": "module"`:** the package emits CJS-compatible output (NodeNext +
  `.js` import specifiers) so the CommonJS Nest `mcp-server` can `require` it.
- **Lockfile:** `pnpm install` reformats `pnpm-lock.yaml` to pnpm's native style; the
  committed file is prettier-formatted (and in `.prettierignore`). After install, run
  `pnpm exec prettier --write pnpm-lock.yaml --ignore-path /dev/null` to restore the
  committed style so the diff is only the new importer entry (no churn).
- **SHARED-1 deferred:** T1→T6 need no docker/DB (leaf lib pure TS; T4/T5 use mocked
  Prisma). Land the usable CLI export first; do SHARED-1 as a separate migration PR.
- **T4 semantic fix (deviation from PLAN §4.3):** the PLAN table row "source memory
  `insightId` → derived-from → insight" is backwards. T4 emits `source-of → insight`
  (the correct inverse of the insight's `derived-from → source`); both metadata
  encodings converge on the same deduped edge pair. Documented in `edge-collector.ts`.
- **Worktree env gate:** a fresh worktree must run `pnpm db:generate` then `pnpm build`
  before `pnpm --filter mcp-server typecheck` passes (Prisma client is gitignored and
  dependent package `dist` are absent otherwise — not a WP3 defect; see suite STATE).
