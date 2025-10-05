# Database Package Usage Guide

This guide shows how to use the `@engram/database` package in your NestJS applications.

## Setup

### 1. Environment Configuration

Ensure your `.env` file has the `DATABASE_URL` configured:

```env
DATABASE_URL=postgresql://engram:dev_password@localhost:5432/engram
```

### 2. Start PostgreSQL

Start the PostgreSQL container:

```bash
pnpm docker:up
```

Wait for the database to be healthy:

```bash
pnpm docker:ps
```

### 3. Generate Prisma Client

Generate the Prisma Client types:

```bash
pnpm db:generate
```

### 4. Run Migrations

Create and apply the initial migration:

```bash
pnpm db:migrate dev --name init_schema
```

## Using in NestJS Applications

### Import PrismaModule

In your root module (e.g., `app.module.ts`):

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@engram/database';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule, // Add this
    UsersModule,
  ],
})
export class AppModule {}
```

### Create a Service

Create a service that uses PrismaService:

```typescript
// users/users.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@engram/database';
import { User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<User[]> {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async create(email: string): Promise<User> {
    return this.prisma.user.create({
      data: { email },
    });
  }

  async update(id: string, email: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { email },
    });
  }

  async delete(id: string): Promise<User> {
    return this.prisma.user.delete({
      where: { id },
    });
  }
}
```

### Create a Controller

Create a controller to expose the service:

```typescript
// users/users.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  async create(@Body('email') email: string) {
    return this.usersService.create(email);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body('email') email: string) {
    return this.usersService.update(id, email);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.usersService.delete(id);
  }
}
```

## Advanced Usage

### Transactions

Use transactions for atomic operations:

```typescript
async createUserWithProfile(email: string, profileData: any) {
  return this.prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email },
    });

    const profile = await tx.profile.create({
      data: {
        ...profileData,
        userId: user.id,
      },
    });

    return { user, profile };
  });
}
```

### Raw Queries

Execute raw SQL when needed:

```typescript
async getUserStats() {
  return this.prisma.$queryRaw`
    SELECT 
      DATE(created_at) as date,
      COUNT(*) as count
    FROM users
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `;
}
```

### Error Handling

Handle Prisma-specific errors:

```typescript
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

async create(email: string) {
  try {
    return await this.prisma.user.create({
      data: { email },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002: Unique constraint violation
      if (error.code === 'P2002') {
        throw new ConflictException('User with this email already exists');
      }
    }
    throw error;
  }
}
```

## Testing

### Unit Tests

Mock PrismaService in unit tests:

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '@engram/database';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should find all users', async () => {
    const users = [{ id: '1', email: 'test@example.com' }];
    jest.spyOn(prisma.user, 'findMany').mockResolvedValue(users);

    expect(await service.findAll()).toEqual(users);
    expect(prisma.user.findMany).toHaveBeenCalled();
  });
});
```

### Integration Tests

Use a test database for integration tests:

```typescript
// Set DATABASE_URL to test database
process.env.DATABASE_URL = 'postgresql://engram:dev_password@localhost:5432/engram_test';

describe('UsersService Integration', () => {
  let module: TestingModule;
  let service: UsersService;
  let prisma: PrismaService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [UsersService],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await module.close();
  });

  beforeEach(async () => {
    // Clean database before each test
    await prisma.user.deleteMany();
  });

  it('should create and find a user', async () => {
    const user = await service.create('test@example.com');
    expect(user.email).toBe('test@example.com');

    const found = await service.findOne(user.id);
    expect(found).toEqual(user);
  });
});
```

## Database Management

### View Data

Open Prisma Studio to view and edit data:

```bash
pnpm db:studio
```

### Create Migration

After modifying `prisma/schema.prisma`:

```bash
pnpm db:migrate dev --name descriptive_migration_name
```

### Reset Database

To reset the database (CAUTION: deletes all data):

```bash
pnpm db:reset
```

### Deploy to Production

```bash
pnpm db:migrate:deploy
```

## Best Practices

1. **Always use transactions** for operations that modify multiple tables
2. **Use select** to only fetch needed fields for better performance
3. **Handle Prisma errors** gracefully with appropriate HTTP exceptions
4. **Use raw queries sparingly** - prefer Prisma's type-safe API
5. **Run migrations** in CI/CD pipeline before deployment
6. **Use connection pooling** in production (Prisma does this by default)
7. **Monitor slow queries** using Prisma's query logging

## Troubleshooting

### "Prisma Client not initialized"

Run: `pnpm db:generate`

### "Can't reach database server"

Ensure PostgreSQL is running: `pnpm docker:up`

### "Migration failed"

Check migration files in `prisma/migrations/` and fix conflicts

### "Unique constraint violation"

Handle P2002 error code in your application code

## Resources

- [Prisma Documentation](https://www.prisma.io/docs)
- [NestJS Prisma Recipe](https://docs.nestjs.com/recipes/prisma)
- [Prisma Error Reference](https://www.prisma.io/docs/reference/api-reference/error-reference)
