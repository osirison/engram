gac---
applyTo: '.copilot-tracking/changes/2026-06-23/profile-ladder-changes.md'

---

<!-- markdownlint-disable-file -->

# Implementation Plan: ENGRAM Profile Ladder for Accessible Enterprise Scale

## Overview

Build ENGRAM as a three-profile AI agentic memory system with instant zero-dependency onboarding (profile-memory), secure local durability (profile-lite), and production-scale operations (profile-enterprise), while guaranteeing intelligent hybrid retrieval across all profiles.

## Objectives

### User Requirements

- User wants to run ENGRAM with no external services or databases for quick local setup.
  - Source: User request, 2026-06-02 conversation.
- User wants a clear upgrade path to full enterprise deployment without redesign.
  - Source: User request, 2026-06-02 conversation.
- User wants intelligent retrieval even in lightweight modes, not degraded or empty fallback.
  - Source: User request, "AGE OF THE IMPOSSIBLE" emphasis, 2026-06-02 conversation.
- User wants the final product to be highly accessible to all while scaling to enterprise.
  - Source: User request, 2026-06-02 conversation.

### Derived Objectives

- Eliminate setup friction by making profile-memory the default for first-time users.
  - Derived from: accessibility goal and zero-dependency requirement.
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/accessibility-scale-path-research.md.
- Preserve enterprise deployment intact with no breaking changes to current workflow.
  - Derived from: backward-compatibility requirement and team operational continuity.
  - Evidence: AGENTS.md, project conventions.
- Define measurable quality gates for each profile before GA release.
  - Derived from: "highest quality" requirement and enterprise adoption criteria.
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/accessibility-scale-path-research.md.

## Context Summary

### Project State

- ENGRAM is a TypeScript monorepo MCP memory server with NestJS runtime backed by Prisma/PostgreSQL, Redis, and Qdrant.
- Current startup is enterprise-first: unconditional imports for Prisma, Redis, Qdrant modules and hard-required env vars.
- Core memory services support partial graceful degradation (optional embeddings, best-effort vector indexing).
- Existing hybrid rank-fusion reference implementation is in packages/eval/src/retrievers/ but not wired to production path.

### Constraints

- Production environment continues unchanged until profile-enterprise is explicitly selected.
- Existing API contracts and MCP tool surface must remain stable across profile transitions.
- Migration from lightweight profiles to enterprise must preserve all memory data with zero loss.
- Local persistence in profile-lite must default to secure (encrypted at rest, owner-only permissions).

### Research Consensus

- Selected approach: three-profile ladder (memory, lite, enterprise) + mandatory intelligent hybrid retrieval.
- Retrieval invariant: all profiles use hybrid lexical + semantic fusion, not degraded lookup.
- Migration design: in-place dual-write + staged backfill + verification + cutover + rollback window.
- Security: strict-by-default for profile-lite, with explicit break-glass for local insecure mode.

## Implementation Checklist

### Implementation Phase 1: Profile Infrastructure

<!-- parallelizable: true -->

- [x] Step 1.1: Add profile resolver and conditional env validation
  - Update packages/config/src/env.schema.ts to add DEPLOYMENT_PROFILE enum and make DATABASE_URL/REDIS_URL/QDRANT_URL conditional by profile
  - Add new config file packages/config/src/profile.ts with ProfileConfig interface and capability resolver
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md (Lines TBD)
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/runtime-dependencies-research.md (packages/config/src/env.schema.ts:10-12)
- [x] Step 1.2: Refactor AppModule to profile-aware startup
  - Update apps/mcp-server/src/app.module.ts to use DynamicModule pattern with conditional imports
  - Skip PrismaModule, RedisModule, QdrantModule when profile is memory or lite
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/runtime-dependencies-research.md (apps/mcp-server/src/app.module.ts:27-31)
- [x] Step 1.3: Add profile-aware health checks
  - Update apps/mcp-server/src/health/health.module.ts and health.controller.ts to build indicator list conditionally
  - Profile-memory reports process health only, profile-lite adds local store health, profile-enterprise includes all dependencies
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/runtime-dependencies-research.md (apps/mcp-server/src/health/health.controller.ts:26-54)
- [x] Step 1.4: Validate phase changes
  - Run: npm exec --yes pnpm@11.4.0 -- build
  - Run: npm exec --yes pnpm@11.4.0 -- lint
  - Run: npm exec --yes pnpm@11.4.0 -- typecheck
  - Skip full test suite for this phase; defer to Phase 3

### Implementation Phase 2: Lightweight Memory Adapters + Retrieval

<!-- parallelizable: true -->

