---
title: ENGRAM Database Package
description: Prisma database module for ENGRAM workspaces
---

## Overview

`@engram/database` provides the NestJS Prisma module used by ENGRAM services.
It owns the injectable `PrismaService` and connects application code to the root
Prisma schema in [../../prisma/schema.prisma](../../prisma/schema.prisma).

## Use the Module

Import `PrismaModule` into a NestJS module:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '@engram/database';

@Module({
  imports: [PrismaModule],
})
export class MemoryModule {}
```

Inject `PrismaService` into services:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@engram/database';

@Injectable()
export class MemoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.memory.findUnique({ where: { id } });
  }
}
```

## Commands

Run Prisma commands from the repository root.

| Task                                   | Command                  |
| -------------------------------------- | ------------------------ |
| Generate Prisma client                 | `pnpm db:generate`       |
| Create and run a development migration | `pnpm db:migrate`        |
| Deploy migrations                      | `pnpm db:migrate:deploy` |
| Push schema without a migration        | `pnpm db:push`           |
| Reset local database                   | `pnpm db:reset`          |
| Open Prisma Studio                     | `pnpm db:studio`         |

## Environment

Set `DATABASE_URL` in the root `.env` file. The local Docker default is:

```env
DATABASE_URL=postgresql://engram:dev_password@localhost:5432/engram
```

## Related Docs

- Database usage examples: [USAGE.md](USAGE.md)
- Local setup: [../../docs/SETUP.md](../../docs/SETUP.md)
