<!-- markdownlint-disable-file -->

# Task Research: ENGRAM Lightweight to Enterprise Deployment Path

Research what changes are required to run ENGRAM as a lightweight Memory MCP server with minimal local dependencies, while preserving a clear upgrade path to a high-quality enterprise deployment.

## Task Implementation Requests

- Identify what to change so ENGRAM can run with no external services or databases.
- Define how to keep architecture compatible with future scale-out to full deployment.
- Preserve intelligent retrieval in all profiles.
- Keep setup extremely easy for broad adoption while retaining enterprise-grade quality and security.

## Scope and Success Criteria

- Scope: Runtime architecture, module wiring, env validation, retrieval behavior, startup UX, migration/promotion path, security controls, and release quality gates.
- Assumptions:
  - "No other services or databases" means profile-memory starts with no Dockerized PostgreSQL, Redis, or Qdrant.
  - profile-lite is a durable local mode with no external services.
  - profile-enterprise preserves current production architecture.
- Success criteria:
  - Startup blockers and dependency couplings are identified with evidence.
  - Viable alternatives are evaluated and one approach is selected.
  - Intelligent retrieval is guaranteed in lightweight mode.
  - Migration, security, and quality gates are defined for production readiness.

## Outline

1. Baseline current runtime and dependency blockers.
2. Evaluate profile and retrieval alternatives.
3. Select product strategy that is easy-to-start and enterprise-scalable.
4. Define implementation plan with code-level impact.
5. Define SLO/security/quality gates.

## Potential Next Research

- Decide GA scale envelope by tenant count, corpus size, and retrieval QPS.
  - Reasoning: performance/reliability gates need explicit customer tiers.
  - Reference: package.json and scripts/bench-vector-backends.mjs.
- Finalize durable-local backend choice (SQLite adapter vs file-backed store).
  - Reasoning: impacts durability semantics, migration complexity, and security controls.
  - Reference: prisma/schema.prisma and packages/memory-ltm/src.

## Research Executed

### File Analysis

- .copilot-tracking/research/subagents/2026-06-02/runtime-dependencies-research.md
  - Startup blockers and hard dependency wiring.
- .copilot-tracking/research/subagents/2026-06-02/lightweight-hooks-research.md
  - Existing switches and graceful-degradation seams.
- .copilot-tracking/research/subagents/2026-06-02/architecture-alternatives-research.md
  - Architecture alternatives and staged rollout options.
- .copilot-tracking/research/subagents/2026-06-02/intelligent-retrieval-research.md
  - Intelligent retrieval strategy for no-persistence mode.
- .copilot-tracking/research/subagents/2026-06-02/migration-slo-research.md
  - Promotion/cutover SLO targets and migration design.
- .copilot-tracking/research/subagents/2026-06-02/local-persistence-threat-model-research.md
  - Threat model and secure-default controls for durable local mode.
- .copilot-tracking/research/subagents/2026-06-02/accessibility-scale-path-research.md
  - Easy-install to enterprise profile ladder and quality strategy.

### Code Search Results

- Hard required env vars: packages/config/src/env.schema.ts:10-12.
- Unconditional startup imports: apps/mcp-server/src/app.module.ts:27-31.
- Eager DB connect: packages/database/src/prisma.service.ts:28-29.
- Redis immediate connect: packages/redis/src/redis.module.ts:18.
- Vector backend switch exists: packages/vector-store/src/vector-store.module.ts:13-76.
- Qdrant still always wired in vector module: packages/vector-store/src/vector-store.module.ts:49.
- Health assumes full stack: apps/mcp-server/src/health/health.controller.ts:26-54.
- Graceful retrieval/embedding degradation exists:
  - packages/memory-ltm/src/memory-ltm.service.ts:513-520.
  - packages/memory-ltm/src/memory-ltm.service.ts:600-603.
  - packages/embeddings/src/embeddings.service.ts:97-105.
