---
title: Cross-Cutting Gaps G1–G4 — Execution State
description: Resumable execution tracker for the critical/high gap remediation (G1 authz, G2 import secret-scan, G3 memory lifecycle, G4 concurrent-writer safety) on branch feat/gaps-critical-g1-g4
---

# G1–G4 Remediation — Execution State

Companion to [`GAPS-G1-G4-PLAN.md`](./GAPS-G1-G4-PLAN.md) (the plan: what to build, why,
and the shared seams). **This file tracks execution** (built + verified?) and pins qp's
decisions so any resume is unambiguous. Batch 1 (rows 1–4) merged as **#255**
(`cc10108`); the branch/worktree for it are gone. Remaining execution runs as batches
**B2–B5** defined in [`WRAPUP-PLAN.md`](./WRAPUP-PLAN.md) — one worktree/branch per
batch, orchestration + resume protocol there.

- **Last updated:** 2026-07-12 — wrap-up campaign started; decisions 7–10 pinned;
  batch mapping: B2 = G2-T2, G2-T3, G1-T3, G1-T1 · B3 = G3-T3, G4-T2, G1-T2 ·
  B4 = G3-T4, G3-T6, G4-T3, G4-T4-deferral · B5 = G3-T2.
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
4. **G2 `flag` semantics = redact + exclude from embedding** (Decision 3). Under `flag`,
   stored content is redacted AND the row is `embeddingExcluded`; a has-secret review tag
   flags it. No raw secret ever lands in Postgres — `flag` differs from `redact` only by the
   review tag. Frontmatter scan (G2-T2) follows the same redact-in-place stance (Decision 6).
5. **G4 import-vs-agent-edit race = CAS-skip** (Decision 13). Import does version CAS; on
   conflict it SKIPS and records a `skippedConcurrentEdit` count in the summary — never
   clobbers the agent edit.
6. **G4-T4 STM Lua CAS = DEFERRED** (Decision 14). STM is TTL-bounded/low-stakes; document
   the deferral, don't build the Lua script this round. G4-T4 row → deferred, not done.

## Decisions (pinned by qp, 2026-07-12 — wrap-up campaign)

7. **G1-T2 = distinct API keys per agent, ONE userId (`qp`)** (plan Decision 2).
   Attribution via `MemoryAudit.actorId`; shared memory pool intact; no tenancy split.
8. **`status`/`supersededBy` stay in metadata JSON — no status-column migration**
   (plan Decision 8). JSON scans accepted at current volume. The only schema change
   this campaign is G4-T3's `MemoryImportSource.lastWrittenVersion`.
9. **G3-T6 stays deterministic — no LLM dependency, not even config-gated**
   (plan Decision 11). Preserves "runs without external services".
10. **Scope = everything outstanding** (G1–G4 remainder + WP6 content + WP1
    remediation), sequenced per `WRAPUP-PLAN.md`. Plan Decision 4 (promote the 5
    import-specific scanner patterns into `PrivacyFilterStep`) stays out of scope.

## Execution order (from plan §5, adapted to the decisions above)

Legend: ✅ done+verified · 🟨 in progress · ⬜ not started.

