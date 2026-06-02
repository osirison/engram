<!-- markdownlint-disable-file -->

# Task Research: ENGRAM Lightweight to Enterprise Deployment Path

Research what changes are required to run ENGRAM as a lightweight Memory MCP server with minimal local dependencies, while preserving a clear upgrade path to the full enterprise deployment model.

## Task Implementation Requests

- Identify what to change so ENGRAM can run with no external services or databases.
- Define how to keep architecture compatible with future scale-out to full deployment.
- Provide concrete file-level and configuration-level changes.

## Scope and Success Criteria

- Scope: Runtime architecture, package/module wiring, environment config, startup scripts, docs, and migration path.
- Assumptions:
  - "No other services or databases" means no required Dockerized PostgreSQL, Redis, or Qdrant at startup.
  - A local process-only mode may still persist memory in-process or file-based storage.
  - Existing enterprise deployment behavior must remain available.
- Success Criteria:
  - Identify current hard dependencies that block lightweight startup.
  - Present at least 2 viable approaches and select one recommended approach.
  - Provide concrete implementation plan with file references and validation steps.

## Outline

1. Baseline current runtime architecture and hard startup dependencies.
2. Evaluate minimal-runtime architecture options.
3. Recommend one approach with staged rollout from lightweight to enterprise.
4. Define exact file/config/test/docs changes.

## Potential Next Research

- Define migration SLO from profile-memory/profile-lite to profile-enterprise.
  - Reasoning: Promotion path needs measurable downtime and data integrity targets.
  - Reference: apps/mcp-server/src/reindex.cli.ts
- Threat-model local persistence option before enabling it by default.
  - Reasoning: Local file persistence needs clear encryption and permissions guidance.
  - Reference: docs/SETUP.md

## Research Executed

### File Analysis

- .copilot-tracking/research/subagents/2026-06-02/runtime-dependencies-research.md
  - Verified startup blockers and hard dependency wiring.
- .copilot-tracking/research/subagents/2026-06-02/lightweight-hooks-research.md
  - Verified existing toggles and graceful-degradation seams.
- .copilot-tracking/research/subagents/2026-06-02/architecture-alternatives-research.md
  - Evaluated alternatives and staged rollout options.

### Code Search Results

- Required envs and mode toggles in packages/config/src/env.schema.ts:10-18
- Root module dependency wiring in apps/mcp-server/src/app.module.ts:27-31
- Eager Prisma connect in packages/database/src/prisma.service.ts:28-29
- Redis immediate connect in packages/redis/src/redis.module.ts:18
- Vector backend selection in packages/vector-store/src/vector-store.module.ts:13-76
- Qdrant always imported in packages/vector-store/src/vector-store.module.ts:49
- Health hard dependency checks in apps/mcp-server/src/health/health.controller.ts:26-54
- Optional behavior in memory/embeddings paths:
  - packages/memory-ltm/src/memory-ltm.service.ts:513-520
  - packages/memory-ltm/src/memory-ltm.service.ts:600-603
  - packages/embeddings/src/embeddings.service.ts:97-105

### External Research

- Not required for this iteration. Repository analysis was sufficient.

### Project Conventions

- Standards referenced: AGENTS.md, .github/copilot-instructions.md, CLAUDE.md
- Instructions followed: Task Researcher mode constraints and `.copilot-tracking/research` scope

## Key Discoveries

### Project Structure

- ENGRAM boot path is enterprise-first and imports Prisma, Redis, and Qdrant by default.
- Memory and vector features already include optional or degraded behavior in service logic.
- Main gap is startup/module composition and env validation, not domain logic.
- Intelligent retrieval is also already modeled in the eval package, which gives us a production-shape reference for hybrid ranking.

### Implementation Patterns

- Existing reusable patterns:
  - Config-driven backend/provider selection (VECTOR_BACKEND, EMBEDDING_PROVIDER).
  - Optional dependency injection in LTM/embeddings services.
  - Graceful no-vector behavior in semantic search and reindex.
  - Hybrid lexical + semantic fusion in `packages/eval/src/retrievers/fusion-retriever.ts:31-108`.
- Blocking patterns to change:
  - Unconditional required env vars for DATABASE_URL, REDIS_URL, QDRANT_URL.
  - Eager DB/Redis startup connections.
  - Unconditional Qdrant wiring even when pgvector is selected.
  - Health checks always expecting full external stack.

### Complete Examples

