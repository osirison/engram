---
title: Memory Platform Suite — Execution State
description: Cross-WP execution tracker (what has been built, verified, and what remains) for the 2026-07 memory-platform work-package suite
---

# Memory Platform Suite — Execution State

Execution tracker for the six-WP suite. **This file tracks _execution_ (is the plan
built + verified?).** The [`README.md`](./README.md) "Status" table tracks a different
axis — whether each _plan document_ was authored. A WP can be "plan: done" there and
"execution: not started" here.

- **Last updated:** 2026-07-12 (**wrap-up campaign started** — qp pinned scope to ALL
  remaining items: G1–G4 remainder, WP6 content T7–T14, WP1 R1–R13. Orchestration,
  batch tracker, and resume protocol live in [`WRAPUP-PLAN.md`](./WRAPUP-PLAN.md);
  execute from there. Earlier: 2026-07-09 medium gaps G5–G9 remediated — see
  [`GAPS.md`](./GAPS.md); 2026-07-08 WP2 T3/T6 residual follow-ups; 2026-07-06
  verified WP2 + merged the suite to `main`).
- **Last run:** Medium gaps G5–G9 (branch `feat/gaps-medium-g5-g9`): G5 export
  `includeHistory` sidecar, G6 DB-backed round-trip e2e + importer `## Related`-mirror
  fix, G8 eval-threshold DRY cleanup, G9 backup coverage of the WP2-4 tables. G7 batch
  embedding + G8 real-memory fixtures + G9 hosted-TLS deferred with rationale in GAPS.md.

## Branch / worktree topology (resolved)

