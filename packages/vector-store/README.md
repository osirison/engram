---
title: ENGRAM Vector Store Package
description: Qdrant vector database module for ENGRAM workspaces
---

## Overview

`@engram/vector-store` provides the NestJS vector database module used by ENGRAM
for vector storage, similarity search, and health checks. It ships two
interchangeable `VectorStore` backends selected at runtime:

- **Qdrant** (`VECTOR_BACKEND=qdrant`, default): a dedicated Qdrant service.
- **pgvector** (`VECTOR_BACKEND=pgvector`): embeddings stored in a `vector`
  column on the existing `memories` table, keeping Postgres as the single
  source of truth (no separate vector service required).

## Use the Module

```typescript
import { Module } from '@nestjs/common';
import { VectorStoreModule } from '@engram/vector-store';

@Module({
  imports: [VectorStoreModule],
})
export class MemoryModule {}
```

The module resolves the active backend from `VECTOR_BACKEND`. The pgvector
backend requires `PrismaService` from `@engram/database` to be available (the
`PrismaModule` is `@Global`, so importing it once is sufficient).

## Exports

| Export               | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `VectorStoreModule`  | NestJS module that wires the configured `VectorStore` backend  |
| `VECTOR_STORE_TOKEN` | Injection token for the active `VectorStore` implementation    |
| `QdrantModule`       | NestJS module for Qdrant providers                             |
| `QdrantService`      | Service wrapper for Qdrant client operations and health checks |
| `PgVectorStore`      | pgvector-backed `VectorStore` implementation                   |
| `PgVectorClient`     | Structural Prisma client contract used by `PgVectorStore`      |

## pgvector Backend

The pgvector backend stores embeddings in the `embedding_vec vector(N)` column
on `memories` and performs cosine k-nearest-neighbour search via the pgvector
`<=>` distance operator with an HNSW index.

### Schema

The column, extension, and index are provisioned by the Prisma migration
`prisma/migrations/20260601090000_pgvector_provider`. `PgVectorStore.ensureReady`
also applies the same DDL idempotently as a safety net for fresh databases.

Running pgvector requires a Postgres image with the extension available (for
example `pgvector/pgvector:pg16`). Plain `postgres:*-alpine` images do **not**
include it.

### HNSW tuning

The HNSW index and search can be tuned via environment variables. Build-time
parameters (`m`, `ef_construction`) are baked into the index when it is created;
the query-time `ef_search` is applied before each search and trades latency for
recall.

| Variable                        | Effect                                             | Range  |
| ------------------------------- | -------------------------------------------------- | ------ |
| `PGVECTOR_HNSW_M`               | Max connections per layer (index build)            | 2-100  |
| `PGVECTOR_HNSW_EF_CONSTRUCTION` | Candidate list size during index build             | 4-1000 |
| `PGVECTOR_HNSW_EF_SEARCH`       | Candidate list size at query time (recall/latency) | 1-1000 |

> `ef_search` is set with `SET hnsw.ef_search` per query. Under transaction-mode
> connection poolers (e.g. PgBouncer) the GUC may not persist across the pooled
> connection; prefer session pooling when tuning it.

### Health check

`PgVectorStore.healthCheck()` verifies the `vector` extension and embedding
column exist, returning `{ ok, extension, column }`. The MCP server exposes this
as a `pgvector` entry in `GET /health` when `VECTOR_BACKEND=pgvector`.

### Integration Tests

`pgvector.integration.spec.ts` is skipped unless `PGVECTOR_TEST_URL` points at a
pgvector-enabled Postgres instance:

```bash
PGVECTOR_TEST_URL=postgresql://test:test@localhost:5432/engram_test \
  pnpm --filter @engram/vector-store test
```

## Environment

Set vector store values in the root `.env` file:

```env
VECTOR_BACKEND=qdrant        # or "pgvector"
VECTOR_DIMENSIONS=1536
VECTOR_COLLECTION=memories
QDRANT_URL=http://localhost:6333   # required when VECTOR_BACKEND=qdrant

# Optional pgvector HNSW tuning (used when VECTOR_BACKEND=pgvector)
PGVECTOR_HNSW_M=16
PGVECTOR_HNSW_EF_CONSTRUCTION=64
PGVECTOR_HNSW_EF_SEARCH=100
```

## Commands

| Task       | Command                                        |
| ---------- | ---------------------------------------------- |
| Build      | `pnpm --filter @engram/vector-store build`     |
| Run lint   | `pnpm --filter @engram/vector-store lint`      |
| Type-check | `pnpm --filter @engram/vector-store typecheck` |
| Run tests  | `pnpm --filter @engram/vector-store test`      |

## Related Docs

- Local setup: [../../docs/SETUP.md](../../docs/SETUP.md)
- MCP server: [../../apps/mcp-server/README.md](../../apps/mcp-server/README.md)
