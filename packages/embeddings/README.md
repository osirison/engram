---
title: ENGRAM Embeddings Package
description: Embedding generation and cache support for ENGRAM memory services
---

## Overview

`@engram/embeddings` provides a NestJS module for semantic embeddings. It is
local-first: the default provider talks to a local Ollama server, with OpenAI
available as an opt-in. A deterministic hash provider (testing) and a disabled
provider round out the set, and generated embeddings can be cached in Redis.

The service returns `null` instead of throwing when embeddings are unavailable
(Ollama not running, model not pulled, missing API key), so memory workflows
can continue without a vector.

## Configuration

| Variable             | Required | Default                  | Purpose                                                              |
| -------------------- | -------- | ------------------------ | -------------------------------------------------------------------- |
| `EMBEDDING_PROVIDER` | No       | `ollama`                 | Provider selection: `ollama`, `openai`, `local`, or `disabled`       |
| `EMBEDDING_MODEL`    | No       | per provider             | Model id; ollama→`nomic-embed-text`, openai→`text-embedding-3-small` |
| `OLLAMA_URL`         | No       | `http://localhost:11434` | Ollama server base URL                                               |
| `OPENAI_API_KEY`     | No       | None                     | Required only when `EMBEDDING_PROVIDER=openai`                       |

Default setup — install [Ollama](https://ollama.com/download) and pull the model:

```bash
ollama pull nomic-embed-text
```

For OpenAI instead, set credentials only in local environment files or secret stores:

```bash
export EMBEDDING_PROVIDER=openai
export OPENAI_API_KEY="<openai-api-key>"
```

The effective provider/model/dimensions are resolved once by
`resolveEmbeddingRuntime()` (`embedding-runtime.ts`) and injected via
`EMBEDDING_RUNTIME_TOKEN`, so the service, providers, and scripts always agree.

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

Model ids are open-ended — any id the configured provider understands works.
Dimensions for well-known models (see `MODEL_DIMENSIONS`):

| Model                    | Dimensions | Purpose                               |
| ------------------------ | ---------- | ------------------------------------- |
| `nomic-embed-text`       | 768        | Default Ollama model                  |
| `mxbai-embed-large`      | 1,024      | Higher-accuracy Ollama model          |
| `all-minilm`             | 384        | Small/fast Ollama model               |
| `bge-m3`                 | 1,024      | Multilingual Ollama model             |
| `text-embedding-3-small` | 1,536      | Default OpenAI model (opt-in)         |
| `text-embedding-3-large` | 3,072      | Higher-accuracy OpenAI model          |
| `local-hash`             | 1,536      | Deterministic hash scaffold (testing) |

Changing the model later requires a full reindex with recreate+regenerate
(`pnpm --filter mcp-server reindex -- --recreate --regenerate`).

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
