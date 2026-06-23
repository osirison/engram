<!-- markdownlint-disable-file -->

# Implementation Details: ENGRAM Profile Ladder for Accessible Enterprise Scale

## Context Reference

Sources:

- .copilot-tracking/research/2026-06-02/engram-lightweight-scalable-architecture-research.md
- .copilot-tracking/research/subagents/2026-06-02/runtime-dependencies-research.md
- .copilot-tracking/research/subagents/2026-06-02/intelligent-retrieval-research.md
- .copilot-tracking/research/subagents/2026-06-02/local-persistence-threat-model-research.md
- .copilot-tracking/research/subagents/2026-06-02/migration-slo-research.md

## Implementation Phase 1: Profile Infrastructure

<!-- parallelizable: true -->

### Step 1.1: Add profile resolver and conditional env validation

**Goal**: Make runtime profile a first-class configuration contract so startup requirements vary by mode.

**Exact changes**:

1. Create `packages/config/src/profile.ts`:
   - Export `enum DeploymentProfile { MEMORY = 'memory', LITE = 'lite', ENTERPRISE = 'enterprise' }`
   - Export `interface ProfileCapabilities { requiresDatabase: boolean; requiresRedis: boolean; requiresQdrant: boolean; ... }`
   - Export `function resolveCapabilities(profile: DeploymentProfile): ProfileCapabilities`
2. Update `packages/config/src/env.schema.ts`:
   - Add `DEPLOYMENT_PROFILE` as optional string, default to 'enterprise'
   - Make `DATABASE_URL` required only when profile is 'enterprise' or 'lite'
   - Make `REDIS_URL` required only when profile is 'enterprise'
   - Make `QDRANT_URL` required only when profile is 'enterprise'
   - Evidence: packages/config/src/env.schema.ts:10-12 in runtime-dependencies-research

Files to modify:

- packages/config/src/env.schema.ts
- packages/config/src/profile.ts (new)

Success criteria:

- `npm exec --yes pnpm@11.4.0 -- --filter config build` succeeds
- Environment validation allows DEPLOYMENT_PROFILE=memory without DATABASE_URL
- Environment validation requires DATABASE_URL when DEPLOYMENT_PROFILE=enterprise

Context references:

- packages/config/src/env.schema.ts (Lines 1-50)
- runtime-dependencies-research.md (Lines TBD)

Dependencies:

- None internal; packages/config is a dependency for other packages

### Step 1.2: Refactor AppModule to profile-aware startup

**Goal**: Use profile to conditionally wire Prisma, Redis, and Qdrant modules instead of unconditional imports.

**Exact changes**:

1. Update `apps/mcp-server/src/app.module.ts`:
   - Replace static @Module imports with DynamicModule pattern
   - Add `forRoot(profile?: DeploymentProfile)` factory method
   - Conditionally import PrismaModule only if profile !== 'memory'
   - Conditionally import RedisModule only if profile !== 'memory'
   - Conditionally import QdrantModule only if profile === 'enterprise'
   - Conditionally import MemoryModule (special: wrap with profile-aware capabilities)
   - Keep HealthModule always (but pass profile for conditional indicators)

Files to modify:

- apps/mcp-server/src/app.module.ts

Success criteria:

- `npm exec --yes pnpm@11.4.0 -- --filter mcp-server build` succeeds
- Startup with DEPLOYMENT_PROFILE=memory does not attempt Prisma connect
- Startup with DEPLOYMENT_PROFILE=enterprise imports and initializes all dependencies

Context references:

- apps/mcp-server/src/app.module.ts (Lines 1-50)
- runtime-dependencies-research.md (apps/mcp-server/src/app.module.ts:27-31)

Dependencies:

- Step 1.1 must complete (profile.ts resolution)

### Step 1.3: Add profile-aware health checks

**Goal**: Report health only for dependencies that are enabled in the active profile.

**Exact changes**:

1. Update `apps/mcp-server/src/health/health.module.ts`:
   - Add profile parameter to imports
   - Conditionally provide indicators based on active capabilities

