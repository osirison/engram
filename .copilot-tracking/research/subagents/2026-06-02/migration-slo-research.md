---
title: Migration SLO and Promotion Workflow Research
description: Promotion strategy from profile-memory and profile-lite into profile-enterprise with measurable migration SLO targets
author: GitHub Copilot
ms.date: 2026-06-02
ms.topic: reference
---

## Scope

This research defines an implementation-ready migration and promotion workflow from two lightweight operating modes, `profile-memory` and `profile-lite`, into `profile-enterprise`.

Current state note:

- `profile-memory`, `profile-lite`, and `profile-enterprise` are architectural targets from planning research, not implemented runtime profiles in code yet.
- The current runtime is enterprise-leaning by default and always boots Prisma, Redis, and Qdrant services.

Goals covered:

- Migration and promotion workflow quality
- Measurable SLO and SLA style targets for downtime, integrity, rollback, and verification
- Existing code and ops touchpoints
- At least two migration design alternatives with a recommendation

## Evidence

### Current enterprise-oriented runtime wiring

- Runtime module wiring is static and imports persistence dependencies unconditionally: apps/mcp-server/src/app.module.ts:5-31
- Environment validation currently hard-requires persistence endpoints: packages/config/src/env.schema.ts:10-12
- Compose stack defines Postgres, Redis, Qdrant, and `mcp-server` dependency health gates: docker-compose.yml:2-104
- Health expectations are dependency-based in docs, with `ok` only when backing services are ready: docs/SETUP.md:38-39

### Existing migration primitives already in repository

- LTM reindex is idempotent, cursor-resumable, and continues on per-item failures: packages/memory-ltm/src/memory-ltm.service.ts:589-681
- Queue-based reindex jobs support cancel, retry, progress events, and persisted cursor state: apps/mcp-server/src/memory/reindex-queue.service.ts:68-337
- Queue job state is persisted in Redis with a 24-hour TTL: apps/mcp-server/src/memory/reindex-queue.service.ts:56,326-331
- MCP admin tools expose sync and async reindex operations: apps/mcp-server/src/memory/memory.controller.ts:386-612
- Reindex tool input supports user scoping, cursor resume, capped processing, and regenerate/reuse control: apps/mcp-server/src/memory/dto/reindex.dto.ts:11-24
- Standalone reindex CLI supports `--user`, `--batch-size`, `--cursor`, `--max`, `--regenerate`: apps/mcp-server/src/reindex.cli.ts:10-16,35-57
- CLI script entrypoint exists for operations: apps/mcp-server/package.json:16
- Promotion primitive exists for single STM memory to LTM and uses DB transaction for LTM creation before STM delete attempt: packages/memory-ltm/src/memory-ltm.service.ts:416-476
- MCP tool for per-memory promotion exists: apps/mcp-server/src/memory/memory.controller.ts:299-333

### Data model and integrity baseline

- Canonical memory store is Postgres `Memory` model with content, metadata, tags, type, and embeddings: prisma/schema.prisma:26-51
- Vector data is treated as derived index, with embedding in row and optional pgvector column: prisma/schema.prisma:36-42
- LTM create/update/delete operations treat vector indexing as best-effort and non-fatal: packages/memory-ltm/src/memory-ltm.service.ts:101-104,198-207,236-239,712-731
- Embedding generation is fail-soft and can return `null` while continuing workflows: packages/embeddings/src/embeddings.service.ts:35-48,88-105
- Embedding provider can be switched via env (`openai`, `disabled`, `local`): packages/embeddings/src/embeddings.module.ts:29-37

### Existing operational scripts and runbook-level commands

- Core infra lifecycle scripts exist: package.json:24-30
- Inspector stack orchestration script exists and waits for health and UI readiness: scripts/inspector-stack-up.mjs:17-45
- Inspector profile scripts exist for up/down/logs: package.json:37-39
- Setup docs already include operational recovery commands (`docker:clean`, `db:migrate`, health probes): docs/SETUP.md:188-201
- MCP server docs already include reindex queue workflow and admin-token requirements: apps/mcp-server/README.md:59-96

### Test evidence for reliability controls

- Queue service unit tests cover queued persistence, aggregate progress, cancellation, and cursor-based retry: apps/mcp-server/src/memory/reindex-queue.service.spec.ts:23-131
- MCP integration tests cover admin token rejection and queue/cancel/retry/status success paths: apps/mcp-server/test/mcp-tools.integration.spec.ts:690-811

## SLO and SLA Targets

