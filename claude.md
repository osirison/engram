# Claude AI Instructions - ENGRAM Project

## Project Context
You are working on ENGRAM (Extended Neural Graph for Recall and Memory), a production-grade MCP server for AI agent memory management. This is a modular TypeScript/NestJS application following enterprise patterns.

## Core Principles

### 1. Use Existing Libraries - ALWAYS
Never write custom implementations when battle-tested libraries exist:
- ✅ Use Zod for validation
- ✅ Use Prisma for database access
- ✅ Use BullMQ for job queues
- ✅ Use date-fns for date operations
- ✅ Use NestJS built-in decorators and utilities
- ❌ Never write custom validators
- ❌ Never write raw SQL (use Prisma)
- ❌ Never implement custom queue systems

### 2. Type Safety First
- Every function must have explicit return types
- No `any` types ever - use `unknown` if truly dynamic
- Use Zod schemas to generate TypeScript types
- Leverage TypeScript's type inference
- Export types from dedicated files

### 3. Issue-Driven Development
**CRITICAL**: Every code change must be tracked by a GitHub issue.
- Before coding: Search for existing issues or create new one
- During coding: Reference issue # in commits
- After coding: Update issue status and link PR
- Format: `feat(scope): description (#issue-number)`

### 4. Modular Architecture
Each package is self-contained:
- Has its own `package.json`
- Exports via `src/index.ts`
- Can be tested independently
- Has clear interfaces

## NestJS Patterns

### Service Pattern
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import type { Memory, CreateMemoryInput } from './types';

@Injectable()
export class MemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger
  ) {
    this.logger.setContext(MemoryService.name);
  }

  async create(input: CreateMemoryInput): Promise<Memory> {
    this.logger.log(`Creating memory: ${input.content.slice(0, 50)}...`);
    
    return this.prisma.memory.create({
      data: input
    });
  }

  async findById(id: string): Promise<Memory> {
    const memory = await this.prisma.memory.findUnique({
      where: { id }
    });
    
    if (!memory) {
      throw new NotFoundException(`Memory ${id} not found`);
    }
    
    return memory;
  }
}
```

### Controller Pattern
```typescript
import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { CreateMemoryDto } from './dto/create-memory.dto';

@Controller('memories')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Post()
  async create(@Body() dto: CreateMemoryDto) {
    return this.memoryService.create(dto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.memoryService.findById(id);
  }
}
```

### Module Pattern
```typescript
import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [MemoryService],
  controllers: [MemoryController],
  exports: [MemoryService] // Export if other modules need it
})
export class MemoryModule {}
```

## Database Patterns (Prisma)

### Schema Design
```prisma
model Memory {
  id        String   @id @default(cuid())
  userId    String
  content   String   @db.Text
  embedding Float[]  // For vector search
  tags      String[]
  metadata  Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
  @@index([createdAt])
  @@map("memories")
}
```

### Query Patterns
```typescript
// Always use select for performance
const memories = await prisma.memory.findMany({
  where: { userId },
  select: {
    id: true,
    content: true,
    createdAt: true
  },
  orderBy: { createdAt: 'desc' },
  take: 20
});

// Use transactions for consistency
await prisma.$transaction(async (tx) => {
  const memory = await tx.memory.create({ data: memoryData });
  await tx.analytics.create({ 
    data: { memoryId: memory.id, type: 'created' } 
  });
});

// Use findUniqueOrThrow for required records
const memory = await prisma.memory.findUniqueOrThrow({
  where: { id }
});
```

## Validation (Zod)

### Schema Definition
```typescript
import { z } from 'zod';

// Define schema
export const createMemorySchema = z.object({
  content: z.string().min(1).max(10000),
  tags: z.array(z.string()).max(20).optional(),
  metadata: z.record(z.unknown()).optional(),
  embedding: z.array(z.number()).length(1536).optional()
});

// Infer TypeScript type
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;

// Use in code
function processMemory(input: unknown) {
  const validated = createMemorySchema.parse(input);
  // validated is now typed as CreateMemoryInput
  return validated;
}
```

### NestJS DTO Validation
```typescript
import { IsString, IsOptional, IsArray, MaxLength } from 'class-validator';

export class CreateMemoryDto {
  @IsString()
  @MaxLength(10000)
  content: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
```

## Error Handling

### Standard Exceptions
```typescript
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
  InternalServerErrorException
} from '@nestjs/common';

// Use appropriate exception types
if (!user) {
  throw new NotFoundException('User not found');
}

if (invalidInput) {
  throw new BadRequestException('Invalid email format');
}

