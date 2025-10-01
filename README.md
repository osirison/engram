# ENGRAM - Extended Neural Graph for Recall and Memory

[![CI](https://github.com/osirison/engram/actions/workflows/ci.yml/badge.svg)](https://github.com/osirison/engram/actions/workflows/ci.yml)

**A Modular Agentic Memory MCP Server**

## 🎯 Vision

ENGRAM is a production-grade Model Context Protocol (MCP) server that provides sophisticated memory management capabilities for AI agents and LLM applications. It implements a neural-temporal approach to context management, enabling short-term and long-term memory, semantic search, memory reconciliation, and intelligent insight generation.

## 🧠 What We're Building

ENGRAM serves as the cognitive backbone for AI systems, providing:

- **Contextual Memory Management**: Store, retrieve, and manage conversation context across sessions
- **Semantic Search**: Vector-based search for relevant historical context
- **Temporal Understanding**: Track and relate information across time
- **Memory Reconciliation**: Automatically detect and resolve conflicting information
- **Insight Generation**: Process memories to extract patterns and actionable insights
- **Multi-tenant Support**: Isolated memory spaces for different users/applications
- **OAuth Integration**: Secure authentication and authorization
- **Analytics Dashboard**: Monitor memory usage, patterns, and system health

## 🏗️ Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────┐
│                        MCP Clients                           │
│            (Claude Desktop, IDEs, Applications)              │
└──────────────────────┬──────────────────────────────────────┘
                       │ MCP Protocol
┌──────────────────────▼──────────────────────────────────────┐
│                    ENGRAM Core Server                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ MCP Handler  │  │  Auth Module │  │  API Gateway │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
┌───────▼──────┐ ┌────▼─────┐ ┌─────▼──────┐
│ Short-Term   │ │Long-Term │ │ Analytics  │
│ Memory       │ │Memory    │ │ Engine     │
└───────┬──────┘ └────┬─────┘ └─────┬──────┘
        │              │              │
┌───────▼──────────────▼──────────────▼──────┐
│           Data Layer                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │PostgreSQL│  │  Qdrant  │  │  Redis   │ │
│  │(Prisma)  │  │(Vectors) │  │(Cache)   │ │
│  └──────────┘  └──────────┘  └──────────┘ │
└─────────────────────────────────────────────┘
```

### Module Architecture

ENGRAM follows a modular monorepo structure using Turborepo:

```
engram/
├── apps/
│   ├── mcp-server/        # Main MCP server application
│   └── api/               # REST/tRPC API (future UI backend)
├── packages/
│   ├── core/              # Core MCP implementation & types
│   ├── auth/              # OAuth & authentication module
│   ├── memory-stm/        # Short-term memory (Redis-based)
│   ├── memory-ltm/        # Long-term memory (PostgreSQL + Qdrant)
│   ├── analytics/         # Analytics & monitoring
│   ├── reconciliation/    # Memory conflict resolution
│   ├── insights/          # Insight processing engine
│   └── ui/                # React/Next.js frontend (future)
├── shared/
│   ├── types/             # Shared TypeScript types
│   ├── utils/             # Common utilities
│   └── config/            # Configuration schemas
└── tools/
    ├── scripts/           # Build & deployment scripts
    └── docker/            # Docker configurations
```

## 🛠️ Technology Stack

### Core Technologies

**Runtime & Language:**
- **TypeScript** - Type safety across the entire stack
- **Node.js 20+** - Runtime environment

**Framework:**
- **NestJS** - Modular architecture with built-in DI, perfect for complex systems
- **@modelcontextprotocol/sdk** - Official MCP TypeScript SDK

**Databases:**
- **PostgreSQL 16+** - Primary relational database
- **Qdrant** - Vector database for semantic search
- **Redis** - Caching, sessions, job queues

**ORM & Data:**
- **Prisma** - Type-safe database access
- **BullMQ** - Job queue for async processing

**API Layer:**
- **tRPC** - End-to-end type safety for future UI
- **Zod** - Runtime validation

**Development:**
- **Turborepo** - Monorepo build system
- **Vitest** - Fast unit testing
- **Playwright** - E2E testing
- **ESLint + Prettier** - Code quality

**DevOps:**
- **Docker + Docker Compose** - Containerization
- **GitHub Actions** - CI/CD
- **Conventional Commits** - Changelog generation

### Technology Decisions

#### Why NestJS over Fastify/Express?
- Built-in module system aligns with our modular architecture
- Dependency injection simplifies testing and modularity
- Extensive ecosystem (validation, testing, config)
- Enterprise-grade patterns for complex applications

#### Why Qdrant over Pinecone/Weaviate?
- Self-hostable (no vendor lock-in)
- Excellent TypeScript client
- High performance with low resource footprint
- Production-ready with clustering support

#### Why Prisma over TypeORM/Sequelize?
- Superior type safety and DX
- Automatic migrations
- Excellent schema management
- Active development and community

#### Why Turborepo over Nx/Lerna?
- Simpler learning curve
- Fast incremental builds
- Great caching strategy
- Vercel backing ensures longevity

## 📋 Project Management Structure

### Epic → Story → Task → Issue Hierarchy

**Epics** (High-level initiatives):
- Epic 1: Core MCP Server
- Epic 2: Memory System
- Epic 3: Authentication & Security
- Epic 4: Analytics & Insights
- Epic 5: UI & Developer Experience

**Stories** (User-facing features):
- As a developer, I want to store conversation context
- As a user, I want to retrieve relevant historical memories
- As an admin, I want to monitor system health

**Tasks** (Implementation units):
- Set up NestJS project structure
- Implement Prisma schema
- Create Redis connection module

**Issues** (GitHub tracked work):
- Each task = 1 GitHub Issue
- Labels: `epic:*`, `story:*`, `type:*`, `priority:*`
- All work referenced by issue number

### GitHub Project Structure

```
Labels:
- epic:core-server
- epic:memory-system
- epic:auth
- epic:analytics
- epic:ui
- story:context-storage
- story:semantic-search
- type:feature
- type:bug
- type:docs
- type:ci-cd
- priority:critical
- priority:high
- priority:medium
- priority:low
- status:blocked
```

## 🚀 Project Lifecycle Phases

### Phase 0: Initialization ✅
- [x] Project structure setup
- [x] Monorepo configuration (Turborepo)
- [x] Development environment setup (Docker Compose)
- [ ] CI/CD pipeline skeleton

### Phase 1: Core Infrastructure
- [ ] NestJS server foundation
- [ ] Database connections (PostgreSQL, Redis, Qdrant)
- [ ] Prisma schema & migrations
- [ ] Basic MCP protocol implementation
- [ ] Docker development environment

### Phase 2: Memory Core
- [ ] Short-term memory (Redis-based)
- [ ] Long-term memory (PostgreSQL)
- [ ] Vector embeddings integration
- [ ] Semantic search implementation
- [ ] Memory CRUD operations via MCP

### Phase 3: Authentication
- [ ] OAuth 2.0 flow
- [ ] JWT token management
- [ ] Multi-tenant isolation
- [ ] Permission system

### Phase 4: Advanced Features
- [ ] Memory reconciliation engine
- [ ] Insight processing
- [ ] Analytics collection
- [ ] BullMQ job processing

### Phase 5: API & UI
- [ ] tRPC API layer
- [ ] Next.js frontend
- [ ] Analytics dashboard
- [ ] Memory visualization

### Phase 6: Production Readiness
- [ ] Performance optimization
- [ ] Security audit
- [ ] Load testing
- [ ] Documentation
- [ ] Deployment guides

## 🔧 Developer Setup

### Prerequisites
```bash
- Node.js 20+
- Docker & Docker Compose
- pnpm 8+
- Git
```

### Quick Start
```bash
# Clone repository
git clone https://github.com/osirison/engram.git
cd engram

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env
# Edit .env if you need to customize database credentials

# Start infrastructure (PostgreSQL, Redis, Qdrant)
pnpm docker:up

# Wait for services to be healthy (check with: pnpm docker:ps)
# All services should show status as "healthy"

# Run database migrations (once services are ready)
pnpm db:migrate

# Start development server
pnpm dev

# Run tests
pnpm test
```

### Docker Commands

ENGRAM uses Docker Compose to manage local development infrastructure:

```bash
# Start all services in detached mode
pnpm docker:up

# Check service status and health
pnpm docker:ps

# View logs from all services
pnpm docker:logs

# Restart all services
pnpm docker:restart

# Stop all services (keeps data)
pnpm docker:down

# Stop all services and remove volumes (deletes data)
pnpm docker:clean
```

**Services Running:**
- **PostgreSQL** (port 5432) - Main database
- **Redis** (port 6379) - Cache and job queue
- **Qdrant** (ports 6333/6334) - Vector database for semantic search

**Data Persistence:**
- All data is stored in named Docker volumes
- Data persists across container restarts
- Use `pnpm docker:clean` to reset all data

**Health Checks:**
All services include health checks that automatically verify:
- PostgreSQL: Database is accepting connections
- Redis: Server responds to PING
- Qdrant: Health endpoint returns OK

**Troubleshooting:**
```bash
# If services fail to start, check logs
pnpm docker:logs

# Connect to PostgreSQL directly
docker exec -it engram-postgres psql -U engram -d engram

# Connect to Redis CLI
docker exec -it engram-redis redis-cli

# Check Qdrant health
curl http://localhost:6333/health
```

### Monorepo Commands

ENGRAM uses Turborepo for fast, efficient builds across all packages. Here are the key commands:

```bash
# Build all packages
pnpm build

# Start development mode (with hot reload)
pnpm dev

# Run linting across all packages
pnpm lint

# Type-check all TypeScript code
pnpm typecheck

# Run all tests
pnpm test

# Format code with Prettier
pnpm format

# Clean all build outputs and node_modules
pnpm clean
```

**Turborepo Features:**
- ✅ **Incremental Builds** - Only rebuilds changed packages
- ✅ **Smart Caching** - Second build is instant (cache hit)
- ✅ **Parallel Execution** - Runs tasks concurrently when possible
- ✅ **Dependency Awareness** - Builds dependencies first (via `^build`)

**Working with Specific Packages:**
```bash
# Build only a specific package
cd packages/core && pnpm build

# Run tests in a specific package
cd packages/auth && pnpm test

# Add dependency to a specific package
cd packages/core && pnpm add lodash
```

### Environment Variables

Copy `.env.example` to `.env` and configure as needed:

```bash
cp .env.example .env
```

**Environment Validation:**

ENGRAM uses Zod schemas to validate environment variables on startup. This ensures configuration errors are caught early and provides type-safe access to configuration throughout the application.

**Required Variables** (validated on startup):
- `NODE_ENV` - Environment mode (development, production, test)
- `PORT` - Application port (default: 3000)
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `QDRANT_URL` - Qdrant vector database URL

The application will **fail fast on startup** if required variables are missing or invalid.

**Key Variables:**
```env
# Database (matches docker-compose.yml defaults)
DATABASE_URL="postgresql://engram:dev_password@localhost:5432/engram"
POSTGRES_USER=engram
POSTGRES_PASSWORD=dev_password
POSTGRES_DB=engram

# Redis
REDIS_URL="redis://localhost:6379"

# Qdrant Vector Database
QDRANT_URL="http://localhost:6333"

# Authentication (change in production!)
JWT_SECRET="your-secret-key-change-in-production-min-32-chars"
JWT_EXPIRES_IN="7d"

# Application
NODE_ENV=development
PORT=3000
```

**Type-Safe Configuration Access:**

Use NestJS ConfigService to access validated environment variables:

```typescript
import { ConfigService } from '@nestjs/config';
import type { Env } from '@engram/config';

@Injectable()
export class MyService {
  constructor(private config: ConfigService<Env>) {}

  getDatabaseUrl(): string {
    // Type-safe and guaranteed to exist
    return this.config.get('DATABASE_URL', { infer: true });
  }
}
```

**Note:** The default credentials in `.env.example` match the Docker Compose configuration for seamless local development. **Always change these values in production!**

## 📊 Success Metrics

- **Performance**: < 100ms p95 latency for memory retrieval
- **Reliability**: 99.9% uptime
- **Scalability**: Handle 10k+ concurrent users
- **Memory Accuracy**: > 95% relevance in semantic search
- **Test Coverage**: > 80% unit test coverage

## 🤝 Contributing

ENGRAM uses a structured, AI-optimized workflow for contributions. This ensures clarity, consistency, and efficient collaboration between humans and AI agents.

### Issue-Driven Development

**Every code change requires a GitHub issue.** We use structured templates that provide complete context, eliminating confusion and reducing back-and-forth.

#### Step 1: Find or Create an Issue

**IMPORTANT: Always start by reviewing open issues**

```bash
# List open issues to see available work
# Check for issues labeled with epic:* that match your skills
# Read the complete issue template before starting
```

**Use GitHub Issue Templates** (located in `.github/ISSUE_TEMPLATE/`):

1. **Feature Request** - For new features
   - Includes: Epic assignment, priority, technical scope, acceptance criteria
   - AI agents get all context needed without hunting through docs

2. **Bug Report** - For bugs
   - Includes: Severity, reproduction steps, affected files, error logs
   - Provides exact location and context for fixes

3. **Epic** - For high-level initiatives
   - Includes: Vision, user stories, milestones, success criteria
   - Used to plan major features that spawn multiple issues

**Search first!** Before creating a new issue, search existing issues to avoid duplicates.

#### Step 2: Work on the Issue

```bash
# Assign issue to yourself and update status
# Comment: "Starting work on this issue"
# Change label: status:todo → status:in-progress

# Create feature branch with issue number
git checkout -b feat/feature-name-#123

# Make changes following issue specifications
# - Files to modify are listed in "Technical Scope"
# - Patterns to follow are in "Implementation Notes"
# - Success defined by "Acceptance Criteria"

# Post progress updates to the issue
# - Comment when completing milestones
# - Report blockers immediately
# - Update epic with progress

# Commit with issue reference (single line only!)
git commit -m "feat(scope): description (#123)"
```

#### Step 3: Submit Pull Request

```bash
# Verify ALL acceptance criteria met
# Add completion summary to issue
# List all commits made for this issue

# Push your branch
git push origin feat/feature-name-#123

# Create PR with proper format
# - PR title: Same as issue title
# - PR description MUST include: "Closes #123"
# - Link to epic if applicable: "Part of #epic-number"
# - Include testing notes

# Update epic with completion
# Comment on epic: "Issue #123 completed"

# Issue auto-closes when PR merges to main
# Move to next open issue
```

### Contribution Requirements

All contributions must:
1. ✅ **Reference a GitHub issue** - Use issue templates
2. ✅ **Follow conventional commit format** - `type(scope): description (#issue)`
3. ✅ **Include tests** - Unit tests for services, integration for APIs
4. ✅ **Update documentation** - README, package docs, code comments
5. ✅ **Pass CI/CD checks** - Linting, type checking, tests
6. ✅ **Meet acceptance criteria** - Verify against issue checklist

### Commit Message Format

**IMPORTANT: Single-line commits only. No multi-line messages, no body.**

```
type(scope): description (#issue-number)

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation changes
- test: Test additions/changes
- refactor: Code refactoring
- chore: Maintenance tasks

Examples (all single line):
feat(memory): add semantic search capability (#45)
fix(auth): resolve token refresh bug (#67)
docs(readme): update installation steps (#23)
test(memory): add unit tests for retrieval (#55)
```

### Why This Workflow?

**For Humans:**
- Clear task definitions
- Visible project progress
- Easy onboarding for new contributors

**For AI Agents:**
- No context hunting - all info in the issue
- Clear success criteria - know when done
- Proper guidance - patterns and files specified
- Full traceability - epic → issue → commit → PR

### Getting Started

```bash
# 1. Fork the repository
# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/engram.git

# 3. Install dependencies
pnpm install

# 4. Create a branch for your issue
git checkout -b feat/your-feature-#issue-number

# 5. Make changes, commit, push
# 6. Create PR referencing issue
```

See [CLAUDE.md](./CLAUDE.md) for detailed AI agent instructions and coding patterns.

## 📄 License

MIT License - see LICENSE file

## 🔗 Links

- [Documentation](./docs)
- [Architecture Decision Records](./docs/adr)
- [API Reference](./docs/api)
- [Contributing Guide](./CONTRIBUTING.md)
- [Agents Guide](./AGENTS.md)

---

**Status**: 🚧 In Development | **Version**: 0.1.0-alpha | **Last Updated**: 2025-09-30