The following targets are practical with current ENGRAM primitives and realistic for enterprise promotion workflows.

| Objective area                         | Proposed target                                                            | Measurement method                                              | Enforcement point                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Planned cutover downtime               | P95 <= 2 minutes, P99 <= 5 minutes                                         | Time from write-freeze start to write-enable complete           | Migration runbook timers plus logs in apps/mcp-server/src/main.ts:24-38                              |
| API read availability during migration | >= 99.95% for `get_memory`, `list_memories`, `recall`                      | Synthetic probes every 30s                                      | MCP/HTTP probes and `/health` checks in docs/SETUP.md:35-36,198-201                                  |
| Data integrity, no-loss objective      | 0 unreconciled records after verification pass                             | Source vs target count and hash comparison by user and globally | Verification phase against prisma/schema.prisma:26-51                                                |
| Promotion idempotency                  | 100% safe retry for interrupted batches                                    | Re-run returns no duplicate terminal state issues               | Reindex idempotency and cursor semantics in packages/memory-ltm/src/memory-ltm.service.ts:589-681    |
| Rollback trigger time                  | <= 10 minutes from hard-failure detection to rollback start                | Alert timestamp to rollback command execution                   | Runbook with queued cancel/retry controls apps/mcp-server/src/memory/reindex-queue.service.ts:72-136 |
| Rollback completion                    | <= 30 minutes for metadata rollback, <= 2 hours for full data restore path | Start rollback to baseline health and verification pass         | `docker:clean` and DB migration restore path docs/SETUP.md:188-194                                   |
| Verification completion                | <= 15 minutes for delta verification after cutover                         | Cutover complete to verification report generated               | Post-cutover verifier job and queue status tool                                                      |

### SLA framing recommendation

Internal SLO is above. External SLA should initially be weaker until profile migration tooling is implemented:

- SLA-1: Scheduled maintenance windows with at most 15 minutes interruption
- SLA-2: Recovery point objective (RPO) of 0 for committed promoted records
- SLA-3: Recovery time objective (RTO) <= 60 minutes for severe migration failure

## Alternatives

### Alternative A: In-place dual-write plus staged backfill

Design:

1. Add profile-aware adapter layer that can read lightweight stores and enterprise stores.
2. During migration window, enable dual-write for new writes into both source profile store and enterprise LTM.
3. Backfill historical records in batches using queue reindex patterns and cursor checkpoints.
4. Cut reads to enterprise once verification passes.
5. Keep source in read-only shadow mode for rollback window.

Fit with existing code:

- Reuses resumable queue semantics and admin tooling: apps/mcp-server/src/memory/reindex-queue.service.ts:68-337 and apps/mcp-server/src/memory/memory.controller.ts:386-612
- Reuses idempotent cursor processing and per-item fail-safe behavior: packages/memory-ltm/src/memory-ltm.service.ts:589-681

Strengths:

- Lowest downtime
- Strong progressive verification
- Good rollback posture with shadow-source retention

Weaknesses:

- Requires new dual-write and profile-switching code
- Requires stricter write ordering and dedupe safeguards

### Alternative B: Snapshot export/import with hard cutover freeze

Design:

1. Stop writes for source profile.
2. Export all records to snapshot artifact.
3. Import to enterprise Postgres.
4. Run global reindex.
5. Switch traffic to enterprise.

Fit with existing code:

- Reindex and verification can reuse existing primitives.
- Snapshot tooling does not currently exist in repo.

Strengths:

- Operational simplicity
- Easier deterministic reconciliation

Weaknesses:

- Higher downtime and poor user experience for large datasets
- Heavy one-shot risk
- Larger rollback blast radius if import is partially bad

### Alternative C: Blue-green enterprise bootstrap with replay queue

Design:

1. Build new enterprise environment in parallel.
2. Replicate or replay write events from lightweight profile.
3. Validate with shadow reads.
4. Flip traffic using release switch.

Fit with existing code:

- Reindex and health tooling are reusable.
- Event replay infrastructure is not present currently.

Strengths:

- Best isolation and rollback
- Strong enterprise discipline

Weaknesses:

- Highest implementation complexity and operational overhead

## Selected Approach

Selected approach: Alternative A, in-place dual-write plus staged backfill.

Rationale:

- It leverages existing ENGRAM strengths: idempotent reindex, cursor resume, cancel/retry, and admin-gated maintenance controls.
- It gives the best downtime posture while preserving an immediate rollback path.
- It avoids requiring full event-replay platform investment up front.

Decision constraints and readiness checks:

