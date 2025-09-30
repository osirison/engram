# GitHub Copilot Instructions - ENGRAM Project

## Project Overview
ENGRAM is a modular MCP (Model Context Protocol) server built with NestJS and TypeScript for AI agent memory management.

## Code Style & Standards

### TypeScript Rules
- Use strict mode, no `any` types
- Prefer interfaces for data structures
- Use type inference where obvious
- Export types from dedicated type files
- Use `const` assertions for constants

### NestJS Patterns
```typescript
// Services: Business logic
@Injectable()
export class MyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}
}

// Controllers: Route handlers
@Controller('resource')
export class MyController {
  constructor(private readonly service: MyService) {}
  
  @Get()
  findAll() {
    return this.service.findAll();
  }
}

// Modules: Organize features
@Module({
  imports: [DatabaseModule],
  providers: [MyService],
  controllers: [MyController],
  exports: [MyService]
})
export class MyModule {}
```

### File Naming
- Services: `*.service.ts`
- Controllers: `*.controller.ts`
- Modules: `*.module.ts`
- Types: `*.types.ts` or `*.interface.ts`
- Tests: `*.spec.ts`
- DTOs: `*.dto.ts`

### Import Order
1. Node.js built-ins
2. External packages
3. NestJS packages
4. Local modules (absolute paths)
5. Local modules (relative paths)
6. Types (separate import block)

```typescript
import { readFile } from 'fs/promises';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { MyHelper } from './my-helper';
import type { MyType } from './types';
```

## Library Usage

### Always Use These Libraries
- **Validation**: Zod or class-validator (NestJS DTOs)
- **Database**: Prisma Client
- **Queue Jobs**: BullMQ
- **Date/Time**: date-fns
- **HTTP Requests**: axios or built-in fetch
- **Testing**: Vitest + @nestjs/testing
- **Logging**: NestJS Logger

### Never Reinvent
- ❌ Custom validation logic → Use Zod
- ❌ Raw SQL queries → Use Prisma
- ❌ Custom date formatting → Use date-fns
- ❌ Manual HTTP client → Use axios/fetch
- ❌ Custom logger → Use NestJS Logger

## Database (Prisma)

### Schema Patterns
```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  memories Memory[]
  
  @@index([email])
}
```

### Query Patterns
```typescript
// Use findUniqueOrThrow for required records
const user = await prisma.user.findUniqueOrThrow({
  where: { id }
});

// Use transactions for multiple writes
await prisma.$transaction([
  prisma.user.create({ data: userData }),
  prisma.memory.create({ data: memoryData })
]);

// Use select for performance
const users = await prisma.user.findMany({
  select: { id: true, email: true }
});
```

## Validation (Zod)

### Schema Patterns
```typescript
import { z } from 'zod';

// Input schemas
export const createMemorySchema = z.object({
  content: z.string().min(1).max(5000),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional()
});

// Infer types
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;

// Use in services
const validated = createMemorySchema.parse(input);
```

### NestJS DTO Pattern
```typescript
import { IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateMemoryDto {
  @IsString()
  @MaxLength(5000)
  content: string;

  @IsOptional()
  @IsString({ each: true })
  tags?: string[];
}
```

## Error Handling

### NestJS Exceptions
```typescript
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common';

// Use built-in exceptions
throw new NotFoundException(`Memory ${id} not found`);
throw new BadRequestException('Invalid input format');

// Custom exceptions
export class MemoryConflictException extends ConflictException {
  constructor(memoryId: string) {
    super(`Memory ${memoryId} has conflicts that must be resolved`);
  }
}
```

### Try-Catch Pattern
```typescript
async findMemory(id: string) {
  try {
    return await this.prisma.memory.findUniqueOrThrow({
      where: { id }
    });
  } catch (error) {
    if (error.code === 'P2025') {
      throw new NotFoundException(`Memory ${id} not found`);
    }
    throw error;
  }
}
```

## Testing Patterns

### Unit Tests
```typescript
import { Test } from '@nestjs/testing';
import { MyService } from './my.service';

describe('MyService', () => {
  let service: MyService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MyService,
        {
          provide: PrismaService,
          useValue: mockPrismaService
        }
      ]
    }).compile();

    service = module.get<MyService>(MyService);
  });

  it('should create memory', async () => {
    const result = await service.createMemory(mockData);
    expect(result).toHaveProperty('id');
  });
});
```

### Integration Tests
```typescript
describe('MemoryController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  it('/memories (POST)', () => {
    return request(app.getHttpServer())
      .post('/memories')
      .send(createMemoryDto)
      .expect(201);
  });
});
```

## Git Commit Format

### Commit Message Structure
```
type(scope): subject (#issue-number)

body (optional)

footer (optional)
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting, missing semi colons, etc
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance tasks

### Examples
```bash
feat(memory): implement semantic search (#42)
fix(auth): resolve JWT expiration issue (#67)
docs(readme): add deployment instructions (#23)
test(memory): add unit tests for retrieval (#55)
```

## Configuration

### Environment Variables
```typescript
// Use ConfigModule
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MyService {
  constructor(private config: ConfigService) {}
  
  getDatabaseUrl() {
    return this.config.getOrThrow<string>('DATABASE_URL');
  }
}
```

### Validation Schema
```typescript
// config/validation.ts
export const validationSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32)
});
```

## Common Tasks

### Adding New Endpoint
1. Create DTO in `*.dto.ts`
2. Add method to service
3. Add controller route
4. Write unit tests
5. Update OpenAPI decorators

### Adding New Database Model
1. Update `prisma/schema.prisma`
2. Run `pnpm db:generate`
3. Create migration: `pnpm db:migrate`
4. Update service types
5. Write tests

### Adding New Module
1. Create directory: `packages/my-module/`
2. Add `package.json`, `tsconfig.json`
3. Create `src/index.ts` with exports
4. Create module, service, controller
5. Export module from index
6. Import in app module

## Specific Reminders

### When Working With:
- **Prisma**: Always use transactions for multiple writes
- **Redis**: Set TTL on all cached values
- **Qdrant**: Batch vector insertions when possible
- **BullMQ**: Always set job timeouts
- **Authentication**: Use guards, never manual checks
- **Validation**: Validate at boundaries (DTOs, schemas)

### Performance
- Use `select` in Prisma queries
- Implement pagination for list endpoints
- Cache frequently accessed data in Redis
- Use database indexes on queried fields
- Batch operations when possible

### Security
- Never log sensitive data
- Validate all inputs
- Use parameterized queries (Prisma does this)
- Implement rate limiting
- Use HTTPS in production
- Rotate secrets regularly

## Issue Tracking
- Always reference GitHub issue # in commits
- Update issue status when starting work
- Link PRs to issues
- Comment on issues with progress
- Close issues only when merged to main

## Documentation
- Update README when adding features
- Document complex logic with comments
- Keep API docs in sync with code
- Update CHANGELOG for user-facing changes
- Add JSDoc for public APIs

## Resources
- NestJS: https://docs.nestjs.com
- Prisma: https://www.prisma.io/docs
- Zod: https://zod.dev
- Vitest: https://vitest.dev
- Project README: ../README.md
- Agents Guide: ../AGENTS.md