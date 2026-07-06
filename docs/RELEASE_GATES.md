---
title: ENGRAM Release Gates
description: Measurable SLOs, reliability, security, and coverage gates that must pass before a release
---

## Purpose

This document records the measurable quality gates that the ENGRAM
profile ladder must pass before a release. Gates are organised by
profile, plus a cross-cutting reliability, security, and coverage
section. Every gate is enforceable from CI; see
`.github/workflows/profile-matrix.yml` for the wiring.

If a gate fails, the release is blocked. The gate owner is responsible
for triaging the failure, deciding whether to ship a fix-forward
release, or rolling back.

## Performance SLOs

SLOs are measurable from synthetic probes and benchmarks. Each profile
ships its own targets because the durability / scale tradeoffs differ.

### profile-memory

| Objective            | Target                    | Measurement                                                   |
| -------------------- | ------------------------- | ------------------------------------------------------------- |
| Cold-start           | `<= 5s` P95               | Wall-clock from `node main.js` to first `GET /health` 200     |
| Warm recall P95      | `<= 80ms` at 10k memories | `pnpm bench:backends` against the in-process retriever        |
| Health probe         | `<= 50ms` P95             | Synthetic `GET /health` against the live process              |
| Memory footprint     | `<= 256MB` resident       | RSS measured after warmup with 10k memories loaded            |
| MCP tool latency P95 | `<= 50ms`                 | Wrapper-level timing in `MemoryController` instrumented tests |

The `profile-memory` profile does not have a vector store, so the
warm-recall benchmark exercises the lexical postings + cosine rerank
path in `HybridTransientRetriever`.

### profile-lite

| Objective            | Target                     | Measurement                                                   |
| -------------------- | -------------------------- | ------------------------------------------------------------- |
| Cold-start           | `<= 8s` P95                | Wall-clock from `node main.js` to first `GET /health` 200     |
| Warm recall P95      | `<= 100ms` at 50k memories | `pnpm bench:backends` with the `pgvector` backend             |
| Health probe         | `<= 75ms` P95              | Synthetic `GET /health` against the live process              |
| File-store write     | `<= 30ms` P95              | Local `LiteJsonStore.create` against `LOCAL_DATA_DIR`         |
| MCP tool latency P95 | `<= 75ms`                  | Wrapper-level timing in `MemoryController` instrumented tests |

### profile-enterprise

The `profile-enterprise` profile maintains the existing benchmark
guardrail: a regression budget of `<= 20ms` P95 against the
`main` baseline. CI fetches the baseline from the latest `main` run
artifacts and compares the current run; a delta above the budget fails
the gate.

```bash
pnpm bench:baseline:fetch
pnpm bench:ci
pnpm bench:trend:check --max-p95-delta 20
```

| Objective          | Target                | Measurement                                               |
| ------------------ | --------------------- | --------------------------------------------------------- |
| Cold-start         | `<= 12s` P95          | Wall-clock from `node main.js` to first `GET /health` 200 |
| Health probe       | `<= 100ms` P95        | Synthetic `GET /health` against the live process          |
| Trend regression   | `<= 20ms` P95 delta   | `pnpm bench:trend:check`                                  |
| Reindex throughput | `>= 200` memories / s | `pnpm --filter mcp-server reindex -- --max 5000`          |
| Queue throughput   | `>= 200` memories / s | Background reindex job polled via `get_reindex_status`    |

## Recall quality gate

Because agents now use ENGRAM as their primary memory, recall quality cannot be
allowed to silently regress. The gate runs the hybrid fusion retriever over a
sanitized, deterministic fixture set (`packages/eval` — no DB, network, or API
key required) and fails the build when any metric drops below its pinned floor.

| Objective       | Target    | Measurement      |
| --------------- | --------- | ---------------- |
| Fusion recall@5 | `>= 0.90` | `pnpm eval:gate` |
| Fusion MRR      | `>= 0.95` | `pnpm eval:gate` |
| Fusion nDCG@5   | `>= 0.90` | `pnpm eval:gate` |

Floors are defined in `packages/eval/src/thresholds.ts` (`RECALL_GATE_THRESHOLDS`)
and enforced by the "Run recall-quality regression gate" step in
`.github/workflows/ci.yml`. Current baseline: recall@5 91.7%, MRR 1.000, nDCG@5
0.922. A deliberately broken ranking weight makes the gate red.

## Reliability Gates

Reliability gates are enforced by the integration test suite and the
migration SLO research. Each gate maps to one or more executable
artefacts.

| Gate                                      | Test / probe                                                            | Threshold                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Zero unreconciled records after migration | `apps/mcp-server/src/__tests__/migration-full-path.integration.spec.ts` | `report.globalMismatchFraction === 0`                                 |
| Zero data loss during migration chaos     | `apps/mcp-server/src/__tests__/migration-chaos.integration.spec.ts`     | Resume cursor == last persisted cursor                                |
| Rollback keeps source readable            | `apps/mcp-server/src/__tests__/migration-rollback.spec.ts`              | `verifier` failure auto-aborts to `rollback`; source CRUD still works |
| 99% startup success over 30-day window    | Synthetic probe counter in production                                   | `<= 1%` failed `GET /health/ready` per 24h                            |
| Verifier hard-stop                        | `apps/mcp-server/src/migration/verifier.service.ts`                     | mismatch fraction `<= 0.00001` advances; above auto-aborts            |
| Migration cutover P95 downtime            | Runbook timer                                                           | `<= 2 minutes` P95; `<= 5 minutes` P99                                |
| Migration rollback trigger                | Runbook timer                                                           | `<= 10 minutes` from detection to rollback start                      |

The migration integration tests are part of the
`migration-lite-to-enterprise` job in
`.github/workflows/profile-matrix.yml`.