- Hybrid rank fusion reference exists in eval package:
  - packages/eval/src/retrievers/fusion-retriever.ts:31-108.

### External Research

- Not required for this iteration; repository evidence is sufficient.

### Project Conventions

- Standards referenced: AGENTS.md, .github/copilot-instructions.md, CLAUDE.md.
- Instructions followed: Task Researcher mode, write scope limited to .copilot-tracking/research.

## Key Discoveries

### Project Structure

- Runtime is enterprise-first today (Prisma, Redis, Qdrant assumed at boot).
- Core service layer already supports partial graceful degradation.
- Main blockers are startup composition and configuration contracts, not memory domain logic.

### Implementation Patterns

Reusable patterns:

- Config-driven provider/backend selection (VECTOR_BACKEND, EMBEDDING_PROVIDER).
- Optional injections in memory/embedding paths.
- Best-effort vector indexing and non-fatal embedding generation.
- Existing rank-fusion reference in eval code.

Blocking patterns:

- Required DATABASE_URL, REDIS_URL, QDRANT_URL for all modes.
- Eager bootstrap connections.
- Health checks tied to full dependency set.
- STM is Redis-coupled, LTM is Prisma-coupled.

### Configuration Examples

```dotenv
# profile-memory (zero dependency)
DEPLOYMENT_PROFILE=memory
EMBEDDING_PROVIDER=local
# DATABASE_URL not required
# REDIS_URL not required
# QDRANT_URL not required

# profile-lite (durable local)
DEPLOYMENT_PROFILE=lite
EMBEDDING_PROVIDER=local
LOCAL_DATA_DIR=.engram/data
LOCAL_ENCRYPTION_MODE=required

# profile-enterprise (current production model)
DEPLOYMENT_PROFILE=enterprise
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
VECTOR_BACKEND=qdrant
QDRANT_URL=http://qdrant:6333
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=...
```

## Technical Scenarios

### Scenario 1: Easy Install + Enterprise Scale

Recommended product model: three-profile ladder with one retrieval quality contract.

- profile-memory: instant setup, no external services, no persistence.
- profile-lite: secure durable local storage, no external services.
- profile-enterprise: current distributed stack for scale/reliability.

Why selected:

- Solves onboarding friction for broad adoption.
- Adds a practical local durability rung before enterprise complexity.
- Preserves enterprise compatibility and operational continuity.

### Scenario 2: Intelligent Retrieval In All Profiles

Requirement: no profile is allowed to devolve into "dumb lookup."

Selected retrieval strategy:

- Hybrid lexical + semantic retrieval with deterministic fusion.
- In profile-memory and profile-lite, run a transient in-process retrieval kernel:
  - lexical postings/candidates,
  - normalized vector scoring,
  - rank fusion and stable tie-breaks.
- Lexical-only remains a fallback, not the default.

Rationale:

- Preserves query intelligence without external infrastructure.
- Maintains fast local response due to in-process ranking.
- Keeps API contract stable while swapping backend implementation by profile.

### Scenario 3: Secure Local Durability

Selected security posture for profile-lite: strict-by-default with accessibility rails.

Defaults:

- Encrypted-at-rest local data.
- Owner-only file permissions.
- No weak default admin token.
- Logging redaction for sensitive fields.
- Tenant binding from authenticated context (not caller-provided userId).

Accessibility rail:

- Explicit local insecure break-glass mode allowed only with deliberate override and warning.

### Scenario 4: Promotion To Enterprise

Selected migration design:

- In-place dual-write + staged backfill + verification + cutover + rollback window.

Why selected:

- Best downtime posture with practical rollback path.
- Reuses existing queue/reindex primitives and idempotent processing patterns.

#### Considered Alternatives

1. Snapshot export/import hard freeze.
   - Rejected as primary due to larger downtime and blast radius.
2. Blue-green replay queue.
   - Rejected for first release due to complexity and missing event-replay infrastructure.
