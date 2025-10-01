# ENGRAM - AI Agent Instructions

## Project Context
ENGRAM = Extended Neural Graph for Recall and Memory. Modular MCP server for AI agent memory management.

## CRITICAL: Use Framework CLIs - NEVER Create Files From Scratch

**MANDATORY RULE**: Always use framework CLI tools and initialization commands. NEVER manually create framework files.

### NestJS CLI Commands (REQUIRED)
```bash
# Generate complete resource (module + service + controller + DTOs + tests)
nest g resource <name>  # USE THIS for new features

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
nest g guard auth/roles            # Create roles guard
```

### Prisma CLI Commands (REQUIRED)
```bash
# Initialize Prisma (only for new projects)
npx prisma init

# Generate Prisma Client after schema changes
pnpm db:generate
# or
npx prisma generate

# Create and apply migrations
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
```

### Package Creation Commands (REQUIRED)
```bash
# Create new package in monorepo
pnpm create-package packages/<name>

# If no custom script exists, use npm init
cd packages/<name>
npm init -y
# Then configure package.json for TypeScript

# Initialize TypeScript in package
npx tsc --init
```

### Testing Initialization (REQUIRED)
```bash
# Vitest is configured at root level
# For new package, copy vitest.config.ts from existing package

# Initialize test coverage config (if needed)
npx vitest init
```

### Database Migration Workflow
```bash
# 1. Edit prisma/schema.prisma manually
# 2. Generate types
pnpm db:generate

# 3. Create migration
pnpm db:migrate dev --name descriptive_migration_name

# 4. In production
pnpm db:migrate deploy
```

### When to Use CLI vs Manual Creation

**ALWAYS Use CLI:**
- ✅ NestJS modules, services, controllers, guards, pipes, etc.
- ✅ Prisma migrations and client generation
- ✅ Package initialization
- ✅ TypeScript configuration (tsc --init)
- ✅ Test file scaffolding

**Rare Manual Creation (Only if no CLI exists):**
- ⚠️ Zod schemas (no CLI available)
- ⚠️ Custom type definitions
- ⚠️ Configuration files (after checking for init commands)
- ⚠️ Documentation files (when explicitly requested)

**NEVER Manually Create:**
- ❌ NestJS modules, services, controllers, etc.
- ❌ Prisma client code
- ❌ Database migrations (use prisma migrate)
- ❌ Test boilerplate (use nest g with --spec)
- ❌ Package.json from scratch (use npm init)

### Verification Checklist
Before creating any framework file manually, ask:
1. ❓ Does this framework have a CLI? (NestJS, Prisma, etc.)
2. ❓ Can I use `nest g` or `prisma` commands?
3. ❓ Is there a package initialization command?
4. ❓ Does the monorepo have helper scripts in package.json?

**If ANY answer is YES, use the CLI command instead of manual file creation.**

## Tech Stack
- TypeScript + Node.js 20+
- NestJS framework
- PostgreSQL (Prisma ORM)
- Qdrant (vectors)
- Redis (cache/queues)
- Turborepo (monorepo)
- BullMQ (jobs)
- Docker

## Code Principles
1. **Use existing frameworks** - Never write custom solutions when libraries exist
2. **Type safety first** - Leverage TypeScript strictly
3. **Modular design** - Each package is independent
4. **Test-driven** - Write tests for all features
5. **Issue-driven** - Every task needs GitHub issue #

## Project Structure
```
apps/mcp-server     → Main MCP server
apps/api            → Future tRPC API
packages/core       → MCP implementation
packages/auth       → OAuth module
packages/memory-*   → Memory modules
packages/analytics  → Analytics
shared/types        → Shared types
```

## Workflow Requirements

### Before Starting Work
1. **Pull latest main branch** - Always run `git checkout main && git pull` before creating new branch
2. **Check for GitHub issue** - All work must have issue #
3. **Verify epic/story hierarchy** - Issue must link to story → epic
4. **Check dependencies** - Review package.json for existing libs
5. **Read module README** - Each package has implementation guide

### During Development
1. **Reference issue #** - Include in commit: `feat(core): add X (#123)`
2. **Use existing packages**:
   - Validation → Zod
   - DB access → Prisma
   - Queues → BullMQ
   - HTTP → NestJS decorators
   - Testing → Vitest
3. **Follow NestJS patterns**:
   - Services for logic
   - Controllers for routes
   - Modules for organization
   - Providers for DI
4. **Type everything** - No `any` types
5. **Write tests** - Unit tests in `.spec.ts` files

### Code Patterns

#### NestJS Module Template
```typescript
@Module({
  imports: [/* dependencies */],
  providers: [MyService],
  controllers: [MyController],
  exports: [MyService]
})
export class MyModule {}
```

#### Service with Prisma
```typescript
@Injectable()
export class MyService {
  constructor(private prisma: PrismaService) {}
  
  async findAll() {
    return this.prisma.myModel.findMany();
  }
}
```

#### Zod Validation
```typescript
import { z } from 'zod';

const schema = z.object({
  name: z.string(),
  age: z.number().positive()
});

type MyType = z.infer<typeof schema>;
```

### Testing Pattern
```typescript
describe('MyService', () => {
  let service: MyService;
  
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [MyService]
    }).compile();
    
    service = module.get<MyService>(MyService);
  });
  
  it('should work', () => {
    expect(service.method()).toBe(expected);
  });
});
```

## Common Tasks

### Adding New Package
```bash
pnpm create-package packages/my-feature
# Add to turbo.json
# Update root package.json workspace
# Create package.json, tsconfig.json, src/index.ts
```