2. Update `apps/mcp-server/src/health/health.controller.ts`:
   - Refactor buildIndicators() to read profile capabilities
   - Always include process health and memory availability
   - Include database health only if profile requires database
   - Include redis health only if profile requires redis
   - Include qdrant health only if profile is 'enterprise'

Files to modify:

- apps/mcp-server/src/health/health.module.ts
- apps/mcp-server/src/health/health.controller.ts

Success criteria:

- Health /health endpoint returns ok:true for profile-memory even without Postgres
- Health /health endpoint includes all indicators for profile-enterprise
- Health /ready endpoint reflects only required dependencies per profile

Context references:

- apps/mcp-server/src/health/health.controller.ts (Lines 26-54)
- runtime-dependencies-research.md (apps/mcp-server/src/health/health.controller.ts:26-54)

Dependencies:

- Step 1.1 and 1.2 must complete

### Step 1.4: Validate phase changes

Run validation commands and ensure build/lint pass.

Commands:

- `npm exec --yes pnpm@11.4.0 -- build`
- `npm exec --yes pnpm@11.4.0 -- lint`
- `npm exec --yes pnpm@11.4.0 -- typecheck`

Success criteria:

- All three commands pass without errors or warnings
- No type errors in profile-aware startup code

## Implementation Phase 2: Lightweight Memory Adapters + Retrieval

<!-- parallelizable: true -->

### Step 2.1: Implement in-process STM adapter for profile-memory

**Goal**: Provide memory-only short-term storage without Redis for profile-memory.

**Exact changes**:

1. Create `packages/memory-stm/src/adapters/inmemory-stm.adapter.ts`:
   - Export InMemoryStmAdapter implementing MemoryStmService interface
   - Use Map<string, StmMemory> for key-based storage
   - Implement TTL eviction using Map entries and setTimeout cleanup
   - Implement create(), findById(), list(), update(), delete(), promote(), semanticRecall()
   - Handle concurrent access safely (no race conditions needed for single-process)

2. Update `packages/memory-stm/src/memory-stm.module.ts`:
   - Add profile check to conditionally provide InMemoryStmAdapter or RedisService
   - Use MEMORY_STM_PROVIDER token

Files:

- packages/memory-stm/src/adapters/inmemory-stm.adapter.ts (new)
- packages/memory-stm/src/memory-stm.module.ts

Success criteria:

- InMemoryStmAdapter exports and implements MemoryStmService
- create() with TTL creates entry that expires after TTL seconds
- findById() returns memory or null
- Build succeeds: `npm exec --yes pnpm@11.4.0 -- --filter memory-stm build`

Context references:

- packages/memory-stm/src/memory-stm.service.ts (Lines 27-84)
- lightweight-hooks-research.md (packages/memory-stm/src/memory-stm.service.ts:27-29)

Dependencies:

- Phase 1 (profile infrastructure) must complete

### Step 2.2: Implement in-process LTM adapter for profile-memory

**Goal**: Provide memory-only long-term storage without Postgres for profile-memory.

**Exact changes**:

1. Create `packages/memory-ltm/src/adapters/inmemory-ltm.adapter.ts`:
   - Export InMemoryLtmAdapter implementing MemoryLtmService interface
   - Use Map<string, LtmMemory[]> keyed by userId for storage
   - Implement create(), get(), list(), update(), delete(), promote(), count(), semanticSearch(), reindex(), updateEmbedding()
   - semanticSearch() returns empty list when vector store unavailable (graceful degradation)
   - reindex() returns empty summary

2. Update `packages/memory-ltm/src/memory-ltm.module.ts`:
   - Add profile check to conditionally provide InMemoryLtmAdapter or database-backed service
   - Use MEMORY_LTM_PROVIDER token

Files:

- packages/memory-ltm/src/adapters/inmemory-ltm.adapter.ts (new)
- packages/memory-ltm/src/memory-ltm.module.ts

Success criteria:

- InMemoryLtmAdapter exports and implements MemoryLtmService
- create() returns memory with UUID and timestamps
- list() with filters works correctly
- Build succeeds: `npm exec --yes pnpm@11.4.0 -- --filter memory-ltm build`

Context references:

- packages/memory-ltm/src/memory-ltm.service.ts (Lines 41-113)

Dependencies:

- Phase 1 must complete
- Step 2.1 must complete (STM adapter ready)

