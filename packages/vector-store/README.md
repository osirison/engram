---
title: ENGRAM Vector Store Package
description: Qdrant vector database module for ENGRAM workspaces
---

## Overview

`@engram/vector-store` provides the NestJS Qdrant module used by ENGRAM for
vector database access and health checks.

## Use the Module

```typescript
import { Module } from '@nestjs/common';
import { QdrantModule } from '@engram/vector-store';

@Module({
  imports: [QdrantModule],
})
export class MemoryModule {}
```

## Exports

| Export          | Purpose                                                        |
| --------------- | -------------------------------------------------------------- |
| `QdrantModule`  | NestJS module for Qdrant providers                             |
| `QdrantService` | Service wrapper for Qdrant client operations and health checks |

## Environment

Set Qdrant values in the root `.env` file. The local Docker default is:

```env
QDRANT_URL=http://localhost:6333
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