### Database Changes
```bash
# Edit prisma/schema.prisma
pnpm db:generate  # Generate types
pnpm db:migrate   # Create migration
pnpm db:push      # Dev only - push without migration
```

### Adding Dependency
```bash
# Add to specific package
cd packages/my-package
pnpm add library-name

# Add to root (if shared)
pnpm add -w library-name
```

### Running Tests
```bash
pnpm test              # All tests
pnpm test:watch        # Watch mode
pnpm test packages/core # Specific package
```

## GitHub Integration

### Issue Templates - Quick Reference

**ENGRAM uses structured templates for all issues. This provides AI agents with complete context.**

**Templates** (`.github/ISSUE_TEMPLATE/`):
1. **Feature Request** - Epic, priority, technical scope, acceptance criteria, tests
2. **Bug Report** - Severity, reproduction steps, affected files, error logs
3. **Epic** - Vision, user stories, milestones, success criteria

**Agent Workflow**:
```bash
1. Read issue - All context is provided (files, patterns, criteria)
2. Implement - Follow specifications in issue
3. Verify - Check against acceptance criteria
4. Complete - Create PR with "Closes #issue"
```

**Benefits**:
- ✅ No context hunting - everything in the issue
- ✅ Clear success criteria - know when done
- ✅ Proper patterns - implementation guidance included
- ✅ Traceable - epic → issue → commit → PR

### VS Code GitHub Tools
- Create issues via GitHub MCP (use templates!)
- Link commits to issues
- Update issue status
- Create PRs with issue reference

### Issue Management

**Complete Workflow:**

```bash
# Before Starting
1. List open issues: Use GitHub MCP list_issues
2. Review issue: Read complete template (context, scope, criteria)
3. Create branch: type/description-#issue (e.g., feat/turborepo-#2)
4. Assign to self and update status to in-progress
5. Comment: "Starting work on this issue"

# During Work
6. Post progress updates regularly to issue
7. Update epic with milestone completions
8. Commit with issue #: type(scope): msg (#123)
9. If blocked: Comment on issue, change label to status:blocked

# After Completion
10. Verify ALL acceptance criteria met
11. Add completion comment with summary
12. Create PR: "Closes #issue-number" in description
13. Update epic: Comment "Issue #X completed"
14. Issue auto-closes when PR merges
15. Move to next issue from open issues list
```

### Commit Format

**CRITICAL: Single-line commits ONLY. No multi-line, no body.**

```
type(scope): description (#issue-number)

feat(core): implement memory storage (#45)
fix(auth): resolve token expiry (#67)
docs(readme): update setup guide (#23)
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

**IMPORTANT**:
- Single line only
- Always reference issue #
- Always reference files specified in issue's "Technical Scope"

## Key Libraries Reference

### NestJS
- `@nestjs/common` - Decorators, DI
- `@nestjs/config` - Configuration
- `@nestjs/bull` - Queue integration

### Database
- `@prisma/client` - DB access
- `prisma` - CLI tool
- `qdrant-client` - Vector DB
- `ioredis` - Redis client

### Validation
- `zod` - Schema validation
- `class-validator` - DTO validation (NestJS)

### Testing
- `vitest` - Test runner
- `@nestjs/testing` - NestJS test utilities

### MCP
- `@modelcontextprotocol/sdk` - MCP protocol

## Error Handling
```typescript
// Use NestJS exceptions
throw new BadRequestException('Invalid input');
throw new NotFoundException('Resource not found');
throw new UnauthorizedException('Auth failed');

// Custom exceptions
export class MemoryNotFoundError extends NotFoundException {
  constructor(id: string) {
    super(`Memory ${id} not found`);
  }
}
```

## Environment Config
```typescript
// Use NestJS ConfigModule
@Injectable()
export class MyService {
  constructor(private config: ConfigService) {}
  
  getDbUrl() {
    return this.config.get<string>('DATABASE_URL');
  }
}
```

## Quick Checks

### Before Committing
- [ ] Code compiles (`pnpm build`)
- [ ] Tests pass (`pnpm test`)
- [ ] Linter clean (`pnpm lint`)
- [ ] Types valid (`pnpm type-check`)
- [ ] Issue # in commit message
- [ ] No `any` types
- [ ] Used existing libraries

### Before PR
- [ ] All tests green
- [ ] Documentation updated
- [ ] CHANGELOG entry
- [ ] Issue status updated
- [ ] Linked to epic/story

## Agent Directives

1. **Always search GitHub for existing issues before creating new ones**
2. **Use GitHub MCP to track all work**
3. **Prefer existing libraries over custom code**
4. **Follow NestJS patterns strictly**
5. **Write tests alongside features**
6. **Keep commits focused and small**
7. **Update documentation with code changes**
8. **Validate inputs with Zod**
9. **Use Prisma for all DB access**
10. **Never commit secrets or env vars**
11. **Ask for clarification if conflicting instructions are found** - When instructions from different sources (CLAUDE.md, AGENTS.md, issue templates, etc.) conflict, always ask the user for clarification before proceeding

## Resources
- [NestJS Docs](https://docs.nestjs.com)
- [Prisma Docs](https://www.prisma.io/docs)
- [Turborepo Docs](https://turbo.build/repo/docs)
- [MCP Protocol](https://modelcontextprotocol.io)
- [Project README](./README.md)

## Status Tracking
When reporting status, use format:
```
Task: [Task name] (#issue-number)
Epic: [Epic name]
Status: [In Progress|Blocked|Complete]
Blockers: [None|Description]
Next: [Next action item]
```