### Step 2.3: Implement transient hybrid retrieval kernel

**Goal**: Add intelligent lexical + semantic ranking for profile-memory and lite without external vector store.

**Exact changes**:

1. Create `packages/memory-ltm/src/retrieval/hybrid-transient-retriever.ts`:
   - Export HybridTransientRetriever class
   - Implement transient lexical index (token postings, normalized)
   - Implement transient vector index (normalized embeddings)
   - Implement deterministic rank fusion using reciprocal-rank fusion (RRF)
   - Reference packages/eval/src/retrievers/fusion-retriever.ts:31-108 for RRF logic

2. Update `packages/memory-ltm/src/memory-ltm.service.ts`:
   - Inject HybridTransientRetriever conditionally when profile is memory/lite
   - In recall() method, route to HybridTransientRetriever.search() when available
   - Keep existing semanticSearch() path for profile-enterprise (via vector store)

Files:

- packages/memory-ltm/src/retrieval/hybrid-transient-retriever.ts (new)
- packages/memory-ltm/src/memory-ltm.service.ts (modify recall() routing)

Success criteria:

- HybridTransientRetriever.index() accepts memories and builds postings + vectors
- HybridTransientRetriever.search() returns ranked results with scores
- Lexical query "test" finds memories with "test" in content
- Semantic query with embedding finds similar memories
- Fallback to lexical-only when embeddings are null
- Build succeeds: `npm exec --yes pnpm@11.4.0 -- --filter memory-ltm build`

Context references:

- packages/eval/src/retrievers/fusion-retriever.ts (Lines 31-108)
- packages/memory-ltm/src/memory-ltm.service.ts (Lines 506-579)
- intelligent-retrieval-research.md

Dependencies:

- Phase 1 and 2.1, 2.2 must complete

### Step 2.4: Make Prisma and Redis startup lazy/optional

**Goal**: Defer DB/Redis connections until actually needed, or skip them entirely for memory/lite profiles.

**Exact changes**:

1. Update `packages/database/src/prisma.service.ts`:
   - Add profile check in constructor
   - Defer `$connect()` from onModuleInit() to first operation (lazy connect) when profile is memory/lite
   - Throw clear error if profile is lite and DB operations are attempted without lazy-connect

2. Update `packages/redis/src/redis.module.ts`:
   - Add profile parameter to factory
   - When profile is memory, provide a no-op Redis client or skip provider entirely
   - Keep existing behavior for enterprise profile

Files:

- packages/database/src/prisma.service.ts
- packages/redis/src/redis.module.ts

Success criteria:

- profile-memory startup does not attempt Prisma $connect()
- profile-lite lazy-connects on first DB operation
- profile-enterprise connects eagerly as before
- Build succeeds: `npm exec --yes pnpm@11.4.0 -- build`

Context references:

- packages/database/src/prisma.service.ts (Lines 28-29)
- packages/redis/src/redis.module.ts (Line 18)
- runtime-dependencies-research.md

Dependencies:

- Phase 1 must complete

### Step 2.5: Profile-aware MCP tool exposure

**Goal**: Hide unsupported tools in profile-memory and lite.

**Exact changes**:

1. Update `apps/mcp-server/src/memory/memory.controller.ts`:
   - Add profile check to getMcpTools() method
   - profile-memory: expose only create_memory, get_memory, list_memories, recall; hide reindex, queue_reindex, cancel_reindex
   - profile-lite: expose all tools except queue_reindex and cancel_reindex
   - profile-enterprise: expose all tools

2. Update `apps/mcp-server/src/main.ts`:
   - Pass profile to memory controller for tool filtering

Files:

- apps/mcp-server/src/memory/memory.controller.ts
- apps/mcp-server/src/main.ts

Success criteria:

- profile-memory MCP tool set does not include reindex operations
- profile-lite includes reindex operations
- profile-enterprise includes all operations
- Build succeeds: `npm exec --yes pnpm@11.4.0 -- --filter mcp-server build`

Context references:

- apps/mcp-server/src/main.ts (Lines 41-42)
- apps/mcp-server/src/memory/memory.controller.ts (Lines 619-700)
- lightweight-hooks-research.md

