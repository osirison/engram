---
title: Lightweight Hooks Research
description: Research on existing ENGRAM code paths and configuration switches for a lightweight or no-external-dependency mode
author: GitHub Copilot
ms.date: 2026-06-02
ms.topic: reference
---

## Research scope

- Discover existing env toggles and providers for vector backends, embeddings providers, and optional services
- Determine whether in-memory, local, disabled, or mock paths already exist
- Inspect MCP tools and memory services for assumptions about vector store and database presence
- Capture file-level evidence with line numbers for reusable lightweight hooks
- Identify promising reuse mechanisms and remaining gaps

## Evidence

### Env toggles and provider selection

- `packages/config/src/env.schema.ts:16` defines `EMBEDDING_PROVIDER` with `openai`, `disabled`, `local` and defaults to `openai`
- `packages/config/src/env.schema.ts:18` defines `VECTOR_BACKEND` with `qdrant` or `pgvector` and defaults to `qdrant`
- `packages/config/src/env.schema.ts:10` requires `DATABASE_URL`
- `packages/config/src/env.schema.ts:11` requires `REDIS_URL`
- `packages/config/src/env.schema.ts:12` requires `QDRANT_URL`
- `packages/embeddings/src/embeddings.module.ts:30` reads `process.env['EMBEDDING_PROVIDER']`
- `packages/embeddings/src/providers/select-embedding-provider.ts:13` routes `disabled`
- `packages/embeddings/src/providers/select-embedding-provider.ts:15` routes `local`
- `packages/embeddings/src/providers/select-embedding-provider.ts:17` routes `openai`
- `.env.example:34` documents `VECTOR_BACKEND=qdrant # or "pgvector"`

### Existing local, disabled, and mock behavior

- `packages/embeddings/src/providers/disabled-embedding.provider.ts:10` returns null vectors when provider disabled
- `packages/embeddings/src/providers/local-embedding.provider.ts:18` implements deterministic local hash-based vectors
- `packages/embeddings/src/providers/openai-embedding.provider.ts:14` warns when `OPENAI_API_KEY` is missing
- `packages/embeddings/src/providers/openai-embedding.provider.ts:24` returns `null` when OpenAI client is unavailable
- `packages/embeddings/src/embeddings.service.ts:31` marks Redis cache dependency optional
- `packages/embeddings/src/embeddings.service.ts:32` marks embedding provider dependency optional
- `packages/embeddings/src/embeddings.service.ts:97` treats missing provider output as non-fatal and returns null
- `apps/mcp-server/src/__mocks__/@engram/redis.ts:1` contains a test-only Redis mock module
- `apps/mcp-server/test/mcp-tools.integration.spec.ts:147` and `:148` show service-level mock injection for STM and LTM in tests

### Vector store backend switching and optional vector paths

- `packages/vector-store/src/vector-store.module.ts:13` resolves `VECTOR_BACKEND` to `qdrant` or `pgvector`
- `packages/vector-store/src/vector-store.module.ts:53` injects `PrismaService` as optional in vector store factory
- `packages/vector-store/src/vector-store.module.ts:59` throws only when backend is `pgvector` and Prisma is missing
- `packages/vector-store/src/vector-store.module.ts:49` always imports `QdrantModule`
- `packages/vector-store/src/qdrant.module.ts:11` creates a Qdrant client with `QDRANT_URL` or localhost default
- `packages/vector-store/src/pgvector.vector-store.ts:131` creates pgvector extension on demand
- `packages/vector-store/src/pgvector.vector-store.ts:251` exposes pgvector health probe
- `packages/memory-ltm/src/memory-ltm.service.ts:513` semantic search returns empty list when vector store missing
- `packages/memory-ltm/src/memory-ltm.service.ts:518` semantic search returns empty list when embeddings missing
- `packages/memory-ltm/src/memory-ltm.service.ts:600` reindex returns empty summary when vector store missing
- `packages/memory-ltm/src/memory-ltm.service.ts:717` indexing operation no-ops if vector store missing or vector empty

### Hard assumptions for external services and startup

- `packages/database/src/prisma.service.ts:14` throws if `DATABASE_URL` is absent
- `packages/database/src/prisma.service.ts:29` connects Prisma on module init
- `packages/redis/src/redis.module.ts:18` uses `lazyConnect: false` for immediate Redis connection
- `apps/mcp-server/src/app.module.ts:27` imports `PrismaModule`
- `apps/mcp-server/src/app.module.ts:28` imports `RedisModule`
- `apps/mcp-server/src/app.module.ts:29` imports `QdrantModule`
- `apps/mcp-server/src/memory/memory.module.ts:11` imports `MemoryStmModule`, `MemoryLtmModule`, `PrismaModule`, `RedisModule`
- `packages/memory-ltm/src/memory-ltm.module.ts:8` imports `PrismaModule`, `EmbeddingsModule`, `VectorStoreModule`
- `apps/mcp-server/src/health/health.module.ts:22` through `:26` imports Prisma, Embeddings, Redis, Qdrant, VectorStore modules
- `packages/memory-stm/src/memory-stm.service.ts:28` requires Redis service directly (not optional)
- `apps/mcp-server/src/memory/reindex-queue.service.ts:64` requires Redis service for queued job persistence

### MCP tools and maintenance assumptions