```dotenv
# New top-level profile switch
DEPLOYMENT_PROFILE=memory

# Enterprise-compatible defaults (existing behavior)
VECTOR_BACKEND=qdrant
EMBEDDING_PROVIDER=openai

# Memory profile defaults
# No DATABASE_URL required
# No REDIS_URL required
# No QDRANT_URL required
EMBEDDING_PROVIDER=local
VECTOR_BACKEND=qdrant
```

```text
Profile matrix (recommended)

profile-memory:
  external services: none
  persistence: process memory only
  semantic recall: transient hybrid lexical + semantic index
  target: local quick-start, demos, CI smoke

profile-enterprise:
  external services: Postgres + Redis + Qdrant/pgvector
  persistence: durable
  semantic recall: full
  target: production scale

profile-lite (optional later):
  external services: none
  persistence: local embedded store (SQLite/file)
  target: single-node persistent local deployments
```

### API and Schema Documentation

- Current env schema hard-requires external URLs: packages/config/src/env.schema.ts:10-12.
- Existing provider/backend switches enable profile-oriented behavior: packages/config/src/env.schema.ts:16-18.
- MCP tools are registered through a single seam and can be profile-filtered: apps/mcp-server/src/main.ts:41-42 and apps/mcp-server/src/memory/memory.controller.ts:619.

### Configuration Examples

```dotenv
# profile-memory (zero external dependencies)
DEPLOYMENT_PROFILE=memory
EMBEDDING_PROVIDER=disabled

# profile-enterprise (current/full deployment)
DEPLOYMENT_PROFILE=enterprise
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
VECTOR_BACKEND=qdrant
QDRANT_URL=http://qdrant:6333
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=...
```

## Technical Scenarios

### Lightweight Runtime (No External Services)

Goal: start ENGRAM MCP server with no PostgreSQL, no Redis, and no Qdrant while preserving a safe, explicit upgrade path to enterprise.

Selected approach: profile-driven modular architecture with two required profiles now, and one optional profile later.

- profile-memory (required now): no external services or databases; in-process storage adapters with hybrid transient retrieval.
- profile-enterprise (required now): existing behavior preserved as default production mode.
- profile-lite (optional later): embedded persistence for local durability.

Rationale:

- Satisfies immediate requirement for "simple Memory MCP server" with zero external dependencies.
- Uses existing code seams for graceful degradation and provider selection.
- Avoids destabilizing current enterprise deployments.
- Keeps a clean migration path by implementing mode-specific adapters behind existing service contracts.
- Preserves intelligent retrieval by treating lexical and semantic scoring as a transient in-memory kernel, not as a database feature.

Implementation request coverage:

- No-services startup is enabled by conditional env validation and dynamic module imports.
- Future enterprise scale remains intact via profile-enterprise and unchanged APIs.
- File-level change list and rollout are provided below.

#### Required code changes (phase 1: profile-memory + profile-enterprise)

1. Add deployment profile parsing and conditional env requirements.
   - Update packages/config/src/env.schema.ts.
   - Require DATABASE_URL/REDIS_URL/QDRANT_URL only when profile-enterprise needs them.
2. Make root module imports profile-aware.
   - Update apps/mcp-server/src/app.module.ts.
   - Skip PrismaModule, RedisModule, QdrantModule, and heavy health dependencies in profile-memory.
3. Remove eager mandatory connections for optional profiles.
   - Update packages/database/src/prisma.service.ts.
   - Update packages/redis/src/redis.module.ts (lazy connect when profile-memory is active or module omitted).
4. Decouple health checks from full stack assumptions.
   - Update apps/mcp-server/src/health/health.controller.ts and related indicators.
   - In profile-memory, report process health without external dependency checks.
5. Provide in-process memory adapters.
   - Add in-memory STM implementation for profile-memory.
   - Add in-memory LTM implementation for profile-memory.
   - Wire adapters behind existing memory service contracts.
6. Add transient intelligent retrieval kernel.

- Introduce an in-memory lexical inverted index and normalized embedding store.
- Fuse lexical and semantic scores using the eval package as the reference model.
- Fall back to lexical-only when embeddings are unavailable, but do not make that the default.

7. Profile-aware MCP tool exposure.
   - Update apps/mcp-server/src/memory/memory.controller.ts tool list assembly path.
   - Hide or no-op enterprise-only admin queue/reindex operations in profile-memory.

#### Optional code changes (phase 2: profile-lite persistent local mode)

1. Add embedded persistence adapter (SQLite/file-backed).
2. Add import/export and promotion tooling into profile-enterprise.
3. Add migration command and runbook.

#### File impact map

Core/high-confidence updates:

- packages/config/src/env.schema.ts
- apps/mcp-server/src/app.module.ts
- apps/mcp-server/src/main.ts
- apps/mcp-server/src/health/health.module.ts
- apps/mcp-server/src/health/health.controller.ts
- packages/database/src/prisma.service.ts
- packages/redis/src/redis.module.ts
- packages/vector-store/src/vector-store.module.ts
- apps/mcp-server/src/memory/memory.controller.ts
- apps/mcp-server/src/memory/memory.module.ts
- packages/memory-stm/src/memory-stm.module.ts
- packages/memory-ltm/src/memory-ltm.module.ts

Likely new files:

- apps/mcp-server/src/config/deployment-profile.ts
- packages/memory-stm/src/adapters/inmemory-stm.adapter.ts
- packages/memory-ltm/src/adapters/inmemory-ltm.adapter.ts

Docs updates:

- README.md
- docs/SETUP.md
- apps/mcp-server/README.md

#### Considered Alternatives

1. Alternative rejected as primary: pure in-memory only forever.
   - Rejected because it has no durable path for long-lived memory workloads and creates weak promotion semantics.
   - Evidence: architecture comparison in .copilot-tracking/research/subagents/2026-06-02/architecture-alternatives-research.md.
2. Alternative rejected as immediate requirement fit: keep current external-services model with minor flags only.
   - Rejected because it does not satisfy strict no-services/no-database startup requirement.
   - Evidence: hard blockers in packages/config/src/env.schema.ts:10-12 and packages/database/src/prisma.service.ts:14,28-29.
3. Alternative deferred: SQLite-first as mandatory lightweight mode.
   - Deferred because user requirement explicitly asks for no databases in the simple mode.
   - Retained as optional profile-lite follow-up for durability.

## Selected Approach and Rationale

Selected approach: profile-driven modular architecture with profile-memory and profile-enterprise as first-class modes.

Why this is selected:

- Directly satisfies zero external dependencies for a simple MCP server.
- Uses existing resilient code paths for optional embeddings/vector behaviors.
- Preserves enterprise deployment with minimal behavioral change risk.
- Supports future optional durability profile without redesigning APIs.
- Keeps retrieval intelligent in the lightweight profile by making hybrid rank fusion a first-class in-memory concern.

## Actionable Next Steps

1. Implement profile parsing and conditional env schema rules.
2. Refactor AppModule to dynamic profile-based imports.
3. Add in-memory STM/LTM adapters and wire via dependency injection tokens.
4. Add transient lexical and semantic retrieval indexes plus deterministic fusion.
5. Make health checks and MCP tool exposure profile-aware.
6. Add tests:
   - Boot test for profile-memory with no external services.
   - Regression boot/health/tool tests for profile-enterprise.
7. Update docs with a profile matrix and copy-paste quick starts.

## Intelligent Retrieval Scenario

### Profile-Memory Intelligent Lookup

Goal: keep retrieval smart, fast, and mass-accessible without persistence.

Recommended mechanism:

- Build a transient retrieval store in process memory.
- Index each memory into:
  - a token/posting structure for lexical candidate generation,
  - a normalized vector array for semantic similarity,
  - lightweight metadata such as recency and tags for tie-breaking.
- Score queries using a deterministic hybrid fusion pipeline.
- Prefer lexical retrieval for short or identifier-heavy queries.
- Prefer semantic retrieval for natural-language queries.
- Return stable, explainable rankings.

Why this is the right baseline:

- It preserves intelligence even with zero services and no database.
- It is fast enough for local and demo workloads because all ranking stays in process.
- It is accessible to the masses because setup becomes a single-process startup instead of an infrastructure project.
- It maps directly to an existing reference implementation in `packages/eval/src/retrievers/fusion-retriever.ts:31-108`.

Implementation notes:

- Use `EMBEDDING_PROVIDER=local` as the preferred lightweight embedding source when possible.
- Keep lexical-only behavior as a fallback, not as the default product experience.
- Keep the public `recall` API stable and swap only the backend retrieval engine by profile.
- Reuse the current no-fatal embedding behavior in `packages/embeddings/src/embeddings.service.ts:97-105` so retrieval can still answer when semantic features degrade.

#### Considered Alternatives

1. Lexical-only in-memory retrieval.

- Rejected as the default because it is fast but not intelligent enough for paraphrases or natural-language queries.

2. Semantic-only in-memory retrieval.

- Rejected as the default because it loses exact-term precision and can become expensive as the transient corpus grows.

3. Hybrid lexical + semantic with deterministic fusion.

- Selected because it balances recall, precision, speed, and accessibility without requiring external services.
