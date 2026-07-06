---
title: Memory Platform Suite — Execution State
description: Cross-WP execution tracker (what has been built, verified, and what remains) for the 2026-07 memory-platform work-package suite
---

# Memory Platform Suite — Execution State

Execution tracker for the six-WP suite. **This file tracks _execution_ (is the plan
built + verified?).** The [`README.md`](./README.md) "Status" table tracks a different
axis — whether each _plan document_ was authored. A WP can be "plan: done" there and
"execution: not started" here.

- **Last updated:** 2026-07-06 (qp session — verified WP2, started this tracker, merged the suite to `main`).
- **Last run:** WP2 (Memory Management UI) — executed + merged.

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

| WP      | Deliverable                                    | Plan | Execution                                                | Where                                |
| ------- | ---------------------------------------------- | ---- | -------------------------------------------------------- | ------------------------------------ |
| WP1     | Marketing-site validation + R1–R13 remediation | ✅   | ⬜ not started¹                                          | report in this worktree              |
| **WP2** | **Memory management UI (SHARED-2 + T1–T9)**    | ✅   | ✅ **done — verified** (8/10 tasks clean, T3+T6 partial) | **merged `main` @109e0d8 (PR #222)** |
| WP3     | Rich markdown export (SHARED-1 + T1–T9)        | ✅   | ✅ **done — verified** (T1–T9; SHARED-1 deferred)        | branch `feat/markdown-export-wp3`    |
| WP4     | Agentic memory import (SHARED-1 + T1–T16)      | ✅   | ⬜ not started                                           | plan only                            |
| WP5     | Engram as primary agent memory (D1–D8, T1–T13) | ✅   | ⬜ not started                                           | plan only                            |
| WP6     | Developer docs app (Starlight, D1–D10, T1–T14) | ✅   | ⬜ not started                                           | plan only                            |

¹ WP1 is a findings report (R1–R13 remediation tasks), not shipped code. One adjacent
marketing-site commit exists on main (`3241bae` — Pages custom-domain guard + TLS runbook)
but is not tracked as WP1 remediation here; WP1's R1–R13 are otherwise unstarted.

### Shared prerequisites (cross-WP schema — apply migrations serially)

| Task     | Model                                                              | Status                                                                             |
| -------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| SHARED-1 | `MemoryLink` (typed memory→memory edges) — consumed by WP3/WP4/WP2 | ⬜ not started (canonical: [`SHARED-1-memory-link.md`](./SHARED-1-memory-link.md)) |
| SHARED-2 | `Memory.version` + `MemoryAudit` — consumed by WP2/WP4             | ✅ **done** — migration `20260705190357_memory_version_and_audit` on main          |

> When WP3/WP4 execute, SHARED-2 is already applied to the shared dev Postgres. Serialize
> SHARED-1's migration with any other pending schema work per the README dependency graph.

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

| Task                   | Verdict        | Both-levels tests | Note                                                                  |
| ---------------------- | -------------- | ----------------- | --------------------------------------------------------------------- |
| SHARED-2               | ✅ implemented | ✓                 | schema/migration exact; DB-gated round-trip spec                      |
| T1 keyset pagination   | ✅ implemented | ✓                 | cursor.ts + 60-row real-PG walk                                       |
| T2 STM read path       | ✅ implemented | ✓                 | delegable + structured JSON; fixed a real STM SCAN drop-items bug     |
| T3 STM UI              | 🟨 **partial** | ✓                 | **D4 TTL-preserve edit input missing** + 2 plan-required tests absent |
| T4 version CAS         | ✅ implemented | ✓                 | LTM CAS + STM read-compare-set; minor test gaps                       |
| T5 audit + restore     | ✅ implemented | ✓                 | ToolCallContext + restore-by-original-id verified live                |
| T6 bulk delete         | 🟨 **partial** | ✓                 | **>100 client cap missing**; DTO-bounds + concurrency tests absent    |
| T7 re-embed integrity  | ✅ implemented | ✓                 | clean — no gaps found                                                 |
| T8 optimistic delete   | ✅ implemented | ✓                 | cache surgery correct; round-trip test uses pure helper               |
| T9 proportionate authz | ✅ implemented | ✓                 | server enforcement solid; client polish deferred (as executor noted)  |

All 10 tasks satisfy the suite's tests-at-both-levels rule. The two 🟨 tasks have genuine
unmet acceptance criteria beyond what the executor's STATE.md admitted.

### WP2 residual follow-ups (not blocking; tracked here)

Ranked. None is a security or data-correctness hole; the gate is green.

1. **T3 — D4 "TTL preserve-by-default" is unimplemented (behavioral).** There is no
   edit-mode "TTL (seconds)" input; `saveEdit` threads no `ttl`. Because the STM store
   computes `newTtl = input.ttl ?? existing.ttl` (full stored window, not remaining), a
   plain console edit of an STM item **resets its expiry to a full window** — the exact
   regression D4 set out to prevent. Only the standalone "+1h TTL" button threads a ttl.
   _Fix:_ add the remaining-TTL-prefilled input per T3 step 3 + its detail-sheet test.
2. **T6 — ">100 selection blocked client-side with a hint" is unmet.** The 100 cap is
   server-side Zod only; a >100 attempt shows a generic "Bulk delete failed" toast, not a
   proactive client hint. _Fix:_ client-side cap + disabled state + hint.
3. **Missing plan-mandated tests** (both-levels rule technically met elsewhere, but these
   specific required specs are absent): T3 navigator "source-switch on `type=short-term`"
   test (no `memory-navigator.test.tsx` exists), T3 `routers.test.ts` ttl-threading case,
   T6 DTO-bounds spec, T6 concurrency-cap assertion.
4. **T6 expandable failure list** not built — the toast shows only the first failure + "…".
5. **T9 client polish** (executor-admitted): `meta.allowedTenants` is exposed but not
   consumed; free-text scope-switcher entry has no client gate; settings page shows the
   delegation limitation but no explicit per-operator binding readout. Server enforcement
   (`assertCanManageUser`) is complete and tested — this is UX only.
6. **`test:e2e:docker`** (CI-only) not run locally; no e2e spec asserts prose on the changed
   `get_memory`/`delete_memory`/`promote_memory` tool results.

### Doc nit found during verification

`WP2-memory-ui/PLAN.md` (~line 343) has a garbled parenthetical: it calls the `MemoryLink`
model "SHARED-2" and references a nonexistent `../SHARED-2-memory-link.md`. The
[`README.md`](./README.md) registry is authoritative: **SHARED-1 = `MemoryLink`**
(`SHARED-1-memory-link.md`), **SHARED-2 = version/audit** (what WP2 actually built). The
task card itself is labelled correctly; only the parenthetical is stale.

## Resume protocol

1. Re-enter this worktree (`worktree-plans-suite-2026-07`); read `README.md` "Resume
   protocol" + this file.
2. WP2 is done — treat it as a reference implementation for shared machinery (SHARED-2
   schema, `ToolCallContext`, delegation pattern, structured tool results) that WP4 reuses.
3. To start a new WP: one worktree per WP rebased on `origin/main` (which now carries WP2 +
   SHARED-2), execute per its `PLAN.md`, drop a `WPx-*/STATE.md` beside its plan, and flip
   its row above. Run `pnpm db:generate` before the gate on any fresh checkout.