- `apps/mcp-server/src/main.ts:41` gets MCP tools from memory controller
- `apps/mcp-server/src/main.ts:42` registers tools dynamically through MCP handler
- `apps/mcp-server/src/memory/memory.service.ts:372` recall delegates to LTM semantic search
- `apps/mcp-server/src/memory/memory.service.ts:388` reindex delegates to LTM reindex
- `apps/mcp-server/src/memory/memory.controller.ts:62` central admin authorization guard for maintenance tools
- `apps/mcp-server/src/memory/memory.controller.ts:65` requires `MCP_ADMIN_TOKEN` for admin tool execution
- `apps/mcp-server/src/memory/memory.controller.ts:398` protects `reindex_memories`
- `apps/mcp-server/src/memory/memory.controller.ts:443` protects `queue_reindex_memories`
- `apps/mcp-server/src/memory/memory.controller.ts:619` tool list is assembled in one place and can be filtered/changed by mode

## Reusable hooks

- Use existing embedding mode switch as-is for lightweight operation:
  - `EMBEDDING_PROVIDER=disabled` gives a no-network embedding path (`packages/config/src/env.schema.ts:16`, `packages/embeddings/src/providers/disabled-embedding.provider.ts:10`)
  - `EMBEDDING_PROVIDER=local` gives deterministic local vectors for non-production fallback (`packages/config/src/env.schema.ts:16`, `packages/embeddings/src/providers/local-embedding.provider.ts:18`)
- Keep vector-store backend as pluggable strategy with `VECTOR_STORE_TOKEN` factory (`packages/vector-store/src/vector-store.module.ts:50` to `:76`)
- Reuse LTM graceful degradation behavior for recall/reindex when vector components are absent (`packages/memory-ltm/src/memory-ltm.service.ts:513` to `:519`, `:600` to `:602`)
- Reuse MCP registration seam in startup to conditionally include tools by runtime mode (`apps/mcp-server/src/main.ts:41` to `:42`, `apps/mcp-server/src/memory/memory.controller.ts:619`)
- Reuse pgvector path to remove Qdrant dependency while keeping DB-backed vectors (`packages/config/src/env.schema.ts:18`, `packages/vector-store/src/pgvector.vector-store.ts:131`)
- Reuse test mocking seams as blueprint for runtime lightweight adapters:
  - Service replacement is proven via Nest provider `useValue` in integration tests (`apps/mcp-server/test/memory.integration.spec.ts:100` to `:101`)

## Incompatibilities

- True no-external-dependency mode is not currently possible at app startup because core modules are always imported:
  - Prisma/Redis/Qdrant are all imported unconditionally in `apps/mcp-server/src/app.module.ts:27` to `:29`
- Env schema currently marks `DATABASE_URL`, `REDIS_URL`, and `QDRANT_URL` as required, even if a runtime mode might not use all services (`packages/config/src/env.schema.ts:10` to `:12`)
- Prisma hard-fails if no DB URL and connects during module init (`packages/database/src/prisma.service.ts:14`, `:29`)
- Redis is configured for immediate connection (`packages/redis/src/redis.module.ts:18`), which blocks process-only startup without Redis
- STM service has a mandatory Redis dependency (`packages/memory-stm/src/memory-stm.service.ts:28`)
- Reindex queue requires Redis for state persistence (`apps/mcp-server/src/memory/reindex-queue.service.ts:64`, `:327`)
- Health module currently imports all service modules, so health endpoints inherit the same hard dependencies (`apps/mcp-server/src/health/health.module.ts:22` to `:26`)
- `VectorStoreModule` imports `QdrantModule` unconditionally (`packages/vector-store/src/vector-store.module.ts:49`), so even pgvector mode still wires Qdrant client provider

## Quick wins

- Introduce a lightweight profile that reuses existing behavior first:
  - Set `EMBEDDING_PROVIDER=disabled` or `local`
  - Set `VECTOR_BACKEND=pgvector` if Postgres is available and Qdrant should be removed
- Split module composition by runtime profile in `apps/mcp-server/src/app.module.ts`:
  - Fast path: keep current default profile unchanged
  - Lightweight path: skip `QdrantModule`, optionally skip `HealthModule` or use a lightweight health module
- Make `QDRANT_URL` conditionally required based on `VECTOR_BACKEND`, and make `REDIS_URL` conditional when queue and STM are disabled
- Add a reduced MCP tool set for lightweight mode using the existing `getMcpTools()` registration seam:
  - keep create/get/list/update/delete with adjusted storage policy
  - disable or gate reindex queue tools when Redis is absent
- Extract small no-op adapters from existing test patterns:
  - no-op queue persistence
  - in-memory STM store for single-process operation

## Missing pieces

- No runtime in-memory STM implementation exists today. Current STM is Redis-only (`packages/memory-stm/src/memory-stm.service.ts:28`)
- No runtime no-op Redis module/provider exists for production mode. Only a Jest mock exists (`apps/mcp-server/src/__mocks__/@engram/redis.ts:1`)
- No runtime in-memory LTM or file-backed LTM exists. LTM currently requires Prisma service (`packages/memory-ltm/src/memory-ltm.module.ts:8`)
- No explicit feature flag controls which external modules are imported at startup
- Env validation is not profile-aware, so optionality by mode is not represented (`packages/config/src/env.schema.ts:10` to `:12`)
- Health checks are not profile-aware enough for process-only mode, even though pgvector health indicator already supports a not-applicable branch (`apps/mcp-server/src/health/pgvector.health.ts:40` to `:42`)
- `.env.example` documents vector backend switch but does not surface embedding provider options for local and disabled modes (`.env.example:34`)
