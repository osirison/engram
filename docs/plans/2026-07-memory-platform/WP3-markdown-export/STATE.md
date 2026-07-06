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

| Task     | Deliverable                                          | Status | Both-levels tests  | Notes                                                                                                                               |
| -------- | ---------------------------------------------------- | ------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| T1       | `packages/memory-interchange` scaffold + frontmatter | ✅     | service ✓          | build/typecheck/lint/test green; 10 schema specs                                                                                    |
| T2       | slug + wikilink utilities                            | ✅     | service ✓          | slugify/buildFilename + emit/parse/escape wikilinks; 26 specs                                                                       |
| T3       | `serializeMemory()` + `parseDocument()`              | ✅     | service ✓          | golden doc + round-trip (---/[[x]]/## Related content) + single mode; 48 specs                                                      |
| T4       | edge collector (metadata + MemoryLink)               | ✅     | service ✓          | all 4 metadata kinds + MemoryLink (guarded) → canonical edges; dangling; 12 specs                                                   |
| T5       | `MemoryExportService` orchestrator                   | ✅     | service ✓          | LTM/STM paging, sanitize, MOC, manifest, determinism, single mode; 9 specs                                                          |
| T6       | CLI `export` (first surface)                         | ✅     | service + wiring ✓ | parseArgs/buildOptions + DirectorySink + runExport→disk wiring; 10 specs                                                            |
| T7       | MCP tool `export_memories`                           | ✅     | service + wiring ✓ | inline/path branch + registration/scope-gate/delegation dispatch wiring; 9 specs                                                    |
| T8       | Web UI download-as-zip (last surface)                | ✅     | service + wiring ✓ | tRPC export→zip + ExportDialog + navigator button; router/authz/component specs                                                     |
| T9       | round-trip contract test harness                     | ✅     | service + e2e stub | durableProjection helper + 6 parse-side specs; e2e stub (todo, WP4 completes)                                                       |
| SHARED-1 | `MemoryLink` schema + migration (additive)           | ⬜     | —                  | **deferred by WP3, owned by WP4** — T4 reads it additively (loadMemoryLinks seam). See suite [`STATE.md`](../STATE.md) handoff note |

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
- **T8 architecture (deviation from PLAN §T8):** the PLAN wanted a new streaming-zip
  HTTP endpoint _on mcp-server_. Instead T8 reuses the already-tested, scope-gated,
  delegable `export_memories` MCP tool (T7): the web backend calls it, the tRPC
  `memory.export` procedure zips the returned files (jszip → base64), and the browser
  decodes + downloads. **Rationale:** a new data-serving HTTP route on mcp-server is a
  fresh auth surface (gap G1 / §8 risk 6) that would duplicate the MCP auth logic;
  reusing the tool avoids that entirely. Trade-off: the vault is assembled in memory
  (bounded by `WEB_EXPORT_MAX_INLINE=2000`); beyond that the backend steers users to the
  CLI (T6), which is the true-streaming large-export path.

## Status summary

**T1–T9 all done + verified; full monorepo gate green** (`build` · `typecheck` · `lint` ·
`docs:check` · `test` — 27/27 turbo tasks). SHARED-1 deferred to a separate migration PR
(additive; the `loadMemoryLinks` seam in `MemoryExportService` reads it when present).
Usable today: CLI (`pnpm --filter mcp-server export`), MCP tool `export_memories`, and the
web Export button.

**Live boot verification (2026-07-06):** ran the CLI export against the real dev Postgres —
the full `AppModule.forRoot()` DI graph resolved, `MemoryExportService`/`MemoryLtmService`
booted, the real DB was queried, and a valid `index.md` + `manifest.json` were written to
disk (exit 0). This closes the "green-but-does-it-boot" gap the unit/wiring specs (which use
mocked/injected services) don't cover. The dev DB has no `qp` rows, so non-empty per-memory
serialization is covered by the T5 fixtures + the leaf-lib golden/round-trip specs, not the
live run (the shared DB was read-only; not seeded).

**Post-review fix (2026-07-06):** escaped the `<!-- engram:links -->` sentinel inside memory
content (`escapeRelatedMarker`/`unescapeRelatedMarker`) — previously, content embedding the
literal marker (plausible when documenting the export format) would be truncated at parse,
breaking the G6 round-trip. Round-trip fixtures added in `serialize.spec.ts` + `roundtrip.spec.ts`.
