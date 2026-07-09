---
title: Cross-Cutting Gaps G1–G4 — Execution State
description: Resumable execution tracker for the critical/high gap remediation (G1 authz, G2 import secret-scan, G3 memory lifecycle, G4 concurrent-writer safety) on branch feat/gaps-critical-g1-g4
---

# G1–G4 Remediation — Execution State

Companion to [`GAPS-G1-G4-PLAN.md`](./GAPS-G1-G4-PLAN.md) (the plan: what to build, why,
and the shared seams). **This file tracks execution** (built + verified?) and pins qp's
decisions so any resume is unambiguous. Branch: `feat/gaps-critical-g1-g4` (from
`origin/main` @ `719898d`). Worktree: `/home/qp/Cloud/Projects/engram-gaps-critical`.

- **Last updated:** 2026-07-09 — plan authored + decisions pinned; execution starting.
- **Prereq:** these gaps were ~90% delivered by WP2–5; this branch closes the verified
  remainder (16 tasks: 6 S / 9 M / 1 L). See the plan §1 for what is already shipped.

## Decisions (pinned by qp, 2026-07-09)

1. **Deployment = "local now, hosted later."** Build G1 auth to be _engage-ready_ and
   documented, but **do NOT flip auth-on by default** — qp's local `:3100` runs auth-off
   by design and must keep working. G1-T1 = extend the boot fail-safe + engage-readiness +
   docs, not a default flip. (Resolves plan Decisions 1, partially 2.)
2. **Scope = full G1–G4 (all 16 tasks).** Remaining per-task policy decisions surfaced as
   each task is reached.
3. **Lifecycle = conservative / never-lose-data.** Contradictions keep BOTH rows flagged
   (not auto-supersede) as the default; corpus consolidation is dry-run / review-gated
   before it merges; agent blind updates are rejected (with a clear conflict error).
   (Resolves plan Decisions 7 → flag-default, 9 → review-gate, 12 → reject-blind.)

## Execution order (from plan §5, adapted to the decisions above)

Legend: ✅ done+verified · 🟨 in progress · ⬜ not started.

| Order | Task                                                       | Size | Level | Status | Commit / note                                  |
| ----- | ---------------------------------------------------------- | ---- | ----- | ------ | ---------------------------------------------- |
| 1     | **G3-T1** recall drops/flags superseded                    | S    | crit  | ⬜     | auth-independent, highest ROI                  |
| 2     | **G3-T5** validate+document lifecycle config               | S    | high  | ⬜     | config schema seam                             |
| 3     | **G4-T1** concurrency policy ADR (doc)                     | S    | high  | ⬜     | gates G4-T2/T3/T4                              |
| 4     | **G2-T1** enforce `embeddingExcluded` (create+reindex)     | M    | high  | ⬜     | blocked on Decision 3 (flag semantics)         |
| 5     | **G2-T2** scan frontmatter + title                         | M    | high  | ⬜     | Decision 6                                     |
| 6     | **G2-T3** correct IMPORT.md flag/reindex claims            | S    | high  | ⬜     | after G2-T1                                    |
| 7     | **G1-T1** engage-ready auth + extend boot fail-safe + docs | S    | crit  | ⬜     | adapted: no default flip                       |
| 8     | **G3-T3** lifecycle writes → version CAS + audit           | M    | crit  | ⬜     | shared CAS helper + ToolCallContext            |
| 9     | **G4-T2** enforce/observe optimistic concurrency on update | M    | high  | ⬜     | conservative = reject blind; shares actor seam |
| 10    | **G1-T2** per-agent key provisioning + docs                | M    | high  | ⬜     | after G1-T1; owns actor-signature shape        |
| 11    | **G1-T3** import path allowlist/traversal guard (A18)      | S    | high  | ⬜     | Decision 5 ownership (assign to G1)            |
| 12    | **G3-T4** both-kept-flagged contradiction policy           | M    | high  | ⬜     | conservative default = flag                    |
| 13    | **G4-T3** import-vs-agent-edit concurrency policy          | M    | high  | ⬜     | after G4-T1; maybe new migration               |
| 14    | **G3-T6** stronger contradiction detection                 | M    | high  | ⬜     | after G3-T4; Decision 11 (LLM?)                |
| 15    | **G4-T4** STM atomic Lua CAS                               | M    | high  | ⬜     | Decision 14 (optional)                         |
| 16    | **G3-T2** periodic corpus consolidation (dry-run gated)    | L    | crit  | ⬜     | LAST; after G3-T1+G3-T4                        |

## Shared seams (must not fork — from plan §2.5)

1. **One actor signature** — `ToolCallContext` (`packages/core/src/mcp/tools/index.ts:40-49`);
   G1-T2 owns the shape, G3-T3/G4-T2 consume. Add any new field (e.g. `blindUpdate`) ONCE.
2. **One version-CAS helper** — WP2's `update()` (`memory-ltm.service.ts:394-411`); G3-T3
   routes lifecycle writes through it; do NOT build a second. `reembed` does not bump version.
3. **Migrations** — at most two, both decision-gated: G3 `status` column (only if indexed
   status queries needed) and G4-T3 ledger `version`. Both land after SHARED-1/SHARED-2, one
   PR each. Everything else is code-only. Never change `@@unique([userId, sourceKey])`.
4. **Embedding seam** — G2-T1 + G3-T2 + deferred G7 batch-embed all touch
   `create()`/`resolveEmbedding()`; any batch refactor must honor `embeddingExcluded`.

## Resume protocol

1. `cd /home/qp/Cloud/Projects/engram-gaps-critical`; `pnpm install --frozen-lockfile`;
   `pnpm db:generate` (Prisma client is gitignored — regenerate on fresh checkout).
2. Read the plan + this file; find the first ⬜ row in the execution order; build it per the
   plan task card; add tests at BOTH service and wiring level; run
   `build`/`lint`/`typecheck`/`test`(/`docs:check`); commit as one conventional commit;
   flip the row to ✅.
3. When a task needs a policy call not covered by the pinned decisions above, ask qp first.