Dependencies:

- Phase 1 and 2.1, 2.2 must complete

### Step 2.6: Validate phase changes

Run build, lint, and profile-specific startup smoke test.

Commands:

- `npm exec --yes pnpm@11.4.0 -- build`
- `npm exec --yes pnpm@11.4.0 -- lint`
- `npm exec --yes pnpm@11.4.0 -- typecheck`
- `DEPLOYMENT_PROFILE=memory npm exec --yes pnpm@11.4.0 -- --filter mcp-server test:integration 2>&1 | head -20` (just verify startup)

Success criteria:

- All commands pass
- profile-memory startup completes without database connection attempts
- No lint or type errors in new adapter code

## Implementation Phase 3: Profile-Lite Durable Local + Security

<!-- parallelizable: false -->

### Step 3.1: Add local persistence layer

**Goal**: Provide durable local storage for profile-lite using SQLite or file-backed storage with security controls.

**Decision point**: SQLite via Prisma adapter vs file-backed JSON store.

**Recommended**: SQLite via Prisma adapter (simpler schema reuse, built-in constraints).

**Exact changes**:

1. Create `packages/memory-lite/src/` package or extend `packages/memory-ltm/src/adapters/`.
   - Export SqliteLtmAdapter implementing MemoryLtmService
   - Use Prisma client with SQLite connection to LOCAL_DATA_DIR
   - Reuse existing Memory schema or adapt for SQLite constraints

2. Update Prisma schema for profile-lite:
   - Use SQLite datasource when profile is 'lite'
   - Keep PostgreSQL datasource for enterprise

Files:

- packages/memory-lite/ (new package) or packages/memory-ltm/src/adapters/sqlite-ltm.adapter.ts
- prisma/schema.prisma (conditional datasource)

Success criteria:

- SQLite database creates at LOCAL_DATA_DIR/.engram/data/memory.db
- CRUD operations persist to SQLite
- Data survives process restart

Context references:

- local-persistence-threat-model-research.md
- prisma/schema.prisma (Lines 1-10 for datasource)

Dependencies:

- Phase 1 and 2 must complete

### Step 3.2: Implement secure-by-default controls for profile-lite

**Goal**: Enforce strict local persistence controls by default.

**Exact changes**:

1. Create permission validation in startup:
   - Check LOCAL_DATA_DIR exists and has mode 0700
   - Check all data files have mode 0600
   - Throw clear error if permissions too permissive
   - Refuse startup if LOCAL_ENCRYPTION_MODE is not set to 'required' or 'insecure' (with warning)

2. Implement encryption-at-rest:
   - Use AES-256-GCM for data encryption
   - Generate or prompt for passphrase via env or interactive prompt
   - Support per-record encryption with versioned nonce
   - Add key rotation interface (TBD for v1)

3. Add LOCAL_INSECURE_MODE flag:
   - Allow plaintext persistence only with explicit LOCAL_INSECURE_MODE=true
   - Print LOUD WARNING at startup when plaintext mode is active
   - Reject insecure mode if NODE_ENV !== 'development' (fail-fast for production)

Files:

- apps/mcp-server/src/config/secure-startup.ts (new, permission/encryption checks)
- packages/config/src/env.schema.ts (add LOCAL_ENCRYPTION_MODE, LOCAL_INSECURE_MODE)

Success criteria:

- Startup with LOCAL_DATA_DIR having mode 0777 fails with clear error
- Startup with LOCAL_ENCRYPTION_MODE=required encrypts data
- Startup with LOCAL_INSECURE_MODE=true in development logs warning
- Startup with LOCAL_INSECURE_MODE=true in production fails

Context references:

- local-persistence-threat-model-research.md (file permissions, encryption, break-glass)

Dependencies:

- Phase 1 and 3.1 must complete

### Step 3.3: Add logging redaction and auth hardening

**Goal**: Reduce secret exposure in logs and strengthen maintenance auth.

**Exact changes**:

1. Update `packages/core/src/logging/logging.module.ts`:
   - Add pino redaction config for fields: adminToken, authorization, apiKey, OPENAI_API_KEY, metadata
   - Reduce debug-level payload logging in production

