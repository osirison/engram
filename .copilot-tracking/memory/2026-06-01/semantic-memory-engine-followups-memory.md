<!-- markdownlint-disable-file -->

# Memory: semantic-memory-engine-followups

**Created:** 2026-06-01 01:20 | **Last Updated:** 2026-06-01 01:20

## Task Overview

RPI Agent, `continue=all`: execute ALL 5 items from the most recent Phase 5
Suggested Next Work list (a second enhancement wave on top of the already-complete
first wave: #106 pgvector, #110 hybrid search, #112 reindex, #113 CI eval, #114
latency), then run final validation, present commit message + MR guidance, and run
Phase 5 Discover.

- Branch: `feat/semantic-memory-engine-98` (feature branch off `main`).
- Repo: `osirison/engram`. Monorepo: Turborepo + pnpm@11.4.0.
- User prefs: investment-banking-grade security, highest code quality, comprehensive
  unit tests, documentation updates, branch-per-epic, MR completion guidance, prefer
  respected OSS libraries.

**Status: ALL 5 ITEMS + FINAL VALIDATION COMPLETE. Awaiting user decision on Phase 5 Discover options or commit/push.**

## Current State

All 5 items coded, tested, documented, and validated GREEN:

1. **Reindex admin MCP tool + CLI** — `reindex_memories` MCP tool (8 tools total),
   `reindex` npm script + `apps/mcp-server/src/reindex.cli.ts`, service passthrough,
   README. Tests: mcp-server 116 jest pass.
2. **Latency adapters + bench CLI (eval)** — `packages/eval/src/latency-adapters.ts`
   (`createVectorStoreLatencyTarget`), `packages/eval/src/bench.ts` (`bench` CLI),
   README. eval 64 tests pass.
3. **Hybrid RRF fusion retriever** — `packages/eval/src/retrievers/fusion-retriever.ts`
   (`reciprocalRankFusion`, `createFusionRetriever`, `DEFAULT_RRF_K=60`), README.
4. **Embedding retriever eval scoring** —
   `packages/eval/src/retrievers/embedding-retriever.ts` (`cosineSimilarity`,
   `createEmbeddingRetriever`), README.
5. **pgvector HNSW tuning + health check** — `PgVectorOptions` (m/efConstruction/
   efSearch), `healthCheck()`, `PgVectorHealthIndicator`, env schema PGVECTOR*HNSW*\*,
   `.env.example`, `turbo.json` globalEnv, README. vector-store 52 pass/3 skip.

Final validation (per-package direct binaries — turbo via pnpm is broken):

| Package      | Typecheck             | Tests                | Lint     |
| ------------ | --------------------- | -------------------- | -------- |
| eval         | tc=0                  | 64 pass              | 0 errors |
| vector-store | tc=0                  | 52 pass/3 skip       | 0 errors |
| config       | tc=0                  | 25 pass              | 0 errors |
| memory-ltm   | tc=0                  | —                    | clean    |
| mcp-server   | tc=0 (build tsconfig) | 116 pass (12 suites) | clean    |

This session's incremental edits (Item 5 docs finish + config tests):

- `.env.example` — added VECTOR*BACKEND/VECTOR_DIMENSIONS + commented PGVECTOR_HNSW*\* block.
- `turbo.json` — added PGVECTOR_HNSW_M/EF_CONSTRUCTION/EF_SEARCH to globalEnv (clears lint warnings).
- `packages/config/src/env.schema.spec.ts` — added 4 tests for PGVECTOR*HNSW*\* coercion/range/defaults (now 25 tests).

## Important Discoveries

- **Validation workaround:** turbo tasks via pnpm fail (ERR_PNPM_IGNORED_BUILDS).
  Use package-local binaries: `../../node_modules/.bin/tsc`, `./node_modules/.bin/vitest run`,
  `./node_modules/.bin/jest`. mcp-server typecheck: `cd apps/mcp-server &&
../../node_modules/.bin/tsc -p tsconfig.build.json --noEmit`.
- **Cross-package types:** Rebuild dependency dist (`../../node_modules/.bin/tsc`)
  before consumer typecheck — consumers resolve types via dist index.d.ts. Rebuild
  config + vector-store + memory-ltm dist before mcp-server typecheck.
- **tsconfig bases:** commonjs root base (vector-store/config/core/database, NO .js
  ext); NodeNext @repo/typescript-config/base.json (eval, embeddings — REQUIRE .js
  ext, noUncheckedIndexedAccess:true). mcp-server uses NestJS tsconfig.