- [x] Step 2.1: Implement in-process STM adapter for profile-memory
  - Create packages/memory-stm/src/adapters/inmemory-stm.adapter.ts
  - Implement MemoryStmService interface with in-process Map storage and TTL eviction
  - Wire via dependency token MEMORY_STM_PROVIDER in profile-memory
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/lightweight-hooks-research.md (packages/memory-stm/src/memory-stm.service.ts:27-29)
- [ ] Step 2.2: Implement in-process LTM adapter for profile-memory
  - Create packages/memory-ltm/src/adapters/inmemory-ltm.adapter.ts
  - Implement MemoryLtmService interface with in-process Map storage, no persistence
  - Wire via dependency token MEMORY_LTM_PROVIDER in profile-memory
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
- [ ] Step 2.3: Implement transient hybrid retrieval kernel
  - Create packages/memory-ltm/src/retrieval/hybrid-transient-retriever.ts
  - Implement lexical postings index, normalized vector array, and rank fusion using reciprocal-rank fusion
  - Reuse packages/eval/src/retrievers/fusion-retriever.ts as reference
  - Wire into memory.service.ts recall path by profile
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/intelligent-retrieval-research.md (packages/eval/src/retrievers/fusion-retriever.ts:31-108)
- [x] Step 2.4: Make Prisma and Redis startup lazy/optional
  - Update packages/database/src/prisma.service.ts to use lazyConnect pattern when profile is memory/lite
  - Update packages/redis/src/redis.module.ts to lazy-connect when profile is memory or lite
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/runtime-dependencies-research.md (packages/database/src/prisma.service.ts:28-29, packages/redis/src/redis.module.ts:18)
- [x] Step 2.5: Profile-aware MCP tool exposure
  - Update apps/mcp-server/src/memory/memory.controller.ts to conditionally register tools by profile
  - Hide reindex, queue_reindex, cancel_reindex from profile-memory; keep full set in profile-enterprise
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/lightweight-hooks-research.md (apps/mcp-server/src/main.ts:41-42)
- [x] Step 2.6: Validate phase changes
  - Run: npm exec --yes pnpm@11.4.0 -- build
  - Run: npm exec --yes pnpm@11.4.0 -- lint
  - Run: npm exec --yes pnpm@11.4.0 -- typecheck
  - Run profile-memory startup integration test (defer full suite to Phase 3)

### Implementation Phase 3: Profile-Lite Durable Local + Security

<!-- parallelizable: false -->

- [x] Step 3.1: Add local persistence layer (file-backed JSON; SQLite swapped per DD-01)
  - Create packages/memory-lite or extend packages/memory-ltm/src/adapters with local store
  - Support SQLite-backed storage (via Prisma SQLite adapter) or file-backed JSON store (TBD by architecture review)
  - Implement idempotent CRUD with durability guarantees
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/local-persistence-threat-model-research.md
- [x] Step 3.2: Implement secure-by-default controls for profile-lite
  - Add owner-only file permissions (0700 dir, 0600 files) with startup validation
  - Implement encrypted-at-rest storage using AES-256-GCM with key versioning
  - Add explicit LOCAL_ENCRYPTION_MODE=required default with LOCAL_INSECURE_MODE break-glass
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/local-persistence-threat-model-research.md
- [x] Step 3.3: Add logging redaction and auth hardening
  - Extend packages/core/src/logging/logging.module.ts with pino redaction rules for secrets
  - Replace direct admin token equality check with constant-time comparison in memory.controller.ts
  - Add maintenance operation audit logging
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
- [x] Step 3.4: Implement migration state service for dual-write tracking
  - Create apps/mcp-server/src/migration/migration-state.service.ts to track profile promotion state
  - Add MigrationCheckpoint Prisma model or profile-lite equivalent for resumable promotion
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/migration-slo-research.md
- [x] Step 3.5: Add unit and security tests for profile-lite
  - Unit tests: permission enforcement, encryption key handling, tenant isolation
  - Security tests: secret redaction, unauthorized tenant spoof rejection, break-glass warning
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
- [x] Step 3.6: Validate phase changes
  - Run: npm exec --yes pnpm@11.4.0 -- build
  - Run: npm exec --yes pnpm@11.4.0 -- lint
  - Run: npm exec --yes pnpm@11.4.0 -- test (focused on security/persistence tests)

### Implementation Phase 4: Migration Path and Quality Gates

<!-- parallelizable: false -->

