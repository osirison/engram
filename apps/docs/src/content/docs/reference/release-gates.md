---
title: Release gates
description: Measurable SLOs, reliability, security, and coverage gates that must pass before an ENGRAM release.
---

<!-- Migrated from docs/RELEASE_GATES.md (WP6 T7a). -->

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

### Lite

| Objective            | Target                     | Measurement                                                   |
| -------------------- | -------------------------- | ------------------------------------------------------------- |
| Cold-start           | `<= 8s` P95                | Wall-clock from `node main.js` to first `GET /health` 200     |
| Warm recall P95      | `<= 100ms` at 50k memories | `pnpm bench:backends` against `pgvector`                      |
| Health probe         | `<= 75ms` P95              | Synthetic `GET /health` against the live process              |
| MCP tool latency P95 | `<= 75ms`                  | Wrapper-level timing in `MemoryController` instrumented tests |

### Standard

The `standard` profile maintains the existing benchmark
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

Reliability gates are enforced by the integration test suite. Each gate
maps to one or more executable artefacts.

| Gate                                   | Test / probe                          | Threshold                                  |
| -------------------------------------- | ------------------------------------- | ------------------------------------------ |
| 99% startup success over 30-day window | Synthetic probe counter in production | `<= 1%` failed `GET /health/ready` per 24h |

## Security Gates

Security gates are enforced by unit tests in `apps/mcp-server`, plus the
secure-startup checks that run at process boot.

| Gate                                      | Test / probe                                                              | Threshold                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| All secrets redacted in logs              | `apps/mcp-server/src/__tests__/secret-redaction.spec.ts`                  | `pino` redaction paths cover every sensitive field at root + nested |
| Admin token uses constant-time comparison | `apps/mcp-server/src/__tests__/admin-token-constant-time.spec.ts`         | `crypto.timingSafeEqual` for every call                             |
| Audit logging on every admin call         | `apps/mcp-server/src/memory/memory.controller.ts` (assertAdminAuthorized) | `admin_auth_ok` / `admin_auth_denied` emitted for every call        |

## Coverage Gates

The release enforces a `>= 85%` coverage threshold on the new code
paths introduced by the profile ladder (profile resolver, profile-aware
adapters, and admin-token utilities). Coverage is enforced per workspace using the existing
`pnpm --filter mcp-server test:cov` script.

| Code path                                           | Coverage target | How it is measured                           |
| --------------------------------------------------- | --------------- | -------------------------------------------- |
| `packages/config/src/profile.ts`                    | `>= 95%`        | `pnpm --filter config test` + `test:cov`     |
| `packages/memory-stm/src/adapters/**`               | `>= 90%`        | `pnpm --filter memory-stm test`              |
| `apps/mcp-server/src/security/**`                   | `>= 90%`        | `pnpm --filter mcp-server test` + `test:cov` |
| `apps/mcp-server/src/health/memory-store.health.ts` | `>= 90%`        | `pnpm --filter mcp-server test` + `test:cov` |

Coverage deltas on existing code paths must not regress more than
`0.5%` per workspace.

## Backward-Compatibility Gates

The `standard` profile is the contract the existing operators depend on. The
following gates confirm that the profile ladder did not break the historical
behaviour.

| Gate                                                        | Probe                                                         | Threshold                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Health endpoint includes all indicators                     | `pnpm --filter mcp-server test -- --testPathPattern='health'` | `memory-store`/`database`/`pgvector` all `up`                                  |
| Full MCP tool set registered in `standard`                  | `apps/mcp-server/src/memory/memory.controller.spec.ts`        | Registered tool set matches the committed reference                            |
| `reindex_memories` / `queue_reindex_memories` admin-guarded | `apps/mcp-server/test/mcp-tools.integration.spec.ts`          | Both reject missing/wrong admin token                                          |
| Reindex CLI flags unchanged                                 | `pnpm --filter mcp-server reindex --help`                     | `--user`, `--batch-size`, `--max`, `--cursor`, `--regenerate` still recognised |
| Default `DEPLOYMENT_PROFILE`                                | `packages/config/src/env.schema.spec.ts`                      | Omitting the env var resolves to `standard`                                    |

## Enforcement Summary

The CI wiring in `.github/workflows/profile-matrix.yml` enforces:

1. `build` job — `pnpm build` with `DEPLOYMENT_PROFILE` set to
   `lite` and `standard` in parallel.
2. `lint`, `typecheck`, `test` — repository-wide gates.
3. `smoke-profile-lite` — boots the server in the `lite` profile against a
   Postgres service, asserts the health response is `ok` with the
   `memory-store`, `database`, and `pgvector` indicators `up`, and that
   the metrics endpoint advertises the `lite` profile label.
4. `smoke-profile-standard` — boots the server in the `standard` profile
   against Postgres, asserts the same three health indicators are `up`,
   and runs the reindex CLI cleanly.

A failure in any job blocks merge to `main` and `multi-tiered-memory`.
