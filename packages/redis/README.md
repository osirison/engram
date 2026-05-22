---
title: ENGRAM Redis Package
description: Redis client module for ENGRAM workspaces
---

## Overview

`@engram/redis` provides the NestJS Redis module used for cache and short-term
memory support. It wraps `ioredis` and exposes a service that can be injected
into application modules.

## Use the Module

Import `RedisModule` into a NestJS module:

```typescript
import { Module } from '@nestjs/common';
import { RedisModule } from '@engram/redis';

@Module({
  imports: [RedisModule],
})
export class MemoryModule {}
```

Inject `RedisService` into a service:

```typescript
import { Injectable } from '@nestjs/common';
import { RedisService } from '@engram/redis';

@Injectable()
export class CacheService {
  constructor(private readonly redis: RedisService) {}

  async setValue(key: string, value: string): Promise<void> {
    await this.redis.set(key, value);
  }

  getValue(key: string): Promise<string | null> {
    return this.redis.get(key);
  }
}
```

## Environment

Set Redis values in the root `.env` file. The local Docker defaults are:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_URL=redis://localhost:6379
```

## Commands

| Task       | Command                                 |
| ---------- | --------------------------------------- |
| Build      | `pnpm --filter @engram/redis build`     |
| Run lint   | `pnpm --filter @engram/redis lint`      |
| Type-check | `pnpm --filter @engram/redis typecheck` |
| Run tests  | `pnpm --filter @engram/redis test`      |

## Related Docs

- Local setup: [../../docs/SETUP.md](../../docs/SETUP.md)
- Database package: [../database/README.md](../database/README.md)
