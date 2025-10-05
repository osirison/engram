# @engram/database

Database layer with Prisma ORM for ENGRAM project.

## Overview

This package provides a NestJS-ready database layer using Prisma ORM for PostgreSQL. It includes a global PrismaService that handles connection lifecycle and can be injected into any service.

## Installation

This package is part of the ENGRAM monorepo and is installed automatically with the workspace.

## Usage

### Import the PrismaModule

Import the `PrismaModule` in your NestJS module:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '@engram/database';

@Module({
  imports: [PrismaModule],
  // ...
})
export class AppModule {}
```

### Inject PrismaService

Inject the `PrismaService` into your services:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@engram/database';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany();
  }

  async findOne(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async create(email: string) {
    return this.prisma.user.create({
      data: { email },
    });
  }
}
```

## Database Commands

From the root of the monorepo:

```bash
# Generate Prisma Client types
pnpm db:generate

# Create a new migration
pnpm db:migrate

# Deploy migrations in production
pnpm db:migrate:deploy

# Reset database (CAUTION: deletes all data)
pnpm db:reset

# Open Prisma Studio (database GUI)
pnpm db:studio

# Push schema changes without migration (dev only)
pnpm db:push
```

## Schema Location

The Prisma schema is located at `/prisma/schema.prisma` in the root of the monorepo.

## Environment Variables

Required environment variable:

- `DATABASE_URL` - PostgreSQL connection string (e.g., `postgresql://user:password@localhost:5432/dbname`)

This should be set in your `.env` file at the root of the monorepo.

## Development

```bash
# Build the package
pnpm build

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Type check
pnpm typecheck

# Lint
pnpm lint
```

## Features

- ✅ Global module - automatically available throughout your NestJS app
- ✅ Lifecycle hooks - automatically connects/disconnects from database
- ✅ Type-safe queries - full TypeScript support via Prisma Client
- ✅ Transaction support - use `prisma.$transaction()` for atomic operations

## License

MIT
