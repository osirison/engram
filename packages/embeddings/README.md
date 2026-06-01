---
title: ENGRAM Embeddings Package
description: Embedding generation and cache support for ENGRAM memory services
---

## Overview

`@engram/embeddings` provides a NestJS module for semantic embeddings. It can
use OpenAI, a local deterministic provider, or a disabled provider, and it can
cache generated embeddings in Redis.

The service returns `null` instead of throwing when embeddings are unavailable,
so memory workflows can continue without a vector.

## Configuration

| Variable              | Required | Default  | Purpose                                              |
| --------------------- | -------- | -------- | ---------------------------------------------------- |
| `OPENAI_API_KEY`      | No       | None     | Enables OpenAI embeddings when set                   |
| `EMBEDDING_PROVIDER`  | No       | `openai` | Provider selection: `openai`, `local`, or `disabled` |
| `EMBEDDING_CACHE_TTL` | No       | 30 days  | Redis cache lifetime in seconds                      |

Set OpenAI credentials only in local environment files or secret stores:

```bash
export OPENAI_API_KEY="<openai-api-key>"
```

## Use the Module

```typescript
import { Module } from '@nestjs/common';
import { EmbeddingsModule } from '@engram/embeddings';

@Module({
  imports: [EmbeddingsModule],
})
export class MemoryModule {}
```

Inject the service where embeddings are optional:

```typescript
import { Injectable, Optional } from '@nestjs/common';
import { EmbeddingsService } from '@engram/embeddings';

@Injectable()
export class MemoryVectorService {
  constructor(@Optional() private readonly embeddings?: EmbeddingsService) {}

  async generateVector(text: string): Promise<number[] | null> {
    const result = await this.embeddings?.generate({ text });
    return result?.embedding ?? null;
  }
}
```

## Models

| Model                    | Dimensions | Purpose                      |
| ------------------------ | ---------- | ---------------------------- |
| `text-embedding-3-small` | 1,536      | Default OpenAI model         |
| `text-embedding-3-large` | 3,072      | Higher-accuracy OpenAI model |

## Backfill Long-Term Memory Embeddings

Build the package before running the backfill script:

```bash
pnpm --filter @engram/embeddings build
pnpm --filter @engram/embeddings backfill:ltm
```

Optional controls:

| Variable                       | Purpose                                     |
| ------------------------------ | ------------------------------------------- |
| `BACKFILL_BATCH_SIZE`          | Number of memories processed per batch      |
| `BACKFILL_MAX_BATCHES`         | Maximum number of batches to process        |
| `BACKFILL_DRY_RUN=true`        | Count candidates without persisting updates |
| `BACKFILL_RETRY_ATTEMPTS`      | Provider retry count                        |
| `BACKFILL_RETRY_BASE_DELAY_MS` | Base delay for retry backoff                |

## Commands

| Task                    | Command                                         |
| ----------------------- | ----------------------------------------------- |
| Build                   | `pnpm --filter @engram/embeddings build`        |
| Run lint                | `pnpm --filter @engram/embeddings lint`         |
| Type-check              | `pnpm --filter @engram/embeddings typecheck`    |
| Run tests               | `pnpm --filter @engram/embeddings test`         |
| Backfill LTM embeddings | `pnpm --filter @engram/embeddings backfill:ltm` |
