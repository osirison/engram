---
title: Runtime Dependencies and Startup Blockers Research
description: Deep repository research on hard runtime dependencies and startup blockers for running ENGRAM MCP server without external services
author: GitHub Copilot
ms.date: 2026-06-02
ms.topic: reference
---

## Scope

Research topic: identify all hard runtime dependencies and startup blockers that prevent running ENGRAM MCP server without external services/databases.

Questions investigated:

- Which services are required at runtime by apps/mcp-server?
- Which imports/providers force Postgres, Redis, and Qdrant wiring?
- Which startup and health paths fail when services are absent?
- What is the minimum set of code changes to allow server boot without external services?

Workspace: /home/qp/Cloud/Projects/engram

## Evidence Log

1. Root app module imports and env validation wiring

- apps/mcp-server/src/app.module.ts:3 imports validateEnv from @engram/config
- apps/mcp-server/src/app.module.ts:19-24 wires ConfigModule.forRoot(validate: runValidateEnv)
- apps/mcp-server/src/app.module.ts:27-31 eagerly imports PrismaModule, RedisModule, QdrantModule, HealthModule, MemoryModule

2. Startup sequence and failure surface

- apps/mcp-server/src/main.ts:20 calls NestFactory.create(AppModule)
- apps/mcp-server/src/main.ts:26 listens only after module graph successfully initializes

3. Environment schema hard requirements

- packages/config/src/env.schema.ts:10 DATABASE_URL required
- packages/config/src/env.schema.ts:11 REDIS_URL required
- packages/config/src/env.schema.ts:12 QDRANT_URL required
- packages/config/src/env.schema.ts:42-43 validateEnv parses and throws on missing required vars

4. Postgres hard startup coupling via Prisma lifecycle

- packages/database/src/prisma.service.ts:11 reads DATABASE_URL
- packages/database/src/prisma.service.ts:13-15 throws if DATABASE_URL missing
- packages/database/src/prisma.service.ts:28-29 onModuleInit performs await this.$connect()

5. Redis wiring behavior

- packages/redis/src/redis.module.ts:11 reads REDIS_URL (fallback localhost)
- packages/redis/src/redis.module.ts:13-23 creates Redis client with lazyConnect: false and ready check enabled
- packages/redis/src/redis.module.ts:38-40 logs errors on client error events

6. Qdrant wiring behavior

- packages/vector-store/src/qdrant.module.ts:11 reads QDRANT_URL (fallback localhost)
- packages/vector-store/src/qdrant.module.ts:10-13 instantiates Qdrant client without startup health probe

7. Memory modules force DB and Redis feature graph

- apps/mcp-server/src/memory/memory.module.ts:11 imports MemoryStmModule, MemoryLtmModule, PrismaModule, RedisModule
- packages/memory-ltm/src/memory-ltm.module.ts:8 imports PrismaModule, EmbeddingsModule, VectorStoreModule
- packages/memory-stm/src/memory-stm.module.ts:7 imports RedisModule, EmbeddingsModule

8. Health paths that fail when dependencies are absent/unhealthy

- apps/mcp-server/src/health/health.controller.ts:26-32 builds indicator list with database, redis, qdrant checks always included
- apps/mcp-server/src/health/health.controller.ts:44-54 /health and /health/ready run full indicator list
- apps/mcp-server/src/health/prisma.health.ts:18 performs prisma memory.count check
- apps/mcp-server/src/health/redis.health.ts:16 calls redisService.isHealthy and throws on false
- apps/mcp-server/src/health/qdrant.health.ts:16 calls qdrantService.healthCheck and throws on false
- packages/vector-store/src/qdrant.service.ts:16-24 qdrant health check calls getCollections and returns false on failure
- packages/redis/src/redis.service.ts:142-177 redis health check actively connects/pings and returns false on failure

9. Vector backend selection still keeps Qdrant module in graph

- packages/vector-store/src/vector-store.module.ts:49 imports QdrantModule unconditionally
- packages/vector-store/src/vector-store.module.ts:55-70 selects pgvector vs qdrant implementation at provider factory
- packages/vector-store/src/vector-store.module.ts:57-61 throws if pgvector selected but PrismaService unavailable

10. Embeddings behavior is not a hard startup blocker by itself

- packages/embeddings/src/embeddings.module.ts:16 imports RedisModule (adds Redis dependency to module graph)
- packages/embeddings/src/providers/openai-embedding.provider.ts:12-16 missing OPENAI_API_KEY only disables OpenAI provider, does not throw
- packages/memory-ltm/src/memory-ltm.service.ts:49-53 embeddings/vectorStore injected optional
- packages/memory-stm/src/memory-stm.service.ts:27-30 embeddings injected optional

11. Repository docs state intended runtime dependency set

- README.md:8-10 states MCP runtime connects to PostgreSQL, Redis, Qdrant
- README.md:30-34 quick start requires docker:up and db:migrate before running mcp-server
- README.md:62 start command explicitly references PostgreSQL, Redis, Qdrant startup

12. Environment template confirms expected services and backend defaults

- .env.example:15 DATABASE_URL provided
- .env.example:20 REDIS_URL provided
- .env.example:26 QDRANT_URL provided
- .env.example:29 VECTOR_BACKEND defaults to qdrant

## Key Findings

1. Postgres is a hard boot dependency today.

- Reason: PrismaService runs connection logic during Nest module init.
- Evidence: packages/database/src/prisma.service.ts:28-29
- Result when absent: NestFactory.create(AppModule) fails before app.listen.

2. Required env vars are a hard boot dependency regardless of actual code path usage.

- Reason: validateEnv requires DATABASE_URL, REDIS_URL, QDRANT_URL unconditionally.
- Evidence: packages/config/src/env.schema.ts:10-12 and apps/mcp-server/src/app.module.ts:19-24
- Result when absent: startup fails during configuration parse.