2. Update `apps/mcp-server/src/memory/memory.controller.ts`:
   - Replace direct string equality check (line 62-69) with constant-time comparison
   - Add maintenance operation audit logging with minimal sensitive context

Files:

- packages/core/src/logging/logging.module.ts
- apps/mcp-server/src/memory/memory.controller.ts

Success criteria:

- Admin token is redacted in logs even if accidentally logged
- Maintenance operations are audited without leaking secrets
- Constant-time comparison prevents timing attacks on admin token

Context references:

- local-persistence-threat-model-research.md (logging redaction, auth hardening)
- apps/mcp-server/src/memory/memory.controller.ts (Lines 62-69)

Dependencies:

- Phase 1 and 3.2 must complete

### Step 3.4: Implement migration state service

**Goal**: Track promotion progress from profile-lite to enterprise for resumable operations.

**Exact changes**:

1. Create `apps/mcp-server/src/migration/migration-state.service.ts`:
   - Export MigrationStateService
   - Implement checkpointMigration(), resumeMigration(), completeMigration(), abortMigration()
   - Store state in Postgres (profile-enterprise only) or profile-lite persistent store

2. Add MigrationCheckpoint Prisma model (if using Postgres for state):
   ```prisma
   model MigrationCheckpoint {
     id String @id @default(cuid())
     sourceProfile String
     targetProfile String
     state String // 'preparing', 'copying', 'verifying', 'cutover', 'complete', 'rollback'
     cursor String?
     progress Int @default(0)
     totalItems Int?
     createdAt DateTime @default(now())
     updatedAt DateTime @updatedAt
   }
   ```

Files:

- apps/mcp-server/src/migration/migration-state.service.ts (new)
- prisma/schema.prisma (add MigrationCheckpoint model)

Success criteria:

- MigrationStateService tracks migration state persistently
- Interrupted migration can resume from last cursor
- State is updated atomically

Context references:

- migration-slo-research.md (migration state and checkpoints)

Dependencies:

- Phase 1 and 2 must complete

### Step 3.5: Add unit and security tests

**Goal**: Validate secure behavior and persistence correctness.

**Exact changes**:

1. Create test files:
   - `packages/memory-lite/src/__tests__/permission-enforcement.spec.ts`
   - `packages/memory-lite/src/__tests__/encryption.spec.ts`
   - `apps/mcp-server/src/__tests__/secret-redaction.spec.ts`

2. Test cases:
   - Permission enforcement: startup fails if LOCAL_DATA_DIR mode > 0700
   - Encryption: data at rest is not plaintext without LOCAL_INSECURE_MODE
   - Tenant isolation: one tenant cannot read another tenant's data
   - Secret redaction: admin token does not appear in logs
   - Unauthorized tenant: API rejects userId spoof attempts

Files:

- packages/memory-lite/src/**tests**/ (new test files)
- apps/mcp-server/src/**tests**/ (new test files)

Success criteria:

- All security and permission tests pass
- Test coverage >= 85% for security-critical paths

Context references:

- local-persistence-threat-model-research.md

Dependencies:

- Phase 3.1, 3.2, 3.3, 3.4 must complete

### Step 3.6: Validate phase changes

Run full build, lint, and security test suite.

Commands:

- `npm exec --yes pnpm@11.4.0 -- build`
- `npm exec --yes pnpm@11.4.0 -- lint`
- `npm exec --yes pnpm@11.4.0 -- test` (focused on security tests)

Success criteria:

- All commands pass
- No lint or type errors
- All security tests pass

## Implementation Phase 4: Migration Path and Quality Gates

<!-- parallelizable: false -->

### Step 4.1: Implement dual-write abstraction

**Goal**: Enable simultaneous writes to profile-lite and profile-enterprise during migration.

**Exact changes**:

1. Create `apps/mcp-server/src/migration/dual-write.service.ts`:
   - Intercept create(), update(), delete() in memory.service.ts
   - When migration state is 'copying', write to both source (lite) and target (enterprise) simultaneously
   - Add idempotent deduplication using migration state tracking
   - Log dual-write success/failure

Files:

- apps/mcp-server/src/migration/dual-write.service.ts (new)
- apps/mcp-server/src/memory/memory.service.ts (modify create/update/delete to use dual-write)