## Security Gates

Security gates are enforced by unit tests in `@engram/memory-lite` and
`apps/mcp-server`, plus the secure-startup checks that run at process
boot.

| Gate                                              | Test / probe                                                                               | Threshold                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| All secrets redacted in logs                      | `apps/mcp-server/src/__tests__/secret-redaction.spec.ts`                                   | `pino` redaction paths cover every sensitive field at root + nested |
| Admin token uses constant-time comparison         | `apps/mcp-server/src/__tests__/admin-token-constant-time.spec.ts`                          | `crypto.timingSafeEqual` for every call                             |
| Encryption enabled by default for `profile-lite`  | `packages/memory-lite/src/__tests__/lite-store.spec.ts` + `permission-enforcement.spec.ts` | Records on disk are AES-256-GCM ciphertext                          |
| Permission enforcement on `LOCAL_DATA_DIR`        | `packages/memory-lite/src/__tests__/permission-enforcement.spec.ts`                        | `0700` dir / `0600` file; refuses loose modes                       |
| Insecure mode refused in production               | `packages/memory-lite/src/__tests__/permission-enforcement.spec.ts`                        | `LOCAL_INSECURE_MODE=true` + `NODE_ENV=production` => boot fail     |
| Missing key refused in production                 | `packages/memory-lite/src/__tests__/permission-enforcement.spec.ts`                        | `NODE_ENV=production` + no key => boot fail                         |
| Audit logging on every admin call                 | `apps/mcp-server/src/memory/memory.controller.ts` (assertAdminAuthorized)                  | `admin_auth_ok` / `admin_auth_denied` emitted for every call        |
| Migration verifies per-user + global count + hash | `apps/mcp-server/src/migration/verifier.service.ts`                                        | `report.totalChecked === liteTotal`; hash match                     |

## Coverage Gates

The release enforces a `>= 85%` coverage threshold on the new code
paths introduced by the profile ladder (profile resolver, profile-aware
adapters, retrieval, migration, verifier, secure-startup, and
admin-token utilities). Coverage is enforced per workspace using the
existing `pnpm --filter mcp-server test:cov` script.

| Code path                                                         | Coverage target | How it is measured                           |
| ----------------------------------------------------------------- | --------------- | -------------------------------------------- |
| `packages/config/src/profile.ts`                                  | `>= 95%`        | `pnpm --filter config test` + `test:cov`     |
| `packages/memory-stm/src/adapters/inmemory-stm.adapter.ts`        | `>= 90%`        | `pnpm --filter memory-stm test`              |
| `packages/memory-ltm/src/adapters/inmemory-ltm.adapter.ts`        | `>= 90%`        | `pnpm --filter memory-ltm test`              |
| `packages/memory-ltm/src/retrieval/hybrid-transient-retriever.ts` | `>= 90%`        | `pnpm --filter memory-ltm test`              |
| `packages/memory-lite/src/**`                                     | `>= 90%`        | `pnpm --filter memory-lite test` (vitest)    |
| `apps/mcp-server/src/migration/**`                                | `>= 85%`        | `pnpm --filter mcp-server test` + `test:cov` |
| `apps/mcp-server/src/security/**`                                 | `>= 90%`        | `pnpm --filter mcp-server test` + `test:cov` |
| `apps/mcp-server/src/health/memory-store.health.ts`               | `>= 90%`        | `pnpm --filter mcp-server test` + `test:cov` |

Coverage deltas on existing code paths must not regress more than
`0.5%` per workspace.

## Backward-Compatibility Gates

`profile-enterprise` is the contract the existing operators depend on.
The following gates confirm that the profile ladder did not break the
historical behaviour.

| Gate                                                        | Probe                                                         | Threshold                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Health endpoint includes all four indicators                | `pnpm --filter mcp-server test -- --testPathPattern='health'` | `process`/`database`/`redis`/`qdrant` all `up`                                 |
| All 19 MCP tools present in `profile-enterprise`            | `apps/mcp-server/src/memory/memory.controller.spec.ts`        | Tool count = 19                                                                |
| `reindex_memories` / `queue_reindex_memories` admin-guarded | `apps/mcp-server/test/mcp-tools.integration.spec.ts`          | Both reject missing/wrong admin token                                          |
| Reindex CLI flags unchanged                                 | `pnpm --filter mcp-server reindex --help`                     | `--user`, `--batch-size`, `--max`, `--cursor`, `--regenerate` still recognised |
| Default `DEPLOYMENT_PROFILE`                                | `packages/config/src/env.schema.spec.ts`                      | Omitting the env var resolves to `enterprise`                                  |

## Enforcement Summary

The CI wiring in `.github/workflows/profile-matrix.yml` enforces:

1. `build` job — `pnpm build` with `DEPLOYMENT_PROFILE` set to
   `memory`, `lite`, and `enterprise` in parallel.
2. `lint`, `typecheck`, `test` — repository-wide gates.
3. `smoke:profile-memory` — boots the server in `profile-memory`,
   asserts that the health response is `ok` and the dependency
   indicators are absent, and that the metrics endpoint advertises the
   correct profile label.
4. `smoke:profile-lite` — same as `profile-memory` plus a Postgres
   service, an `LOCAL_ENCRYPTION_KEY`, and an assertion that
   `LOCAL_DATA_DIR` is created with mode `0700`.
5. `smoke:profile-enterprise` — full Docker-equivalent stack with
   Postgres, Redis, and Qdrant; asserts that all four health
   indicators are `up` and the reindex CLI runs cleanly.
6. `migration:lite-to-enterprise` — runs the migration integration
   test suites, including the full-path, chaos, and rollback tests.

A failure in any job blocks merge to `main` and `multi-tiered-memory`.
