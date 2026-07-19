---
title: ENGRAM Vector Store Package
description: pgvector-backed vector index module for ENGRAM workspaces
---

## Overview

`@engram/vector-store` provides the NestJS vector index module used by ENGRAM
for vector storage, similarity search, and health checks. Vectors live in a
`vector` column (`embedding_vec`) on the existing `memories` table via
[pgvector](https://github.com/pgvector/pgvector), keeping Postgres as the
single source of truth — no separate vector service.

The column and its HNSW index are runtime-managed: `PgVectorStore.ensureReady`
provisions both on the first vector write at the dimensionality of the
configured embedding model, and `reset()` drops them so a full reindex can
rebuild at new dimensions. Provisioning retries transient DDL races so
concurrent cold-boot processes converge safely.

## Use the Module

```typescript
import { Module } from '@nestjs/common';
import { VectorStoreModule } from '@engram/vector-store';

@Module({
  imports: [VectorStoreModule],
})
export class MemoryModule {}
```

The store requires `PrismaService` from `@engram/database` to be available
(the `PrismaModule` is `@Global`, so importing it once is sufficient).

## Exports

| Export                 | Purpose                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `VectorStoreModule`    | NestJS module that provides the pgvector `VectorStore`      |
| `VECTOR_STORE_TOKEN`   | Injection token for the active `VectorStore` implementation |
| `PgVectorStore`        | pgvector `VectorStore` implementation                       |
| `PGVECTOR_TABLE`       | Backing table name (`memories`)                             |
| `PGVECTOR_COLUMN`      | Backing column name (`embedding_vec`)                       |
| `PGVECTOR_INDEX`       | HNSW index name                                             |
| `assertNonEmptyVector` | Guard helper shared by store implementations                |

## Environment

| Variable                        | Purpose                                                          |
| ------------------------------- | ---------------------------------------------------------------- |
| `VECTOR_DIMENSIONS`             | Optional strict pin for embedding dimensionality (else inferred) |
| `PGVECTOR_HNSW_M`               | HNSW build-time `m` (2-100)                                      |
| `PGVECTOR_HNSW_EF_CONSTRUCTION` | HNSW build-time `ef_construction` (4-1000)                       |
| `PGVECTOR_HNSW_EF_SEARCH`       | Query-time `hnsw.ef_search` (>= 1)                               |

Requires a Postgres image with the pgvector extension
(`pgvector/pgvector:pg16` or newer); plain `postgres:*` images lack it.

## Testing

```bash
pnpm --filter @engram/vector-store test
# set PGVECTOR_TEST_URL to run the live-Postgres integration suite
```