- [x] Step 4.1: Implement dual-write abstraction
- [x] Step 4.2: Implement staged backfill using existing queue/reindex primitives
- [x] Step 4.3: Add migration verification and gates
- [x] Step 4.4: Add Postgres `MigrationCheckpoint` backend wired into `MigrationStateService` via `selectCheckpointBackend(capabilities, opts)`
  - Create migration abstraction in memory.service.ts to write to both profile-lite and profile-enterprise simultaneously
  - Add idempotent deduplication logic using migration state tracking
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/migration-slo-research.md
- [ ] Step 4.2: Implement staged backfill using existing queue/reindex primitives
  - Add bulk promotion API using apps/mcp-server/src/memory/reindex-queue.service.ts for resumable batches
  - Use cursor-based pagination and per-item fail-safe behavior from packages/memory-ltm/src/memory-ltm.service.ts:589-681
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/migration-slo-research.md (packages/memory-ltm/src/memory-ltm.service.ts:589-681)
- [ ] Step 4.3: Add migration verification and gates
  - Implement per-user and global integrity checks (count match, hash comparison, metadata diff <= 0.001%)
  - Add hard-stop threshold for cutover approval
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
- [x] Step 4.5: Add migration and rollback tests
  - Integration tests: full happy path with concurrent reads during migration
  - Chaos tests: kill process during batch copy, verify resume without duplicates
  - Rollback tests: migration failure triggers rollback, source remains shadow-available
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/migration-slo-research.md
- [ ] Step 4.5: Validate phase changes
  - Run: npm exec --yes pnpm@11.4.0 -- build
  - Run: npm exec --yes pnpm@11.4.0 -- lint
  - Run: npm exec --yes pnpm@11.4.0 -- test

### Implementation Phase 5: Docs, Quality Gates, and Release

<!-- parallelizable: false -->

- [x] Step 5.1: Update README.md with profile-first onboarding
  - Add "Choose Your Profile" section with three command paths (memory, lite, enterprise)
  - Add profile matrix comparing features, setup friction, durability, scale
  - Move current Docker-first path under enterprise subsection
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
- [x] Step 5.2: Update docs/SETUP.md with profile-specific paths
  - Split setup flow by profile with explicit prerequisites per mode
  - Add profile-to-profile migration and promotion runbook
  - Add recovery procedures for each profile
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
- [x] Step 5.3: Update apps/mcp-server/README.md with MCP tool availability by profile
  - Document which tools are available in each profile and why
  - Document health and readiness semantics per profile
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
- [x] Step 5.4: Add profile matrix test suite and CI gates
  - Unit tests required across all profiles
  - Integration tests required across all profiles
  - Security tests required for profile-lite and enterprise
  - Migration tests required for profile-lite to enterprise
  - Docker E2E required for enterprise, optional for others
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
- [x] Step 5.5: Set release quality gates
  - SLO gates: startup latency targets per profile, migration downtime limits, data integrity verification
  - Test coverage gates: >= 85% new code coverage for profile/retrieval code paths
  - Reliability gates: zero unreconciled records after promotion, zero data loss tests pass
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md
  - Evidence: .copilot-tracking/research/subagents/2026-06-02/accessibility-scale-path-research.md, migration-slo-research.md
- [x] Step 5.6: Final validation and sign-off
  - Run full project validation: npm exec --yes pnpm@11.4.0 -- build, lint, typecheck, test
  - Run profile matrix smoke tests: boot each profile without external services, basic CRUD
  - Verify no breaking changes to enterprise profile (backward compatibility check)
  - Details: .copilot-tracking/details/2026-06-23/profile-ladder-details.md

## Planning Log

See `.copilot-tracking/plans/logs/2026-06-23/profile-ladder-log.md` for discrepancy tracking, implementation paths considered, and suggested follow-on work.

## Dependencies

- TypeScript 5.0+
- NestJS 10.0+
- Prisma 5.0+ (with optional SQLite adapter for profile-lite)
- Redis 6.0+ (optional for profile-memory and lite)
- Qdrant 1.0+ (optional for profile-memory and lite)
- pnpm 11.4.0+

## Success Criteria

- profile-memory starts with DEPLOYMENT_PROFILE=memory and no DATABASE_URL required — traces to: User requirement "no external services."
- profile-lite starts with DEPLOYMENT_PROFILE=lite and encrypted-at-rest storage by default — traces to: Security requirement and strict-by-default posture.
- profile-enterprise remains unchanged and backward-compatible — traces to: Team operational continuity requirement.
- Intelligent hybrid retrieval is available in profile-memory and profile-lite — traces to: "AGE OF THE IMPOSSIBLE" user requirement.
- Migration from profile-lite to profile-enterprise completes with zero data loss and <= 2 minutes P95 downtime — traces to: Migration SLO requirement.
- All profiles pass startup integration test with no external service dependencies — traces to: Quality gate requirement.
- Setup README command paths for each profile are copy-paste ready — traces to: Accessibility requirement.