if (!hasPermission) {
  throw new UnauthorizedException('Access denied');
}
```

### Custom Exceptions
```typescript
export class MemoryConflictException extends ConflictException {
  constructor(memoryId: string, reason: string) {
    super(`Memory ${memoryId} conflict: ${reason}`);
  }
}

export class VectorSearchException extends InternalServerErrorException {
  constructor(error: unknown) {
    super(`Vector search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
```

### Try-Catch Pattern
```typescript
async findMemory(id: string): Promise<Memory> {
  try {
    return await this.prisma.memory.findUniqueOrThrow({
      where: { id }
    });
  } catch (error) {
    // Handle Prisma-specific errors
    if (error.code === 'P2025') {
      throw new NotFoundException(`Memory ${id} not found`);
    }
    
    this.logger.error(`Failed to find memory ${id}`, error);
    throw error;
  }
}
```

## Testing Patterns

### Unit Test Structure
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { MemoryService } from './memory.service';
import { PrismaService } from '@/database/prisma.service';

describe('MemoryService', () => {
  let service: MemoryService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        {
          provide: PrismaService,
          useValue: {
            memory: {
              create: vi.fn(),
              findUnique: vi.fn(),
              findMany: vi.fn()
            }
          }
        }
      ]
    }).compile();

    service = module.get<MemoryService>(MemoryService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('create', () => {
    it('should create a memory', async () => {
      const input = { content: 'test memory' };
      const expected = { id: '123', ...input };
      
      vi.spyOn(prisma.memory, 'create').mockResolvedValue(expected);
      
      const result = await service.create(input);
      
      expect(result).toEqual(expected);
      expect(prisma.memory.create).toHaveBeenCalledWith({
        data: input
      });
    });
  });
});
```

### Integration Test Pattern
```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '@/app.module';

describe('MemoryController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/memories (POST)', () => {
    return request(app.getHttpServer())
      .post('/memories')
      .send({ content: 'test memory' })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
        expect(res.body.content).toBe('test memory');
      });
  });
});
```

## Async Operations & Jobs

### BullMQ Job Pattern
```typescript
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';

@Processor('memory-processing')
export class MemoryProcessor {
  @Process('reconcile')
  async handleReconciliation(job: Job<{ memoryId: string }>) {
    const { memoryId } = job.data;
    
    this.logger.log(`Processing reconciliation for memory ${memoryId}`);
    
    // Process the job
    await this.reconcileMemory(memoryId);
    
    return { success: true, memoryId };
  }
  
  @Process({ name: 'generate-insights', concurrency: 5 })
  async handleInsights(job: Job) {
    // Process with concurrency limit
  }
}
```

### Queue Usage
```typescript
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class MemoryService {
  constructor(
    @InjectQueue('memory-processing') 
    private readonly queue: Queue
  ) {}
  
  async scheduleReconciliation(memoryId: string) {
    await this.queue.add('reconcile', 
      { memoryId },
      {
        delay: 5000, // 5 second delay
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      }
    );
  }
}
```

## Configuration Management

### Environment Variables
```typescript
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MyService {
  constructor(private config: ConfigService) {}
  
  getDatabaseUrl(): string {
    // Use getOrThrow for required config
    return this.config.getOrThrow<string>('DATABASE_URL');
  }
  
  getOptionalFeature(): boolean {
    // Use get with default for optional config
    return this.config.get<boolean>('FEATURE_ENABLED', false);
  }
}
```

### Config Schema
```typescript
import { z } from 'zod';

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  QDRANT_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d')
});

export type Config = z.infer<typeof configSchema>;
```

## GitHub Issue Integration

### Before Starting Work
```typescript
// 1. Search for related issues using GitHub MCP
// 2. If no issue exists, create one with proper labels:
//    - epic:* (which epic does this belong to)
//    - story:* (which user story)
//    - type:* (feature, bug, docs, etc)
//    - priority:* (critical, high, medium, low)
// 3. Assign issue to yourself
// 4. Update issue status to "In Progress"
```

### During Development
```typescript
// Commit format: type(scope): description (#issue-number)
// Examples:
// feat(memory): add semantic search capability (#45)
// fix(auth): resolve token refresh bug (#67)
// docs(readme): update installation steps (#23)
// test(memory): add unit tests for retrieval (#55)
```

### After Completion
```typescript
// 1. Create PR with "Closes #issue-number" in description
// 2. Ensure all tests pass
// 3. Request review
// 4. Issue auto-closes on merge
```

## Common Workflows

### Adding New Feature
1. Search/create GitHub issue
2. Create feature branch: `git checkout -b feat/feature-name-#issue`
3. Implement in appropriate package
4. Write tests (unit + integration)
5. Update documentation
6. Commit with issue reference
7. Create PR linking issue
8. Merge after approval

