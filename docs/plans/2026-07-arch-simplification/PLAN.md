---
title: Architecture Simplification — Postgres-only default stack
description: Remove Redis and Qdrant; collapse profiles to lite + standard; Postgres + pgvector as the only backing service
---

# Architecture Simplification — Postgres-only default stack

Decision (qp, 2026-07-19): remove Redis and Qdrant from the stack; collapse the
deployment-profile ladder from `memory`/`lite`/`enterprise` to **`lite` +
`standard`** (`standard` is the default when `DEPLOYMENT_PROFILE` is unset).
Target architecture: **Postgres + pgvector as the only backing service**.
TypeScript stays (no Rust migration — evaluated 2026-07-18, workload is
I/O-bound; see PR discussion).

## Why

- Qdrant: pgvector backend is at (or above) feature parity through
  `VECTOR_STORE_TOKEN`; nothing Qdrant-only is used; scale ceiling is 10k
  memories/user; compose already runs `pgvector/pgvector:pg17`.
- Redis: no BullMQ/pub-sub/locks. Usages are STM KV+TTL (Prisma `Memory`
  schema already has `type`/`expiresAt`/`@@index([expiresAt])`), an **inert**
  embedding cache (DI bug — never wired in production), a reindex-status JSON
  blob, and enterprise auth stores (rate-limit, session/OAuth-state, JWT
  denylist) that map to Postgres tables.

## Fixed decisions (do not re-litigate)

1. Profile names: `lite` and `standard`. Unset `DEPLOYMENT_PROFILE` →
   `standard`. `standard` = Postgres + pgvector, multi-tenant auth stack.
   `lite` keeps today's semantics (single-user, no auth/org stack).
2. STM moves to Postgres rows (`type='short-term'`, `expiresAt` set), UUID ids
   preserved, `accessCount`/`ttl` in `metadata` JSON (house style — LTM already
   does this for `accessCount`). `version` uses the Int column with a true CAS
   (`updateMany` guarded on version) — upgrade over Redis read-compare-set.
3. STM update semantics: preserve `expiresAt` unless `ttl` explicitly provided
   (the WP2-T3/D4 behavior; the in-memory adapter is the reference, NOT the
   Redis service which resets expiry on every update).
4. Expiry: filter-on-read everywhere + periodic sweep
   (`STM_SWEEP_INTERVAL_MS`, default 600000, 0=off).
5. Embedding Redis cache: **delete** (it never ran — `EmbeddingsModule`
   imported the bare `RedisModule` class, so `@Optional()` redis was always
   undefined). No replacement; Ollama is local and embeddings persist on rows.
6. Qdrant: delete backend + module + health indicator + compose services +
   `VECTOR_BACKEND` env (pgvector becomes the only backend). Keep the
   `VectorStore` interface + `VECTOR_STORE_TOKEN` abstraction.
7. Known Qdrant tag-filter bug (MatchAny=OR vs contract contains-all) dies
   with the Qdrant backend; pgvector is contract-correct.
8. Existing deployments switch with a one-time unscoped reindex that REUSES
   stored embeddings (`reuseExistingEmbeddings: true` / CLI without
   `--regenerate`) — no re-embedding.

## Work packages (one PR each, in order)

- **WP1** `feat/stm-postgres-adapter` — `PostgresStmAdapter` in
  packages/memory-stm implementing the full STM surface (create/findById/
  update/delete/list/getTtl/extendTtl/count/clear/findCandidates/promote);
  sweep service in apps/mcp-server; `MemoryStmModule.forRoot` selects it when
  `capabilities.requiresDatabase` (memory profile keeps InMemoryStmAdapter);
  delete dead embedding-cache path from packages/embeddings. Tests: adapter
  unit (mocked Prisma), module wiring per profile, sweep unit.
- **WP2** `feat/postgres-auth-stores` — Prisma models `KvEntry` (sessions,
  OAuth state, JWT denylist; KV+TTL+atomic getDelete via
  `DELETE..RETURNING`) and `RateLimitCounter` (fixed-window atomic
  `INSERT..ON CONFLICT..RETURNING`); Postgres `ReindexJob` row replaces the
  Redis status blob so queue tools work in every DB profile. Migration +
  service/wiring tests.
- **WP3** `feat/remove-qdrant` — decouple `VectorStoreModule` factory from
  `QdrantService`; delete qdrant backend/module/health; drop `VECTOR_BACKEND`
  (pgvector only); compose + docs.
- **WP4** `feat/two-profile-ladder` — profiles → `lite`/`standard`; delete
  `packages/redis`, `MemoryStmService` (Redis impl), `REDIS_URL`,
  requiresRedis/requiresQdrant capability flags; compose/.env.example/README/
  CLAUDE.md/docs sweep; fix all profile references incl. migration module and
  e2e configs.
- **WP5** — migrate qp's local systemd deployment (port 3100): set profile,
  drop redis/qdrant containers, one-time reindex reusing embeddings, verify
  recall; close out STATE.

## Constraints

- Full ship cycle per PR: commit → push → PR → CI green + comments resolved →
  merge → delete branch. Never `--no-verify`. Never regenerate pnpm-lock.yaml
  wholesale. Commit body ≤300 chars. Conventional commits.
- Tests at BOTH the service level and the wiring/parent-module level.
- Postgres stays source of truth; per-item reindex failures counted+skipped.
