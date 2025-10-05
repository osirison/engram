# GitHub Copilot Instructions - ENGRAM Project

## Project Overview

ENGRAM is a modular MCP (Model Context Protocol) server built with NestJS and TypeScript for AI agent memory management.

## CRITICAL: Use Framework CLIs - NEVER Create Files From Scratch

**MANDATORY RULE**: Always use framework CLI tools and initialization commands. NEVER manually create framework files.

### NestJS CLI Commands (REQUIRED)

```bash
# Generate complete resource (module + service + controller + DTOs + tests)
nest g resource <name>  # PREFERRED - Creates everything you need

# Generate individual components
nest g module <name>       # Create module
nest g service <name>      # Create service with test file
nest g controller <name>   # Create controller with test file
nest g guard <name>        # Create auth guard
nest g interceptor <name>  # Create interceptor
nest g filter <name>       # Create exception filter
nest g pipe <name>         # Create validation pipe
nest g decorator <name>    # Create custom decorator
nest g class <name>        # Create class
nest g interface <name>    # Create interface

# Examples
nest g resource memory --no-spec  # Create full memory module
nest g service auth/jwt            # Create JWT service in auth module
nest g guard auth/roles            # Create roles guard in auth module
nest g pipe validation/zod         # Create Zod validation pipe
```

### Prisma CLI Commands (REQUIRED)

```bash
# Initialize Prisma (only for new projects)
npx prisma init

# Generate Prisma Client after schema changes (ALWAYS after editing schema)
pnpm db:generate
# or
npx prisma generate

# Create and apply migrations (REQUIRED for schema changes)
pnpm db:migrate dev --name <descriptive_name>
# or
npx prisma migrate dev --name add_user_table

# Development only - push schema without migration
pnpm db:push
# or
npx prisma db push

# Seed database
pnpm db:seed
# or
npx prisma db seed

# Open Prisma Studio (database GUI)
npx prisma studio

# Format Prisma schema
npx prisma format
```

### Package Creation Commands (REQUIRED)

```bash
# Create new package in monorepo (if script exists)
pnpm create-package packages/<name>

# If no custom script exists, use npm init
cd packages/<name>
npm init -y
# Then manually configure package.json for TypeScript

# Initialize TypeScript in package
npx tsc --init

# Add dependencies to specific package
cd packages/<name>
pnpm add <dependency>
```

### Testing Initialization (REQUIRED)

```bash
# Vitest is configured at root level
# For new package, copy vitest.config.ts from existing package

# Initialize test coverage config (if needed)
npx vitest init

# Run tests
pnpm test                    # All tests
pnpm test:watch              # Watch mode
pnpm test packages/<name>    # Specific package
```

### Database Migration Workflow (REQUIRED)

```bash
# 1. Edit prisma/schema.prisma manually (this is the ONLY manual step)

# 2. Format the schema
npx prisma format

# 3. Generate Prisma Client types
pnpm db:generate

# 4. Create migration with descriptive name
pnpm db:migrate dev --name add_memory_tags_column

# 5. Verify migration in prisma/migrations/

# 6. In production, deploy migrations
pnpm db:migrate deploy
```

### Monorepo/Turborepo Commands

```bash
# Build all packages
pnpm build

# Build specific package
pnpm build --filter=<package-name>

# Add workspace dependency
pnpm add <package> --filter=<workspace>

# Run scripts in all workspaces
pnpm -r <script>
```

### When to Use CLI vs Manual Creation

**ALWAYS Use CLI:**

- ✅ NestJS modules, services, controllers, guards, pipes, interceptors, filters
- ✅ Prisma migrations and client generation
- ✅ Package initialization (npm init, pnpm create-package)
- ✅ TypeScript configuration (tsc --init)
- ✅ Test file scaffolding (nest g includes test files)
- ✅ Database schema changes (via Prisma migrate)

**Rare Manual Creation (Only if NO CLI exists):**

- ⚠️ Zod validation schemas (no CLI - must write manually)
- ⚠️ Custom TypeScript type definitions
- ⚠️ Configuration files (after checking for init commands first)
- ⚠️ Documentation files (when explicitly requested)
- ⚠️ Utility functions and helpers
- ⚠️ Constants and enums

**NEVER Manually Create:**

- ❌ NestJS components (modules, services, controllers, etc.)
- ❌ Prisma Client code (auto-generated)
- ❌ Database migrations (use `prisma migrate`)
- ❌ Test boilerplate (use `nest g` with `--spec` flag)
- ❌ Package.json from scratch (use `npm init`)
- ❌ tsconfig.json from scratch (use `tsc --init`)

### Verification Checklist

Before creating ANY framework file manually, STOP and ask:

1. ❓ Does this framework have a CLI command? (Check NestJS, Prisma, npm, etc.)
2. ❓ Can I use `nest generate` for this?
3. ❓ Is this a Prisma schema change? (Use `prisma migrate`)
4. ❓ Is this a new package? (Use `npm init` or custom script)
5. ❓ Does the monorepo have helper scripts in package.json?

**If ANY answer is YES → Use the CLI/command. Do NOT create files manually.**

### Common Mistakes to Avoid

- ❌ Creating `*.module.ts` manually → Use `nest g module`
- ❌ Creating `*.service.ts` manually → Use `nest g service`
- ❌ Creating `*.controller.ts` manually → Use `nest g controller`
- ❌ Editing Prisma Client code → It's auto-generated, edit schema instead
- ❌ Creating migration files manually → Use `prisma migrate`
- ❌ Skipping `prisma generate` after schema changes → Client will be out of sync