3. In-place dual-write + staged backfill.
   - Selected for balance of safety, uptime, and implementation leverage.

## Selected Approach and Rationale

Selected approach: productized profile ladder plus mandatory intelligent hybrid retrieval.

- profile-memory for zero-dependency onboarding.
- profile-lite for secure durable local usage.
- profile-enterprise for production scale.

This is selected because it simultaneously meets:

- accessibility to all (minimal setup),
- high retrieval quality (hybrid intelligence in every profile),
- enterprise-grade path (security, migration, and reliability controls).

## Required Implementation Changes

### Core Runtime and Config

1. Add DEPLOYMENT_PROFILE and profile-capability resolver.
   - Update packages/config/src/env.schema.ts.
2. Make startup module graph profile-aware.
   - Update apps/mcp-server/src/app.module.ts.
3. Make health indicators profile-aware.
   - Update apps/mcp-server/src/health/health.module.ts.
   - Update apps/mcp-server/src/health/health.controller.ts.
4. Remove mode-inappropriate eager dependency assumptions.
   - Update packages/database/src/prisma.service.ts.
   - Update packages/redis/src/redis.module.ts.

### Memory and Retrieval

1. Add in-process STM/LTM adapters for profile-memory.
2. Add durable local adapters for profile-lite.
3. Add transient hybrid retrieval kernel for non-enterprise profiles.
4. Keep MCP tool surface stable and gate unsupported maintenance tools by profile.
   - Update apps/mcp-server/src/memory/memory.controller.ts and apps/mcp-server/src/main.ts.

### Security and Operations

1. Add secure local persistence controls (permissions, encryption, redaction).
2. Replace weak/default admin token paths for non-test operation.
3. Add migration controls for dual-write/backfill/cutover/rollback.

### Likely New Files

- apps/mcp-server/src/config/deployment-profile.ts
- packages/memory-stm/src/adapters/inmemory-stm.adapter.ts
- packages/memory-ltm/src/adapters/inmemory-ltm.adapter.ts
- packages/memory-ltm/src/retrieval/hybrid-transient-retriever.ts
- apps/mcp-server/src/migration/migration-state.service.ts

## Quality And Release Gates

### Reliability and Migration SLO Targets

- Planned cutover downtime: P95 <= 2 minutes, P99 <= 5 minutes.
- Read availability during migration: >= 99.95%.
- Data integrity after promotion: 0 unreconciled records.
- Rollback trigger start: <= 10 minutes from hard failure detection.
- Rollback completion: <= 30 minutes metadata rollback, <= 2 hours full restore path.

### Performance Targets

- profile-memory: startup <= 5s on dev laptop, recall P95 <= 80ms at 10k memories.
- profile-lite: startup <= 8s, recall P95 <= 100ms at 50k memories.
- profile-enterprise: maintain existing benchmark guardrail and trend-regression budget.

### Test Matrix

- Unit tests: all profiles.
- MCP contract tests: all profiles.
- Startup integration tests: all profiles.
- Security tests: profile-lite and enterprise.
- Migration and rollback tests: profile-lite and enterprise.
- Docker E2E: required for enterprise, optional for memory/lite.

## Actionable Next Steps

1. Implement profile resolver + conditional env schema.
2. Refactor AppModule and health wiring to profile-aware composition.
3. Implement profile-memory adapters + hybrid transient retriever.
4. Implement profile-lite durable local adapters with strict security defaults.
5. Implement promotion path (dual-write + staged backfill + verification).
6. Add profile matrix test suite and release gates.
7. Update README.md, docs/SETUP.md, and apps/mcp-server/README.md with profile-first onboarding and migration runbooks.

## Final Product Recommendation

Build ENGRAM as a profile-first AI Agentic Memory system where:

- setup is instant for newcomers,
- retrieval stays intelligent and fast in every profile,
- operations mature progressively from local to enterprise,
- security and reliability improve by default as users scale.