Success criteria:

- Writes during migration go to both stores
- Duplicate detection prevents double-writes
- Dual-write failures are logged and can be retried

Context references:

- migration-slo-research.md (dual-write design)

Dependencies:

- Phase 1, 2, 3, and step 3.4 must complete

### Step 4.2: Implement staged backfill

**Goal**: Use existing queue/reindex patterns to backfill historical data from source to target profile.

**Exact changes**:

1. Create `apps/mcp-server/src/migration/backfill.service.ts`:
   - Export BackfillService
   - Use apps/mcp-server/src/memory/reindex-queue.service.ts for resumable batch processing
   - Iterate source profile LTM store with cursor-based pagination
   - Copy each memory to target profile store
   - Handle per-item failures gracefully (skip and log)

2. Update migration-state.service.ts to track backfill progress

Files:

- apps/mcp-server/src/migration/backfill.service.ts (new)
- apps/mcp-server/src/migration/migration-state.service.ts (extend with backfill tracking)

Success criteria:

- Backfill processes source records in batches
- Progress is resumable after interruption
- Per-item failures do not block overall backfill

Context references:

- migration-slo-research.md (staged backfill design)
- packages/memory-ltm/src/memory-ltm.service.ts (Lines 589-681, cursor pattern)

Dependencies:

- Phase 1, 2, 3, and steps 3.4, 4.1 must complete

### Step 4.3: Add migration verification and gates

**Goal**: Ensure zero data loss and integrity during promotion.

**Exact changes**:

1. Create `apps/mcp-server/src/migration/verifier.service.ts`:
   - Export VerifierService
   - Implement integrity checks: per-user count match, global count match, hash comparison
   - Implement hard-stop threshold (e.g., mismatch > 0.001% aborts cutover)
   - Generate verification report with per-user and global summaries

Files:

- apps/mcp-server/src/migration/verifier.service.ts (new)

Success criteria:

- Verifier detects count mismatches
- Verifier produces actionable report
- Hard-stop threshold is enforced

Context references:

- migration-slo-research.md (verification gates, hard-stop threshold)

Dependencies:

- Phase 1, 2, 3, and steps 3.4, 4.1, 4.2 must complete

### Step 4.4: Add migration and rollback tests

**Goal**: Validate full migration happy path, failure recovery, and rollback.

**Exact changes**:

1. Create test files:
   - `apps/mcp-server/src/__tests__/migration-full-path.integration.spec.ts`
   - `apps/mcp-server/src/__tests__/migration-chaos.integration.spec.ts`

2. Test cases:
   - Happy path: profile-lite → enterprise with concurrent reads
   - Chaos: kill process during backfill, resume and verify no duplicates
   - Rollback: migration failure triggers rollback, source remains shadow-available

Files:

- apps/mcp-server/src/**tests**/migration-\*.spec.ts (new)

Success criteria:

- Happy path migration passes with zero data loss
- Chaos test passes with resume working correctly
- Rollback test passes with data intact

Context references:

- migration-slo-research.md (test and verification plan)

Dependencies:

- All Phase 4 steps must complete

### Step 4.5: Validate phase changes

Run full validation.

Commands:

- `npm exec --yes pnpm@11.4.0 -- build`
- `npm exec --yes pnpm@11.4.0 -- lint`
- `npm exec --yes pnpm@11.4.0 -- test`

Success criteria:

- All commands pass
- No lint or type errors
- All migration tests pass

## Implementation Phase 5: Docs, Quality Gates, and Release

<!-- parallelizable: false -->

### Step 5.1: Update README.md with profile-first onboarding

**Goal**: Make setup discovery obvious for all user personas.

**Changes**:

1. Add "Choose Your Profile" section above existing quick start
2. Create three minimal command paths (copy-paste ready)
3. Add profile feature matrix comparing setup friction, durability, scale
4. Move current Docker-first path under "Enterprise Profile" subsection

File:

- README.md

Success criteria:

- Three profile command paths are visible in first 50 lines
- Profile matrix is easy to scan
- No broken links or incomplete examples

### Step 5.2: Update docs/SETUP.md with profile-specific paths

