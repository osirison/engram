---
title: Database Usage
description: Common Prisma usage patterns for the ENGRAM database package
---

## Setup

Start local infrastructure and prepare Prisma from the repository root:

```bash
pnpm docker:up
pnpm db:generate
pnpm db:migrate
```

## Import the Module

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '@engram/database';

@Module({
  imports: [PrismaModule],
})
export class MemoryModule {}
```

## Query From a Service

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@engram/database';

@Injectable()
export class MemoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  listForUser(userId: string) {
    return this.prisma.memory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string) {
    return this.prisma.memory.findUnique({ where: { id } });
  }
}
```

## Use Transactions

Use transactions when multiple writes must succeed or fail together.

```typescript
await this.prisma.$transaction(async (transaction) => {
  const memory = await transaction.memory.create({ data: memoryData });

  await transaction.memoryEvent.create({
    data: {
      memoryId: memory.id,
      type: 'created',
    },
  });

  return memory;
});
```

## Handle Prisma Errors

```typescript
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

try {
  return await this.prisma.user.create({ data });
} catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ConflictException('Unique constraint violated');
  }

  throw error;
}
```

## Test With a Mock

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '@engram/database';

const prismaMock = {
  memory: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
};

const moduleRef = await Test.createTestingModule({
  providers: [
    MemoryRepository,
    {
      provide: PrismaService,
      useValue: prismaMock,
    },
  ],
}).compile();
```