- **docs:check** exits 1 but ALL failures are pre-existing (speckit prompts/agents,
  .copilot-tracking broken links) — NONE from my files.
- Embeddings are 1536 dims. vitest `toEqual` ignores undefined-valued keys.
- **Failed approach (fixed):** embedding-retriever minScore test used 0.95 but
  `dog`[0.9,0.1,0] vs `cat`[1,0,0] scores ~0.994 — changed threshold to 0.999.
- **Failed approach (fixed):** adding 8th MCP tool broke mcp-tools.integration.spec
  hardcoded "7 tools" assertion — bumped to 8 + added reindex_memories assertion + ltmMock.reindex.
- **Lesson:** Adding a constructor param to a NestJS-injected class requires updating
  ALL test modules that provide/`new` it (health.controller.spec, health.integration.spec).

## Next Steps

1. Await user choice on Phase 5 Discover options (presented 5 follow-ups):
   1. Wire fusion + embedding retrievers into eval harness scored run.
   2. Reindex job queue + progress/resumability (BullMQ, cursor batching).
   3. pgvector integration test in CI with real Postgres+vector service.
   4. Expose pgvector health in readiness probe + metrics.
   5. Backend benchmark CI gate (bench CLI: pgvector vs qdrant).
2. On request: stage/commit (commit message already drafted) and open MR to `main`,
   `Closes #98` (and #106/#110/#112/#113/#114 if PR encompasses them).

## Context to Preserve

- **Commit message drafted:** `feat(memory): add reindex tooling, eval retrievers,
and pgvector HNSW tuning` — EXCLUDE `.copilot-tracking` files. Refs #98.
- **Note:** Working tree also holds prior semantic-memory-engine batch (pgvector
  backend #106, hybrid #110, etc.). If user prefers separate commits per epic, stage
  selectively.
- **Agents:** none invoked this segment (memory excluded).
- **Question:** Single combined commit vs. per-epic commits — pending user preference.
- **Uncompacted transcript (pre-compaction details):**
  `/home/qp/.config/Code/User/workspaceStorage/01f51cdb1b920c1c8e596473a3d8d617/GitHub.copilot-chat/transcripts/65458340-732d-4175-babe-cde1294d726f.jsonl`

## 2026-06-01 Continue=All Execution Update

Executed all 5 follow-up items from the latest Discover list in a second pass.

1. **Wire retrievers into scored eval run**
   - Updated `packages/eval/src/run.ts` to execute keyword, embedding, and hybrid
     fusion retrievers in one run.
   - Added deterministic hash-embedding function for reproducible embedding and
     fusion scoring in CI.
   - Regression gate now evaluates hybrid fusion quality floors.

2. **Queued reindex with progress/resumability**
   - Added `apps/mcp-server/src/memory/reindex-queue.service.ts` with persisted
     Redis-backed job state (`queued|running|completed|failed`).
   - Added new MCP tools in `apps/mcp-server/src/memory/memory.controller.ts`:
     `queue_reindex_memories` and `get_reindex_status`.
   - Added DTO schema `apps/mcp-server/src/memory/dto/reindex-job.dto.ts`.
   - Reindex cursor semantics improved in `packages/memory-ltm/src/memory-ltm.service.ts`
     and `packages/memory-ltm/src/types.ts` to return resumable cursors when capped.

3. **pgvector integration test in CI**
   - Updated `.github/workflows/ci.yml` to set `PGVECTOR_TEST_URL` for test runs.
   - Added explicit `@engram/vector-store` pgvector integration test step.

4. **Expose pgvector health in readiness + metrics**
   - Updated `apps/mcp-server/src/health/health.controller.ts` with:
     - `GET /health/ready` endpoint.
     - `engram_vector_backend_info` and `engram_pgvector_ready` metrics.
   - Updated health controller tests accordingly.

5. **Backend benchmark CI gate (pgvector vs qdrant)**
   - Added CLI script `scripts/bench-vector-backends.mjs` benchmarking both
     backends against seeded fixtures.
   - Added root scripts in `package.json`: `bench:backends`, `bench:ci`.
   - Updated `.github/workflows/ci.yml` with Qdrant service + benchmark gate step.

## Validation (second pass)

- `packages/eval`: `tsc --noEmit`, vitest (`65 passed`)
- `packages/memory-ltm`: `tsc --noEmit`, vitest reindex suite (`7 passed`)
- `apps/mcp-server`: targeted Jest suites passed (`20 passed`)
- Diagnostics for changed TypeScript files: no errors

## Current Status

Continue=all execution is **complete**. Branch remains
`feat/semantic-memory-engine-98` and is already pushed to origin.

## 2026-06-01 Continue=All Execution Update (Wave 3)

Executed the next Discover set (`continue=all`) and completed all 3 items:

1. **Reindex cancel/retry controls**
   - Added queue lifecycle operations in
     `apps/mcp-server/src/memory/reindex-queue.service.ts`:
     - `cancel(jobId)` (queued => cancelled, running => cancelRequested)
     - `retry(jobId)` for failed/cancelled jobs from saved cursor
   - Added MCP tools in
     `apps/mcp-server/src/memory/memory.controller.ts`:
     - `cancel_reindex_job`
     - `retry_reindex_job`
   - Added DTO schemas in
     `apps/mcp-server/src/memory/dto/reindex-job.dto.ts`.

2. **Benchmark artifact export in CI**
   - Enhanced `scripts/bench-vector-backends.mjs` with `--output/-o` JSON report.
   - Updated `package.json` script `bench:ci` to emit
     `artifacts/bench-results.json`.
   - Added upload step in `.github/workflows/ci.yml` via
     `actions/upload-artifact@v4` (always run, ignore missing file).

3. **Admin auth guard for maintenance tools**
   - Required `adminToken` in admin schemas:
     - `apps/mcp-server/src/memory/dto/reindex.dto.ts`
     - `apps/mcp-server/src/memory/dto/reindex-job.dto.ts`
   - Added `assertAdminAuthorized` check in
     `apps/mcp-server/src/memory/memory.controller.ts` against
     `MCP_ADMIN_TOKEN`.
   - Documented env/config updates in `.env.example` and `apps/mcp-server/README.md`.

## Validation (wave 3)

- Jest: `apps/mcp-server` targeted suites passed
  (`memory.controller.spec.ts`, `reindex-queue.service.spec.ts`) => **20 tests passed**.
- Diagnostics (`get_errors`) on changed TypeScript + workflow + benchmark files:
  **no errors**.
- Local benchmark smoke run hit environment/runtime limits (Qdrant client/server
  version mismatch and local Postgres missing pgvector extension), but script
  argument parsing + artifact path logic are implemented and CI environment uses
  dedicated services.

## 2026-06-01 Continue=All Execution Update (Wave 4)

Executed the latest Discover set (`continue=all`) and completed all 3 items:

1. **Queue persistence hardening (terminal reasons + immutable audit trail)**
   - Extended reindex job model in
     `apps/mcp-server/src/memory/reindex-queue.service.ts` with:
     - `terminalReason` (`completed_success`, `cancelled_before_start`,
       `cancelled_by_request`, `failed_runtime`)
     - immutable `events[]` audit timeline (enqueue/start/progress/cancel/fail/complete/retry)
   - Adjusted processing loop to carry forward event-enriched snapshots so audit
     history is preserved across all transitions.
   - Updated queue unit tests in
     `apps/mcp-server/src/memory/reindex-queue.service.spec.ts`.

2. **Benchmark trend comparison against latest successful main baseline**
   - Added baseline fetch script:
     `scripts/fetch-benchmark-baseline.mjs`
     (GitHub Actions API, latest successful `main` run, benchmark artifact extraction).
   - Added trend gate script:
     `scripts/compare-benchmark-trend.mjs`
     (p95 delta checks vs baseline; emits `bench-trend-summary.json`).
   - Added npm scripts in `package.json`:
     - `bench:baseline:fetch`
     - `bench:trend:check`
   - Updated `.github/workflows/ci.yml` to:
     - fetch baseline artifact
     - run trend-delta gate
     - upload current/baseline/trend artifacts.

3. **Integration tests for admin guards + maintenance handlers**
   - Extended MCP integration suite:
     `apps/mcp-server/test/mcp-tools.integration.spec.ts`
   - Added `ReindexQueueService` mock provider to integration module setup.
   - Updated tool registration assertions to 12 tools.
   - Added handler-level scenarios covering:
     - missing `adminToken` rejection
     - invalid token rejection
     - valid-token queue/status/cancel/retry success path.

## Validation (wave 4)

- `apps/mcp-server` targeted Jest suites:
  - `src/memory/reindex-queue.service.spec.ts` ✅
  - `src/memory/memory.controller.spec.ts` ✅
  - `test/mcp-tools.integration.spec.ts` ✅
- benchmark trend script success path validated with synthetic fixtures
  (`bench-trend-summary.json` generated with `passed=true`).
- diagnostics on changed queue/scripts/workflow/package files report no errors.
