# ENGRAM - AI Agent Instructions

## Project Context
ENGRAM = Extended Neural Graph for Recall and Memory. Modular MCP server for AI agent memory management.

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
1. **Check for GitHub issue** - All work must have issue #
2. **Verify epic/story hierarchy** - Issue must link to story → epic
3. **Check dependencies** - Review package.json for existing libs
4. **Read module README** - Each package has implementation guide

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

### VS Code GitHub Tools
- Create issues via GitHub MCP
- Link commits to issues
- Update issue status
- Create PRs with issue reference

### Issue Management
```bash
# Agent workflow
1. Search for related issues
2. Create new issue if needed
3. Update issue with progress
4. Link commits to issue
5. Close issue when complete
```

### Commit Format
```
type(scope): description (#issue-number)

feat(core): implement memory storage (#45)
fix(auth): resolve token expiry (#67)
docs(readme): update setup guide (#23)
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

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