### Adding Database Model
1. Update `prisma/schema.prisma`
2. Generate types: `pnpm db:generate`
3. Create migration: `pnpm db:migrate dev --name add_model_name`
4. Update service types
5. Write tests
6. Commit: `feat(db): add ModelName table (#issue)`

### Adding New Package
1. Create directory: `packages/my-feature/`
2. Add `package.json`:
```json
{
  "name": "@engram/my-feature",
  "version": "0.1.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest"
  }
}
```
3. Add `tsconfig.json` extending root config
4. Create `src/index.ts` with exports
5. Update root `package.json` workspaces
6. Update `turbo.json` with build pipeline

## Performance Guidelines

### Database Optimization
- Always use `select` to limit returned fields
- Add indexes for frequently queried columns
- Use pagination for list queries
- Batch inserts when possible
- Use `findUniqueOrThrow` instead of `findUnique` + manual check

### Caching Strategy
```typescript
@Injectable()
export class MemoryService {
  constructor(
    private redis: Redis,
    private prisma: PrismaService
  ) {}
  
  async findById(id: string): Promise<Memory> {
    // Try cache first
    const cached = await this.redis.get(`memory:${id}`);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Fetch from database
    const memory = await this.prisma.memory.findUniqueOrThrow({
      where: { id }
    });
    
    // Cache for 5 minutes
    await this.redis.setex(
      `memory:${id}`, 
      300, 
      JSON.stringify(memory)
    );
    
    return memory;
  }
}
```

### Vector Search Optimization
```typescript
// Batch vector insertions
async batchInsertVectors(memories: Memory[]) {
  const points = memories.map(m => ({
    id: m.id,
    vector: m.embedding,
    payload: { content: m.content, userId: m.userId }
  }));
  
  await this.qdrant.upsert('memories', {
    wait: true,
    points
  });
}
```

## Security Best Practices

### Input Validation
- Validate all user inputs with Zod or class-validator
- Sanitize HTML content if storing user-generated HTML
- Validate file uploads (type, size)
- Rate limit endpoints

### Authentication
```typescript
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('memories')
@UseGuards(JwtAuthGuard)
export class MemoryController {
  // All routes require authentication
}
```

### Authorization
```typescript
import { SetMetadata } from '@nestjs/common';

export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

@Post()
@Roles('admin', 'user')
async create(@Body() dto: CreateMemoryDto) {
  // Only admin and user roles can create
}
```

## Logging Best Practices

```typescript
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  
  async create(input: CreateMemoryInput) {
    this.logger.log(`Creating memory for user ${input.userId}`);
    
    try {
      const memory = await this.prisma.memory.create({ data: input });
      this.logger.log(`Memory ${memory.id} created successfully`);
      return memory;
    } catch (error) {
      this.logger.error(
        `Failed to create memory: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }
}
```

## Documentation Requirements

### Code Comments
```typescript
/**
 * Retrieves memories using semantic search
 * 
 * @param query - The search query text
 * @param userId - User ID to filter memories
 * @param limit - Maximum number of results (default: 10)
 * @returns Array of memories sorted by relevance
 * @throws {VectorSearchException} If vector search fails
 */
async semanticSearch(
  query: string, 
  userId: string, 
  limit = 10
): Promise<Memory[]> {
  // Implementation
}
```

### README Updates
- Update package README when adding features
- Include usage examples
- Document environment variables
- Add troubleshooting section

## Resources & References

- **NestJS**: https://docs.nestjs.com
- **Prisma**: https://www.prisma.io/docs
- **Zod**: https://zod.dev
- **BullMQ**: https://docs.bullmq.io
- **Vitest**: https://vitest.dev
- **MCP Protocol**: https://modelcontextprotocol.io
- **Project README**: ../README.md
- **Agents Guide**: ../AGENTS.md

## Quick Decision Tree

**Should I use a library?**
→ YES, if it's well-maintained and widely used
→ Search npm, check downloads, check last update

**Should I write tests?**
→ YES, always write tests for new features
→ Unit tests for services, integration tests for APIs

**Should I create an issue?**
→ YES, every code change needs an issue
→ Search first, create if doesn't exist

**Should I refactor this code?**
→ YES, if it improves readability/performance
→ Create issue, write tests first, refactor, verify tests pass

**Should I optimize this query?**
→ Profile first, optimize if slow
→ Add indexes, use select, implement caching

Remember: **Be direct, honest, and pragmatic. Use existing tools. Track everything with issues.**