## CRITICAL: Issue-Driven Development

**Every code change MUST reference a GitHub issue.** ENGRAM uses structured issue templates that provide complete context for AI agents.

### Issue Templates (`.github/ISSUE_TEMPLATE/`)

**1. Feature Request** - For new features

- Epic assignment (which high-level feature)
- Priority level (critical/high/medium/low)
- Complete context (why needed, user story)
- Technical scope (files to modify, dependencies)
- Acceptance criteria (testable checklist)
- Implementation notes (patterns to follow)
- Tests required (unit/integration/e2e)

**2. Bug Report** - For bugs

- Severity level
- Reproduction steps
- Expected vs actual behavior
- Affected files with line numbers
- Error logs and stack traces
- Suggested fixes

**3. Epic** - For high-level initiatives

- Vision & business goals
- Technical scope (packages involved)
- User stories (to break into issues)
- Success criteria
- Milestones/phases
- Risks & dependencies

### AI Agent Workflow

**Phase 1: Before Coding**

1. List open issues (GitHub issues tab or MCP)
2. Review available issues - check epic labels
3. Read complete issue (context, scope, criteria all provided)
4. If no suitable issue: Create using appropriate template
5. Assign issue to yourself
6. Create branch: type/description-#issue
7. Update status: todo → in-progress
8. Comment: "Starting work on this issue"

**Phase 2: Implementation**

1. Read issue's "Technical Scope" - files to modify are listed
2. Follow "Implementation Notes" - patterns specified
3. Post progress updates to issue regularly
4. Update epic when completing milestones
5. Commit with issue #: `feat(scope): description (#123)` - SINGLE LINE ONLY
6. If blocked: Comment on issue, change to status:blocked

**Phase 3: Verification & Completion**

1. Verify ALL "Acceptance Criteria" are met
2. Run ALL tests specified in "Tests Required"
3. Add completion summary to issue
4. Create PR: "Closes #123" in description
5. Link to epic: "Part of #epic-number"
6. Update epic: Comment "Issue #123 completed"
7. Issue auto-closes when PR merges
8. Move to next open issue

### Benefits for AI Agents

✅ **No Context Hunting**: All info in one place (issue template)
✅ **Clear Success Criteria**: Acceptance criteria define "done"
✅ **Proper Patterns**: Implementation notes guide approach
✅ **Testable**: Tests specified upfront
✅ **Traceable**: Full epic → issue → commit → PR chain

### Key Points

- **Start by listing open issues** - Review available work first
- Issues contain EVERYTHING you need (files, patterns, tests, criteria)
- **Create branch** for each issue: `type/description-#issue`
- **Update progress** regularly on issue and epic
- Always reference issue # in commits: `type(scope): msg (#123)` - SINGLE LINE ONLY
- Follow Technical Scope for which files to modify
- **Verify ALL Acceptance Criteria** before creating PR
- **Add completion summary** to issue before PR
- **Update epic** when issue completes
- If unclear, read the issue again - context is there

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
  exports: [MyService],
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
  where: { id },
});

// Use transactions for multiple writes
await prisma.$transaction([
  prisma.user.create({ data: userData }),
  prisma.memory.create({ data: memoryData }),
]);

// Use select for performance
const users = await prisma.user.findMany({
  select: { id: true, email: true },
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
  metadata: z.record(z.unknown()).optional(),
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
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';

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
          useValue: mockPrismaService,
        },
      ],
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
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  it('/memories (POST)', () => {
    return request(app.getHttpServer()).post('/memories').send(createMemoryDto).expect(201);
  });
});
```

## Git Commit Format

**CRITICAL: Single-line commits ONLY. No multi-line messages, no body, no footer.**

### Commit Message Structure

```
type(scope): subject (#issue-number)
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting, missing semi colons, etc
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance tasks

### Examples (all single line)

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
  JWT_SECRET: z.string().min(32),
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

**ENGRAM uses structured issue templates** - see "CRITICAL: Issue-Driven Development" section above.

### Quick Checklist

**Before Starting:**

- [ ] List open issues to see available work
- [ ] Read complete issue (context, scope, criteria)
- [ ] Create branch: `type/description-#issue`
- [ ] Assign issue and update status to in-progress
- [ ] Comment: "Starting work on this issue"

**During Work:**

- [ ] Post progress updates to issue
- [ ] Update epic with milestone completions
- [ ] Reference issue # in ALL commits: `type(scope): msg (#123)` - SINGLE LINE ONLY
- [ ] Follow "Technical Scope" for files to modify
- [ ] If blocked: Comment and change to status:blocked

**After Completion:**

- [ ] Verify ALL "Acceptance Criteria" met
- [ ] Add completion summary comment to issue
- [ ] Create PR with "Closes #123" in description
- [ ] Link to epic: "Part of #epic-number"
- [ ] Update epic: "Issue #123 completed"
- [ ] Issue auto-closes when PR merges
- [ ] Move to next open issue

### Issue Template Benefits

- **Technical Scope**: Lists exact files to modify
- **Acceptance Criteria**: Defines success (testable)
- **Implementation Notes**: Specifies patterns to use
- **Tests Required**: Lists test types needed

**Remember**: If you're unclear on what to do, re-read the issue. All context is there!

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
