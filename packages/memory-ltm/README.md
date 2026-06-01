---
title: ENGRAM Long-Term Memory Package
description: PostgreSQL-backed long-term memory module for ENGRAM
---

## Overview

`@engram/memory-ltm` provides persistent long-term memory storage backed by
Prisma and PostgreSQL. It integrates with embeddings for vector generation and
with STM for memory promotion workflows.

Long-term memories do not expire and are intended for durable recall.

## Use the Module

```typescript
import { Module } from '@nestjs/common';
import { MemoryLtmModule } from '@engram/memory-ltm';

@Module({
  imports: [MemoryLtmModule],
})
export class MemoryModule {}
```

## Key Exports

| Export                   | Purpose                                                                    |
| ------------------------ | -------------------------------------------------------------------------- |
| `MemoryLtmModule`        | NestJS module for LTM providers                                            |
| `MemoryLtmService`       | Service for LTM create, read, update, delete, list, and promote operations |
| `LtmMemory`              | Long-term memory type                                                      |
| `LtmMemoryNotFoundError` | Error for missing LTM records                                              |
| `LtmPromotionError`      | Error for STM-to-LTM promotion failures                                    |
| `DEFAULT_LTM_CONFIG`     | Default paging and quota settings                                          |

## Commands

| Task       | Command                                      |
| ---------- | -------------------------------------------- |
| Build      | `pnpm --filter @engram/memory-ltm build`     |
| Run lint   | `pnpm --filter @engram/memory-ltm lint`      |
| Type-check | `pnpm --filter @engram/memory-ltm typecheck` |
| Run tests  | `pnpm --filter @engram/memory-ltm test`      |

## Backfill / Reindex

`MemoryLtmService.reindex` rebuilds the vector store from Postgres. Use it to
seed a freshly added vector backend or to re-embed after an embedding-model
change. The operation is idempotent and cursor-resumable, and per-item failures
are counted and skipped so Postgres remains the source of truth.

```typescript
const summary = await ltm.reindex({
  userId, // optional: omit to reindex all users
  batchSize: 100, // memories loaded per page (default 100, max 1000)
  reuseExistingEmbeddings: true, // false to regenerate every embedding
  cursor, // optional: resume from a prior run
  maxMemories, // optional: cap total processed
  onProgress: (p) => console.log(p), // { processed, indexed, skipped, failed, cursor }
});
// summary => { processed, indexed, skipped, failed, cursor: null }
```

To process a large dataset across multiple invocations, pass the `cursor` from
the last `onProgress` callback (or a stored checkpoint) into the next call.

## Related Docs

- Database package: [../database/README.md](../database/README.md)
- Embeddings package: [../embeddings/README.md](../embeddings/README.md)
- Short-term memory package: [../memory-stm/README.md](../memory-stm/README.md)
