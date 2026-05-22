# @engram/embeddings

NestJS module for generating semantic embeddings via OpenAI, with transparent Redis caching.

## Features

- Generates vector embeddings using OpenAI `text-embedding-3-small` (1 536 dims) or `text-embedding-3-large` (3 072 dims)
- Caches embeddings in Redis for 30 days — normalises the input text before hashing to maximise cache hits
- Degrades gracefully: returns `null` instead of throwing when the API key is absent or OpenAI is unavailable, so that callers (memory services) are never blocked by an embedding failure
- Input validation with Zod (max 8 191 characters)

## Setup

```bash
# Set the API key (optional — embeddings are disabled when absent)
export OPENAI_API_KEY="sk-..."
```

## Usage

### Import the module

```typescript
import { EmbeddingsModule } from '@engram/embeddings';

@Module({
  imports: [EmbeddingsModule],
})
export class YourModule {}
```

### Inject the service

```typescript
import { Injectable, Optional } from '@nestjs/common';
import { EmbeddingsService } from '@engram/embeddings';

@Injectable()
export class YourService {
  constructor(
    @Optional() private readonly embeddings?: EmbeddingsService,
  ) {}

  async doSomething(text: string) {
    const result = await this.embeddings?.generate({ text });
    // result is null when embeddings are disabled or the API call failed
    const vector = result?.embedding ?? null;
  }
}
```

### Direct use

```typescript
const result = await embeddingsService.generate({ text: 'Hello, ENGRAM!' });

if (result) {
  console.log(result.model);    // 'text-embedding-3-small'
  console.log(result.cached);   // true | false
  console.log(result.embedding.length); // 1536
}
```

## Configuration

| Environment variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | No | — | OpenAI API key. Embeddings are disabled when not set. |
| `EMBEDDING_PROVIDER` | No | `openai` | Embedding provider selection (`openai` or `disabled`). |

## Models

| Model | Dimensions | Use case |
|---|---|---|
| `text-embedding-3-small` | 1 536 | Default. Cost-efficient, strong general performance. |
| `text-embedding-3-large` | 3 072 | Higher accuracy for demanding retrieval tasks. |

## Cache behaviour

- Keys: `embedding:<sha256(normalised_text).slice(0,32)>`
- TTL: 30 days (configurable via `EMBEDDING_CACHE_TTL`)
- Normalisation: `text.trim().toLowerCase()` before hashing
- Cache failures are silently ignored — the service falls through to a fresh API call

## Backfill existing long-term memories

The package ships with a batch backfill script for PostgreSQL long-term memories where `embedding` is still empty.

```bash
# 1) Build the package
npx pnpm --filter @engram/embeddings build

# 2) Run backfill (reads DATABASE_URL + OPENAI_API_KEY)
npx pnpm --filter @engram/embeddings backfill:ltm
```

Optional controls:

- `BACKFILL_BATCH_SIZE` (default: `100`)
- `BACKFILL_MAX_BATCHES` (default: unlimited)
- `BACKFILL_DRY_RUN=true` (calculate candidates without persisting updates)

## Error handling

`EmbeddingsService.generate()` never throws. It returns `null` and logs a warning when:

- `OPENAI_API_KEY` is not set
- Input validation fails
- The OpenAI API call fails
- The API returns an empty response
