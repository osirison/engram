---
title: ENGRAM Short-Term Memory Package
description: Postgres-backed short-term memory module for ENGRAM
---

## Overview

`@engram/memory-stm` provides the short-term memory (STM) tier on Postgres.
It exports a NestJS module, an STM provider token, the Postgres adapter,
validation schemas, memory types, and STM error classes.

Short-term memories are rows in the shared `memories` table with
`type: 'short-term'` and an `expiresAt` timestamp derived from a TTL in
seconds. Expiry is filtered on every read, so expired rows are never
returned; the MCP server additionally bulk-deletes expired rows on a
hygiene sweep (`STM_SWEEP_INTERVAL_MS`, default 600000 ms; 0 disables).

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

| Export                   | Purpose                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `MemoryStmModule`        | NestJS module wiring the STM provider                      |
| `STM_PROVIDER`           | Injection token for the active STM adapter                 |
| `PostgresStmAdapter`     | Postgres-backed STM adapter (rows in the `memories` table) |
| `StmMemory`              | Short-term memory type                                     |
| `StmMemoryNotFoundError` | Error for missing STM records                              |
| `StmMemoryExpiredError`  | Error for records past their `expiresAt`                   |

## Commands

| Task       | Command                                      |
| ---------- | -------------------------------------------- |
| Build      | `pnpm --filter @engram/memory-stm build`     |
| Run lint   | `pnpm --filter @engram/memory-stm lint`      |
| Type-check | `pnpm --filter @engram/memory-stm typecheck` |
| Run tests  | `pnpm --filter @engram/memory-stm test`      |

## Related Docs

- Database package: [../database/README.md](../database/README.md)
- MCP server: [../../apps/mcp-server/README.md](../../apps/mcp-server/README.md)