**Goal**: Provide clear, scenario-specific setup instructions.

**Changes**:

1. Add profile selection guidance at top
2. Split setup flow into three subsections: Memory Profile, Lite Profile, Enterprise Profile
3. Add profile-to-profile migration runbook
4. Add recovery procedures for each profile

File:

- docs/SETUP.md

Success criteria:

- Each profile has clear prerequisites and commands
- Migration runbook is step-by-step
- Recovery procedures are specific to each profile

### Step 5.3: Update apps/mcp-server/README.md

**Goal**: Document MCP tool availability and behavior by profile.

**Changes**:

1. Add profile-specific tool availability table
2. Document health/ready semantics per profile
3. Document migration tools and prerequisites

File:

- apps/mcp-server/README.md

Success criteria:

- Tool matrix is clear
- Health behavior is documented
- No confusion about which tools are available in which profile

### Step 5.4: Add profile matrix test suite and CI gates

**Goal**: Ensure all profiles are tested before release.

**Changes**:

1. Create test matrix in CI configuration (GitHub Actions or equivalent):
   - Unit tests: all profiles
   - Integration: all profiles
   - Security: profile-lite and enterprise
   - Migration: profile-lite → enterprise
   - Docker E2E: enterprise (required), others optional

2. Add release gates to package.json or CI config

Files:

- .github/workflows/ (or equivalent CI config)
- package.json (test:matrix script)

Success criteria:

- CI tests all profiles
- Release is blocked if any profile test fails
- Test coverage >= 85% for new code

### Step 5.5: Set release quality gates

**Goal**: Define measurable criteria for GA readiness.

**Changes**:

1. Document SLO gates:
   - profile-memory: startup <= 5s, recall P95 <= 80ms at 10k memories
   - profile-lite: startup <= 8s, recall P95 <= 100ms at 50k memories
   - profile-enterprise: maintain existing benchmark guardrail, trend-regression budget <= 20ms

2. Document reliability gates:
   - Zero unreconciled records after migration
   - Zero data loss during migration chaos test
   - 99% startup success rate over 30-day window

3. Document security gates:
   - All secrets redacted in logs
   - Permission enforcement passes
   - Encryption enabled by default

File:

- docs/RELEASE_GATES.md (new) or docs/SETUP.md quality section

Success criteria:

- All gates are measurable and testable
- All gates pass before release

### Step 5.6: Final validation and sign-off

**Goal**: Ensure backward compatibility and comprehensive coverage.

**Changes**:

1. Run full validation suite:
   - `npm exec --yes pnpm@11.4.0 -- build`
   - `npm exec --yes pnpm@11.4.0 -- lint`
   - `npm exec --yes pnpm@11.4.0 -- typecheck`
   - `npm exec --yes pnpm@11.4.0 -- test`

2. Smoke test each profile:
   - DEPLOYMENT_PROFILE=memory: boot, create memory, recall
   - DEPLOYMENT_PROFILE=lite: boot, create memory, persist, restart, recall
   - DEPLOYMENT_PROFILE=enterprise: boot, create memory, vector search, reindex

3. Verify no breaking changes to enterprise profile (backward compatibility check)

Success criteria:

- All validation commands pass
- All profile smoke tests pass
- Enterprise profile behavior unchanged from baseline
- No data loss
- No breaking API changes

## Dependencies

- TypeScript 5.0+
- NestJS 10.0+
- Prisma 5.0+ with SQLite adapter
- Redis 6.0+ (optional for profile-memory and lite)
- Qdrant 1.0+ (optional for profile-memory and lite)
- pnpm 11.4.0+

## Success Criteria

- profile-memory starts without DATABASE_URL — traces to User requirement.
- profile-lite encrypts by default — traces to Security requirement.
- profile-enterprise is unchanged — traces to Backward-compatibility requirement.
- Intelligent hybrid retrieval is available in all profiles — traces to "AGE OF THE IMPOSSIBLE" requirement.
- Migration completes with zero data loss and P95 <= 2 minutes downtime — traces to SLO requirement.
- All profiles pass startup integration test — traces to Quality requirement.
- README setup commands are copy-paste ready — traces to Accessibility requirement.