- Add explicit profile mode configuration to env schema and bootstrap switching, because current startup requires all enterprise dependencies: packages/config/src/env.schema.ts:10-12 and apps/mcp-server/src/app.module.ts:18-31
- Add migration-state metadata and dedupe keys to prevent dual-write duplicates.
- Add promotion batch APIs rather than only single-memory promotion: apps/mcp-server/src/memory/memory.controller.ts:299-333

## Rollout Phases

### Phase 0: Foundation and guardrails

- Introduce runtime profile selector (`profile-memory`, `profile-lite`, `profile-enterprise`) in config schema.
- Refactor AppModule import graph to conditionally wire Prisma, Redis, and vector store modules by profile.
- Add migration feature flag and a run-state record for `prepare`, `copy`, `verify`, `cutover`, `rollback`.

### Phase 1: Migration plumbing

- Implement dual-write abstraction in memory write path (`create`, `update`, `delete`, `promote`).
- Add bulk promotion command/API for lightweight-to-enterprise transfer.
- Add deterministic idempotency key strategy for replay-safe writes.

### Phase 2: Backfill and online verification

- Execute staged copy batches.
- Use queue/cursor semantics for resumable progress checkpoints.
- Run online verifier to compare per-user counts, IDs, content hash, metadata hash.
- Define hard-stop threshold, for example integrity mismatch > 0.01% aborts cutover.

### Phase 3: Cutover

- Freeze writes briefly.
- Execute final delta sync.
- Switch read path to enterprise.
- Keep source profile read-only shadow for rollback hold period, recommended 24 hours.

### Phase 4: Post-cutover stabilization

- Run reindex and verification again after traffic settles.
- Monitor error budget and latency for 7 days.
- Decommission source profile data only after two successful integrity sweeps.

## Test and Verification Plan

### Automated tests to add

- Unit: dual-write success and partial-failure handling with idempotent retry
- Unit: bulk promotion cursoring and dedupe
- Integration: full migration happy path with synthetic corpus and rollback path
- E2E: migration window with concurrent reads and bounded write freeze
- Chaos: kill process during batch copy, then verify resume without duplicates

### Existing tests that can be extended

- Reindex queue lifecycle tests: apps/mcp-server/src/memory/reindex-queue.service.spec.ts:23-131
- MCP admin tool authorization and queue operations: apps/mcp-server/test/mcp-tools.integration.spec.ts:690-811

### Verification gates

- Gate 1, pre-cutover: source and target record counts match per tenant and globally
- Gate 2, pre-cutover: deterministic hash sample diff <= 0.001%
- Gate 3, post-cutover 15 minutes: read-path success >= 99.95%
- Gate 4, post-cutover 24 hours: no unresolved integrity anomalies

## Risks

### Technical risks

- Profile abstraction is not implemented yet, and current startup hard-requires enterprise services: apps/mcp-server/src/app.module.ts:18-31 and packages/config/src/env.schema.ts:10-12
- Current promotion path is single-record oriented, which is insufficient for tenant-scale migration: packages/memory-ltm/src/memory-ltm.service.ts:416-476
- Queue job state TTL is 24 hours, which may be too short for long-running migrations without external checkpoint archival: apps/mcp-server/src/memory/reindex-queue.service.ts:56,326-331
- Vector indexing is best-effort non-fatal, which protects availability but can hide quality regressions unless verification is strict: packages/memory-ltm/src/memory-ltm.service.ts:712-731

### Operational risks

- Runbook drift between docs and implementation can create cutover inconsistency.
- Redis outage during queued migration can lose transient job state beyond TTL.
- Inadequate admin-token hygiene can block or expose maintenance operations: apps/mcp-server/src/memory/memory.controller.ts:62-69

### Mitigations

- Add durable migration checkpoint storage in Postgres.
- Increase or make configurable queue-job retention for migration windows.
- Add mandatory verification report artifact before any cutover approval.
- Add two-person approval gate for rollback and source decommission actions.

## Recommended Next Research

- Define the exact schema for migration checkpoint and verification report tables.
- Prototype dual-write conflict resolution strategy for `update` and `delete` races.
- Benchmark cutover delta-sync duration at 10k, 100k, and 1M memory records.
- Specify per-profile module graph and dependency matrix in a dedicated architecture note.

## Clarifying Questions

- Should `profile-lite` be treated as durable local SQLite or as file-backed JSON store for v1 migration support?
- What is the expected maximum tenant corpus size for first enterprise promotion rollout?
- Is cross-region disaster recovery required in initial SLA, or only single-region RTO and RPO targets?