`main` now carries **both** the WP2 implementation (#222) and the full plan suite +
this tracker (#223). No divergence remains.

History: the WP2 executor branched `feat/memory-ui-wp2` from `origin/main` (not from the
planning branch), built WP2, and merged it as **#222** — so for a while the plan docs
lived only on `worktree-plans-suite-2026-07` and the implementation only on `main`
(the two shared only base commit `fdc0d7d`). **Resolved 2026-07-06:** the planning branch
was merged into `main` as **#223** (option (a)), after adding `title`/`description`
frontmatter to the eight older plan docs and rewriting `WP4-agent-memory-import/PLAN.md`'s
illustrative markdown-link examples to arrow form so CI's "Check docs" job passes. The one
add/add conflict (`WP2-memory-ui/STATE.md`, created on both sides) was resolved by keeping
the superset — the executor's record plus the independent-verification section.

## Execution status

Legend: ✅ done+verified · 🟨 partial · ⬜ not started · 📄 plan authored only.

| WP      | Deliverable                                    | Plan | Execution                                                                                                                             | Where                                                   |
| ------- | ---------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| WP1     | Marketing-site validation + R1–R13 remediation | ✅   | ✅ **code done** (B8 #259 + B9 #261; R10 Lighthouse blocked — no Chrome on host, re-run cmd in REPORT); R1/R9 Pages-TLS ops in flight | WRAPUP-PLAN.md B8/B9/BOps                               |
| **WP2** | **Memory management UI (SHARED-2 + T1–T9)**    | ✅   | ✅ **done — verified** (T1–T9 + SHARED-2; T3/T6 follow-ups remediated 2026-07-08)                                                     | **merged `main` @109e0d8 (PR #222)** + follow-up branch |
| WP3     | Rich markdown export (SHARED-1 + T1–T9)        | ✅   | ✅ **done — verified** (T1–T9; SHARED-1 deferred)                                                                                     | branch `feat/markdown-export-wp3`                       |
| WP4     | Agentic memory import (SHARED-1 + T1–T16)      | ✅   | ✅ **done — verified** (SHARED-1 + T1–T16)                                                                                            | worktree `worktree-wp4-agent-memory-import`             |
| WP5     | Engram as primary agent memory (D1–D8, T1–T13) | ✅   | ✅ **shipped** (agent-bridge, per-agent config, recall gate, file-watcher sync)                                                       | merged `main` (PR #227, `1d63dd6`)                      |
| WP6     | Developer docs app (Starlight, D1–D10, T1–T14) | ✅   | 🟨 **wave 1 done** (T1–T6 #243; T7a/T7b/T8/T13 #263); B7 = T9–T12, T14                                                                | WRAPUP-PLAN.md B6/B7                                    |

¹ WP1 is a findings report (R1–R13 remediation tasks), not shipped code. One adjacent
marketing-site commit exists on main (`3241bae` — Pages custom-domain guard + TLS runbook)
but is not tracked as WP1 remediation here; WP1's R1–R13 are otherwise unstarted.

### Shared prerequisites (cross-WP schema — apply migrations serially)

| Task     | Model                                                              | Status                                                                                                                                                                                                               |
| -------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SHARED-1 | `MemoryLink` (typed memory→memory edges) — consumed by WP3/WP4/WP2 | ✅ **done** (WP4) — canonical model in migration `add_memory_link_and_import_source`; FK source Cascade / target SetNull; DB-gated spec verifies both. WP3's `loadMemoryLinks` export seam still a stub (follow-up). |
| SHARED-2 | `Memory.version` + `MemoryAudit` — consumed by WP2/WP4             | ✅ **done** — migration `20260705190357_memory_version_and_audit` on main                                                                                                                                            |

> When WP3/WP4 execute, SHARED-2 is already applied to the shared dev Postgres. Serialize
> SHARED-1's migration with any other pending schema work per the README dependency graph.

> **SHARED-1 handoff (do not drop):** WP3 (export) executed **without** landing SHARED-1 — its
> edge collector reads `MemoryLink` rows _additively_ through the `loadMemoryLinks` seam in
> `MemoryExportService`, a no-op until the table exists (WP3 is fully functional on
> metadata-derived edges today). **WP4 is the owner that must land SHARED-1**: WP4 _writes_
> `MemoryLink` rows for imported links, and its plan already carries the migration as a task
> (`WP4-agent-memory-import/PLAN.md` §6 "SHARED-1 — `MemoryLink` schema + migration", depends:
> none). When WP4 executes, land SHARED-1's migration first (serially, per the README), then
> WP3's export automatically starts emitting first-class `MemoryLink` edges with no code change
> — verify by flipping this row to ✅ and re-running WP3's `collectEdges` against seeded rows.

## WP2 — execution + verification detail

**Merged:** PR #222 (`109e0d8`), commit `feat(memory-ui): WP2 memory management console
(SHARED-2 + T1–T9)`. Executor's own progress record: [`WP2-memory-ui/STATE.md`](./WP2-memory-ui/STATE.md)
(reconstructed into this worktree from main; independent-verification section appended).

**Quality gate (re-run 2026-07-06 against `main` @109e0d8):** `build` ✅ · `typecheck` ✅ ·
`lint` ✅ · `test` ✅ (25/25 turbo tasks; 651 mcp-server tests). **Operational caveat:**
if your checkout of `main` fails `build`/`typecheck`/`lint` with `Property 'memoryAudit'
does not exist on type 'PrismaService'` (while `pnpm test` still passes — vitest mocks
Prisma), run `pnpm db:generate`. The generated Prisma client is gitignored
(`node_modules/.prisma`) with no `postinstall` hook to regenerate it, so a checkout that
predates SHARED-2's schema lags behind; CI regenerates it, which is why PR #222 was green.
Not a WP2 defect. The 4 live DB/Redis integration suites (SHARED-2 round-trip, T1 keyset
walk, T2 SCAN paging, T5 restore) were not re-run here (require docker up + the shared DB);
the executor reports them green on the execution branch.

**Independent per-task verification (static code + test audit, 10 agents):**

| Task                   | Verdict        | Both-levels tests | Note                                                                                                  |
| ---------------------- | -------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| SHARED-2               | ✅ implemented | ✓                 | schema/migration exact; DB-gated round-trip spec                                                      |
| T1 keyset pagination   | ✅ implemented | ✓                 | cursor.ts + 60-row real-PG walk                                                                       |
| T2 STM read path       | ✅ implemented | ✓                 | delegable + structured JSON; fixed a real STM SCAN drop-items bug                                     |
| T3 STM UI              | ✅ implemented | ✓                 | D4 TTL-preserve edit input + navigator source-switch/ttl tests added (2026-07-08 follow-up)           |
| T4 version CAS         | ✅ implemented | ✓                 | LTM CAS + STM read-compare-set; minor test gaps                                                       |
| T5 audit + restore     | ✅ implemented | ✓                 | ToolCallContext + restore-by-original-id verified live                                                |
| T6 bulk delete         | ✅ implemented | ✓                 | client >100 cap + expandable failure list + DTO-bounds/concurrency tests added (2026-07-08 follow-up) |
| T7 re-embed integrity  | ✅ implemented | ✓                 | clean — no gaps found                                                                                 |
| T8 optimistic delete   | ✅ implemented | ✓                 | cache surgery correct; round-trip test uses pure helper                                               |
| T9 proportionate authz | ✅ implemented | ✓                 | server enforcement solid; client polish deferred (as executor noted)                                  |

All 10 tasks satisfy the suite's tests-at-both-levels rule. The two 🟨 tasks had genuine
unmet acceptance criteria beyond what the executor's STATE.md admitted; those were
**remediated on 2026-07-08** (see below).

### WP2 residual follow-ups — remediated 2026-07-08

Items 1–5 are **done** on the follow-up branch; item 6 (CI-only e2e) is unchanged. The gate
(`build`/`lint`/`typecheck`/`test`/`docs:check`) is green.

1. ✅ **T3 — D4 "TTL preserve-by-default" implemented.** `memory-detail-sheet.tsx` now
   shows an STM edit-mode "TTL (seconds)" input pre-filled with the **remaining** window —
   derived from `secondsUntil(expiresAt)`, NOT `ttlSeconds` (which is the stored full
   window), clamped to `[60, 604800]` — and `saveEdit` threads it. A plain STM save now
   keeps roughly the current expiry instead of resetting to a full window. Behavioral
   detail-sheet tests assert remaining-window (≈1800s), operator override, and
   LTM-omits-ttl.
2. ✅ **T6 — client >100 cap with a hint.** The navigator disables the "Delete N selected"
   action and shows "Select at most 100 to delete at once" when the selection exceeds
   `MAX_BULK_DELETE` (server Zod remains the backstop).
3. ✅ **Missing plan-mandated tests added:** `memory-navigator.test.tsx` (tier source-switch
   on `type=short-term` / `all` / `long-term` / search), `routers.test.ts` ttl-threading +
   out-of-range cases, `bulk-delete.dto.spec.ts` (min/max/strict bounds),
   `memory.service.spec.ts` concurrency-cap assertion (≤5 in-flight).
4. ✅ **T6 expandable failure list built.** On partial failure the dialog stays open in an
   outcome view ("Deleted X of N") with an expandable per-item `{id, reason}` list; the
   successfully-deleted ids drop out of the selection so a retry targets only the failures.
5. ✅ **T9 client polish.** The scope-switcher consumes `meta.allowedTenants`, gating
   free-text entry (blocked with a hint for forbidden tenants; a "Limited to …" footer when
   bound); the settings page shows a "Data-owner access" readout. Also D3: the STM view now
   disables the sort + date-range controls with explanatory tooltips. Server enforcement
   (`assertCanManageUser`) was already complete and tested.
6. **`test:e2e:docker`** (CI-only) still not run locally; no e2e spec asserts prose on the
   changed `get_memory`/`delete_memory`/`promote_memory` tool results. Unchanged.

### Doc nit found during verification — ✅ fixed 2026-07-08

`WP2-memory-ui/PLAN.md` (~line 347) had a garbled parenthetical: it called the `MemoryLink`
model "SHARED-2" and referenced a nonexistent `../SHARED-2-memory-link.md` (now corrected to
`SHARED-1` / `../SHARED-1-memory-link.md`). The
[`README.md`](./README.md) registry is authoritative: **SHARED-1 = `MemoryLink`**
(`SHARED-1-memory-link.md`), **SHARED-2 = version/audit** (what WP2 actually built). The
task card itself is labelled correctly; only the parenthetical is stale.

## WP6 — execution detail (foundation)

Branch `feat/developer-docs-wp6`. The **foundation** is built and locally verified
(`pnpm build`/`lint`/`typecheck` green; `@engram/config` 56 tests, `mcp-server` 754
tests; `pnpm docs:check` + docs build + drift gate clean). Commits: T1 `628f3eb`,
T3 `05583e4`, T4 `9886edb`, T5 `1c656f2`, T2+T6 `c458042`, check-docs fix `ac2a3d2`.

**Done**

- **T1** — `apps/docs` replaced with Astro Starlight (Astro 7 / Starlight 0.41.3),
  `base: '/docs'`, `starlight-links-validator`. Base-path verified: sidebar links +
  Pagefind results resolve under `/docs` with no #1407 patch. Strategy A confirmed
  viable — no Vercel fallback needed.
- **T3** — `scripts/gen-env-table.mjs` (ts-morph, no compiled import) →
  `reference/configuration.md`; exported `baseSchema`; added JSDoc to 4 fields;
  wiring spec asserts per-field coverage + determinism.
- **T4** — extracted `apps/mcp-server/src/memory/tools-manifest.ts` as the **single
  source of truth**; refactored `getMcpTools()` to consume it (handlers bound by
  name); `scripts/gen-mcp-tools.mjs` (imports compiled manifest + `zodToJsonSchema`)
  → per-tool pages + index. Spec asserts the controller registers exactly the
  manifest. Generated `.md` prettier-ignored so the drift gate stays byte-stable.
- **T5** — `starlight-typedoc` generates the 12-package API reference at build time
  into `reference/api` (**git-ignored**; regenerated every build, so no drift gate).
- **T2** — `node.js.yml` builds the docs site and merges it into the marketing-site
  Pages artifact under `/docs`; triggers on `apps/docs/**` too.
- **T6** — `ci.yml` drift gate after Build: `pnpm docs:generate` + `git diff
--exit-code` on `configuration.md` + `mcp-tools/` (api excluded — git-ignored).

**Deviations from PLAN (intentional)**

- API reference is **generated at build time and git-ignored**, not committed. It
  cannot drift (always rebuilt from source), so it needs no drift gate. `docs:generate`
  therefore covers only env + tools (build-independent via ts-morph for env; the
  tools step needs a prior `pnpm build`, which CI already runs before the gate).
- `.prettierignore` excludes the generated reference so committed output equals raw
  generator output (drift-gate premise). `check-docs.mjs` skips the generated api dir.

**Remaining (content — follow-up)**: T7a/T7b (migrate `docs/*.md` + stubs), T8
(getting-started tutorials), T9 (architecture), T10 (how-to), T11 (tool prose),
T12 (config prose), T13 (contributing), T14 (final acceptance gate). The sidebar
currently lists Getting started + Reference; extend it as each content section lands.

## Resume protocol

1. Re-enter this worktree (`worktree-plans-suite-2026-07`); read `README.md` "Resume
   protocol" + this file.
2. WP2 is done — treat it as a reference implementation for shared machinery (SHARED-2
   schema, `ToolCallContext`, delegation pattern, structured tool results) that WP4 reuses.
3. To start a new WP: one worktree per WP rebased on `origin/main` (which now carries WP2 +
   SHARED-2), execute per its `PLAN.md`, drop a `WPx-*/STATE.md` beside its plan, and flip
   its row above. Run `pnpm db:generate` before the gate on any fresh checkout.