| Order | Task                                                       | Size | Level | Status | Commit / note                                                                                                                                                                                                                                |
| ----- | ---------------------------------------------------------- | ---- | ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **G3-T1** recall drops/flags superseded                    | S    | crit  | ✅     | default-exclude in semanticSearch + transient path; keys on supersededBy                                                                                                                                                                     |
| 2     | **G3-T5** validate+document lifecycle config               | S    | high  | ✅     | 9 MEMORY\_\* vars in env.schema (boot-validated) + .env.example + docs table                                                                                                                                                                 |
| 3     | **G4-T1** concurrency policy ADR (doc)                     | S    | high  | ✅     | docs/concurrency-policy.md + GAPS.md G4 status; pins Dec 12/13/14                                                                                                                                                                            |
| 4     | **G2-T1** enforce `embeddingExcluded` (create+reindex)     | M    | high  | ✅     | create+reindex honor the flag; `flag` now redacts (Dec 3). Spy-count tests                                                                                                                                                                   |
| 5     | **G2-T2** scan frontmatter + title                         | M    | high  | ✅     | B2: redact-in-place incl. nested values; flag = redact+exclude+tag. Residual (new, out of scope): adapter-derived tags/link locators computed pre-scan could echo a frontmatter secret slug                                                  |
| 6     | **G2-T3** correct IMPORT.md flag/reindex claims            | S    | high  | ✅     | B2: policy table matches enforced behavior; --no-embed workaround dropped                                                                                                                                                                    |
| 7     | **G1-T1** engage-ready auth + extend boot fail-safe + docs | S    | crit  | ✅     | B2: fail-safe now every NODE_ENV; ALLOW_UNAUTHENTICATED_HTTP boot-validated; ⚠ local unit needs the ack before restart (WRAPUP-PLAN §H3)                                                                                                     |
| 8     | **G3-T3** lifecycle writes → version CAS + audit           | M    | crit  | ✅     | B3: casMetadataUpdate mirrors update() where; retry-once-from-fresh then skip; prune/supersede audit rows restorable; access writes CAS-guarded but NON-bumping (avoids read-then-update self-409 with G4-T2)                                |
| 9     | **G4-T2** enforce/observe optimistic concurrency on update | M    | high  | ✅     | B3: expectedVersion REQUIRED at tool boundary, CONFLICT-class actionable error; ADR Decision 12 marked enforced; service signatures unchanged                                                                                                |
| 10    | **G1-T2** per-agent key provisioning + docs                | M    | high  | ✅     | B3: provision-agent-keys CLI (distinct eng\_ keys, one userId, --rotate); wiring spec proves distinct audit actorIds; agent-keys.md extended                                                                                                 |
| 11    | **G1-T3** import path allowlist/traversal guard (A18)      | S    | high  | ✅     | B2: IMPORT_ALLOWED_ROOT (default $HOME), realpath containment, dryRun too                                                                                                                                                                    |
| 12    | **G3-T4** both-kept-flagged contradiction policy           | M    | high  | ✅     | B4: MEMORY_CONTRADICTION_POLICY default flag; both rows status=contradicted + review fields + contradicts MemoryLink; still surface in recall                                                                                                |
| 13    | **G4-T3** import-vs-agent-edit concurrency policy          | M    | high  | ✅     | B4: ledger lastWrittenVersion (the one migration) + CAS-skip w/ skippedConcurrentEdit; sync --force can no longer clobber; NULL rows one-last-LWW-then-backfill                                                                              |
| 14    | **G3-T6** stronger contradiction detection                 | M    | high  | ✅     | B4: deterministic same-subject value-swap (copular + relational patterns); elaborations don't fire; no LLM (Dec 9)                                                                                                                           |
| 15    | **G4-T4** STM atomic Lua CAS                               | M    | high  | ⏸️     | DEFERRED (Decision 14, pinned in concurrency-policy.md): ms window on TTL-bounded STM accepted; revisit only on observed interleaving                                                                                                        |
| 16    | **G3-T2** periodic corpus consolidation (dry-run gated)    | L    | crit  | ✅     | B5: CorpusConsolidationService clusters [merge, dup) band; canonical = importance→recency; losers superseded + duplicate-of link + audit via G3-T3 CAS; `consolidate_corpus` dryRun defaults TRUE; scheduler default OFF (Dec 3 review gate) |

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

1. Follow [`WRAPUP-PLAN.md`](./WRAPUP-PLAN.md) §0 (global protocol) + §1 (batch
   tracker): one worktree per batch, first non-✅ batch wins.
2. Per task: build per the plan task card + the batch's decision deltas
   (`WRAPUP-PLAN.md` §2); tests at BOTH service and wiring level; run
   `build`/`lint`/`typecheck`/`test`/`docs:check`; one conventional commit per task,
   push immediately; flip the row here in the batch's tracker commit.
3. When a task needs a policy call not covered by the pinned decisions above, ask qp first.
