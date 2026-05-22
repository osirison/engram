---
title: ENGRAM Short-Term Memory Package
description: Redis-backed short-term memory module for ENGRAM
---

## Overview

`@engram/memory-stm` provides short-term memory storage with Redis TTL support.
It exports a NestJS module, service, validation schemas, memory types, and STM
error classes.

Short-term memories are temporary and include an expiration timestamp plus a TTL
in seconds.

## Use the Module

```typescript
import { Module } from '@nestjs/common';
import { MemoryStmModule } from '@engram/memory-stm';

@Module({
  imports: [MemoryStmModule],
})
export class MemoryModule {}
```

## Key Exports

| Export                   | Purpose                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| `MemoryStmModule`        | NestJS module for STM providers                                   |
| `MemoryStmService`       | Service for STM create, read, update, delete, and list operations |
| `StmMemory`              | Short-term memory type                                            |
| `StmMemoryNotFoundError` | Error for missing STM records                                     |
| `StmKeyBuilder`          | Redis key helper                                                  |

## Commands

| Task       | Command                                      |
| ---------- | -------------------------------------------- |
| Build      | `pnpm --filter @engram/memory-stm build`     |
| Run lint   | `pnpm --filter @engram/memory-stm lint`      |
| Type-check | `pnpm --filter @engram/memory-stm typecheck` |
| Run tests  | `pnpm --filter @engram/memory-stm test`      |

## Related Docs

- Redis package: [../redis/README.md](../redis/README.md)
- MCP server: [../../apps/mcp-server/README.md](../../apps/mcp-server/README.md)