3. Redis and Qdrant are eagerly wired in root module graph, but service reachability is not a universal boot blocker.

- Reason: modules are imported eagerly, clients are instantiated, but no global startup probe forces qdrant reachability during bootstrap.
- Evidence: apps/mcp-server/src/app.module.ts:27-31, packages/redis/src/redis.module.ts:13-23, packages/vector-store/src/qdrant.module.ts:10-13
- Nuance: Redis client tries immediate connect (lazyConnect false), causing noisy retries/logs and operational failures later, but not necessarily immediate process exit.

4. Health and readiness endpoints are hard dependency checks by design.

- Reason: /health and /health/ready always include db/redis/qdrant indicators.
- Evidence: apps/mcp-server/src/health/health.controller.ts:26-32 and :44-54
- Result when dependencies are down: health endpoints fail even if process booted.

5. Even pgvector backend mode still keeps Qdrant in DI graph.

- Reason: VectorStoreModule always imports QdrantModule and AppModule directly imports QdrantModule.
- Evidence: packages/vector-store/src/vector-store.module.ts:49 and apps/mcp-server/src/app.module.ts:29
- Result: qdrant package/client wiring remains loaded even when not needed for pgvector-only runtime.

## Blocking Dependencies

### Hard startup blockers (prevent process boot)

- Missing required env vars: DATABASE_URL, REDIS_URL, QDRANT_URL
  - Evidence: packages/config/src/env.schema.ts:10-12, :42-43
- Missing DATABASE_URL specifically for PrismaService
  - Evidence: packages/database/src/prisma.service.ts:13-15
- Unreachable Postgres at startup due eager Prisma connect
  - Evidence: packages/database/src/prisma.service.ts:28-29

### Operational blockers (process can boot, capability degraded/fails)

- Redis unavailable
  - Evidence: packages/redis/src/redis.module.ts:13-23, apps/mcp-server/src/health/redis.health.ts:15-24, packages/redis/src/redis.service.ts:142-177
  - Effect: STM operations and health checks fail.
- Qdrant unavailable
  - Evidence: apps/mcp-server/src/health/qdrant.health.ts:15-24, packages/vector-store/src/qdrant.service.ts:16-24
  - Effect: qdrant health fails; vector operations fail when invoked.

## Candidate Changes

Minimal change set to allow boot without external services/databases:

1. Make environment validation conditional by enabled features/backend

- Change env schema to require service URLs only when corresponding features are enabled.
- Example policy:
  - Require DATABASE_URL when LTM, Prisma-based health, or pgvector backend is enabled.
  - Require REDIS_URL when STM, redis cache, or redis-backed queue is enabled.
  - Require QDRANT_URL only when VECTOR_BACKEND=qdrant.
- Files to update:
  - packages/config/src/env.schema.ts
  - apps/mcp-server/src/app.module.ts (feature flags/config defaults)

2. Stop eager Postgres connect during module init

- Replace PrismaService onModuleInit eager connect with lazy connect on first DB operation, or guard connect behind a feature flag like REQUIRE_DATABASE_ON_BOOT.
- Preserve explicit fail-fast mode for production if desired via env flag.
- Files to update:
  - packages/database/src/prisma.service.ts

3. Make root module imports conditional (DynamicModule pattern)

- Gate imports for MemoryModule, HealthModule, RedisModule, QdrantModule, PrismaModule by feature flags.
- Keep a minimal boot profile that starts HTTP and MCP with non-memory tools even without infra.
- Files to update:
  - apps/mcp-server/src/app.module.ts
  - apps/mcp-server/src/memory/memory.module.ts (optional registration wrappers)

4. Decouple health readiness from optional dependencies

- buildIndicators should include only enabled/required dependencies.
- Add degraded mode status for optional dependencies instead of hard fail in /ready for optional stacks.
- Files to update:
  - apps/mcp-server/src/health/health.controller.ts
  - apps/mcp-server/src/health/\*.ts as needed for optional semantics

5. Remove unconditional Qdrant import when backend is pgvector

- Refactor VectorStoreModule so QdrantModule is only loaded for qdrant backend.
- Remove direct QdrantModule import from AppModule unless explicitly enabled.
- Files to update:
  - packages/vector-store/src/vector-store.module.ts
  - apps/mcp-server/src/app.module.ts

6. Improve Redis boot tolerance

- Set Redis client lazyConnect=true for optional mode and connect on first use.
- Optionally provide a no-op redis adapter for disabled STM/cache mode.
- Files to update:
  - packages/redis/src/redis.module.ts

## Risks

- Lazy dependency initialization can shift failures from startup time to first request/tool invocation.
- Conditional module graphs may complicate testing matrix and production parity.
- Health endpoint semantics change can affect orchestration behavior (k8s readiness/liveness expectations).
- Making DB optional can break current assumptions in memory APIs if not guarded with clear errors.

## Open Questions

- Should no-external-services mode still expose memory tools with graceful "dependency unavailable" responses, or hide those tools entirely?
- For production, should fail-fast on Postgres remain default while allowing local/dev degraded mode?
- Should /health and /ready diverge (health = overall process + optional deps, ready = only hard deps)?
- Is there a preferred feature-flag contract already used in ENGRAM for optional module wiring?

## Recommended Next Research

- Verify whether any process manager or deployment manifest treats failing /health as startup failure in current environments.
- Map all MCP tool handlers to dependency requirements and produce a tool-by-tool availability matrix for degraded mode.
- Draft concrete DynamicModule design for AppModule with explicit profiles: full, no-db, no-external.
- Add a focused experiment branch proving boot in no-external mode with integration tests for startup and non-memory MCP tools.
