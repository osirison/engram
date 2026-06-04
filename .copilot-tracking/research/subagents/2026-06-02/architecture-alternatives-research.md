---
title: Architecture Alternatives Research
description: Evaluate ENGRAM architecture alternatives for lightweight mode now and enterprise scale later
author: GitHub Copilot
ms.date: 2026-06-02
ms.topic: reference
keywords:
  - engram
  - architecture
  - lightweight mode
  - sqlite
  - qdrant
  - pgvector
estimated_reading_time: 12
---

## Scope and Questions

Status: Complete
Date: 2026-06-02
Workspace: /home/qp/Cloud/Projects/engram
Output target: .copilot-tracking/research/subagents/2026-06-02/architecture-alternatives-research.md

Research questions:

1. How should ENGRAM support a lightweight mode now without blocking enterprise scale later?
2. What are the trade-offs among:
   1. In-process memory-only mode
   2. Single embedded DB mode (SQLite + optional in-process vector fallback)
   3. Current enterprise external services mode with feature flags
3. Which option should be selected, and what staged rollout minimizes risk?
4. Which existing repository files are likely impacted?
5. What verification and docs work is required?

## Baseline Architecture Evidence

Current architecture is external-service oriented with partial pluggability already in place.

Evidence from repository:

- apps/mcp-server/src/app.module.ts:5-31 imports PrismaModule, RedisModule, and QdrantModule unconditionally
- packages/config/src/env.schema.ts:10-12 currently requires DATABASE_URL, REDIS_URL, and QDRANT_URL
- packages/config/src/env.schema.ts:16-18 already supports EMBEDDING_PROVIDER and VECTOR_BACKEND flags
- packages/vector-store/src/vector-store.module.ts:11-14 supports runtime backend selection between qdrant and pgvector
- packages/vector-store/src/vector-store.module.ts:49 imports QdrantModule even when pgvector backend is selected
- packages/database/src/prisma.service.ts:14 and 28-29 hard-fails startup without DATABASE_URL and immediate DB connect
- packages/redis/src/redis.module.ts:11-13 and 18 creates Redis client with immediate connection (lazyConnect: false)
- packages/vector-store/src/qdrant.module.ts:10-12 always constructs Qdrant client URL, defaulting to localhost if unset
- apps/mcp-server/src/health/health.module.ts:25 and providers line 31 import/provide QdrantService directly
- apps/mcp-server/src/health/health.controller.ts:34-39 conditionally adds pgvector health check when VECTOR_BACKEND=pgvector, but qdrant health is still always included at lines 30-32
- packages/memory-ltm/src/memory-ltm.service.ts:46-53 has optional injections for STM, embeddings, and vector store
- packages/memory-ltm/src/memory-ltm.service.ts:513-520 returns empty semantic results if vector store or embeddings service is unavailable
- packages/memory-ltm/src/memory-ltm.service.ts:716-744 vector upsert/delete is best-effort and non-fatal
- packages/embeddings/src/embeddings.service.ts:36-40 and 97-105 returns null instead of throwing when embeddings are unavailable
- prisma/schema.prisma:38-41 includes pgvector-supporting embeddingVec column (Unsupported("vector(1536)"))
- README.md:9 and docs/SETUP.md:38 present Postgres + Redis + Qdrant as the standard setup

Implication: ENGRAM already has a resilient core (graceful degradation on missing embeddings/vector), but bootstrap and health wiring still assume full external services.

## Alternative A: In-Process Memory-Only Mode

Summary:

- Run without Postgres, Redis, or Qdrant
- Keep all data in process memory only
- Optional deterministic local embeddings only for session recall

Complexity:

- Medium for first delivery, high for production hardening
- Requires introducing in-memory implementations for STM and LTM contracts
- Requires conditional module wiring in app startup and health checks
- Requires new runtime mode config surface (for example STORAGE_MODE=memory)

Backward compatibility:

- API compatibility can be preserved if DTOs/tool contracts remain unchanged
- Behavioral differences are substantial: no durability, no cross-instance consistency
- Admin tools like reindex become no-op or partially disabled

Migration path:

- Easiest bootstrap path for demos and unit/integration tests
- Weak migration path for real users: no persistence to carry forward unless explicit export/import is built
- Requires data promotion pathway before switching to durable mode

Performance and security trade-offs:

- Performance: lowest latency, zero network hops, minimal startup overhead
- Scalability: poor, limited by single process memory and no horizontal state sharing
- Security: reduced network attack surface, but higher risk of accidental data loss and weak auditability
- Reliability: process restart wipes state unless snapshot feature is added

Best fit:

- Local quick-start, CI smoke, ephemeral agent sessions
- Not suitable as primary mode for user-retained memory

## Alternative B: Single Embedded DB Mode (SQLite + Optional In-Process Vector Fallback)

Summary:

- Durable local-first mode with SQLite as the only required data service
- Keep feature parity for CRUD/list
- Use one of:
  - SQLite FTS5 lexical search only
  - In-process vector index fallback (for semantic recall when OpenAI/local embeddings enabled)

Complexity:

- Medium-high implementation effort
- Requires a new storage adapter path since current Prisma model is PostgreSQL-focused
- Current schema uses Postgres-specific features, including vector column integration for pgvector (prisma/schema.prisma:38-41)
- Requires adapter abstraction or alternate repository implementation for SQLite mode

Backward compatibility:

- High API compatibility possible if service contracts remain stable
- Semantic recall quality may differ based on fallback implementation
- Existing enterprise deployments remain intact if mode is opt-in via feature flags

Migration path:

- Strong path for "lightweight now, enterprise later"
- Add export/import and dual-write migration tooling:
  - SQLite -> Postgres memory copy
  - Optional backfill to external vector store via existing reindex pathway (packages/memory-ltm/src/memory-ltm.service.ts:589-678)
- Supports progressive adoption without data reset

Performance and security trade-offs:

- Performance: very good for single-node workloads, lower operational overhead than external stack
- Scalability: limited write concurrency and horizontal scaling compared to managed Postgres/Redis/Qdrant
- Security: fewer moving parts and fewer network-exposed dependencies; requires at-rest encryption strategy for local DB files
- Reliability: significantly better than in-memory mode due to persistence and transactional semantics

Best fit:

- Default developer/local mode and small single-tenant deployments
- Transitional mode that can graduate to enterprise external services

## Alternative C: Current Enterprise External Services Mode with Feature Flags

Summary:

- Keep current architecture as default
- Introduce feature flags and optional wiring to selectively disable components
- Continue using Postgres + Redis + Qdrant (or pgvector) for full scale

Complexity:

- Low-medium incremental complexity
- Most components already exist and are production-oriented
- Main work is in startup/health/module conditionalization and clearer mode profiles

Backward compatibility:

- Highest compatibility and lowest regression risk
- Existing environments and operations remain stable
- No data migration required for current users

Migration path:

- Excellent for enterprise continuity
- Weak for true lightweight mode if all external services are still required
- Good as a control-plane pattern for multi-mode feature flags

Performance and security trade-offs:

- Performance: best for high scale and multi-instance workloads
- Security: mature network/service boundaries and operational controls, but larger attack surface and operational burden
- Cost/ops: highest total operational complexity for early-stage or local use

Best fit:

- Production multi-tenant and enterprise deployment footprints

## Comparative Assessment

| Criterion                   | A: In-memory only          | B: SQLite + fallback vector  | C: External services + flags |
| --------------------------- | -------------------------- | ---------------------------- | ---------------------------- |
| Time-to-first-lightweight   | Fast                       | Medium                       | Medium                       |
| Durability                  | None                       | Strong local durability      | Strong                       |
| Scale ceiling               | Low                        | Medium                       | High                         |
| Migration to enterprise     | Weak without export/import | Strong with staged migration | Already enterprise           |
| Ops complexity              | Very low                   | Low                          | High                         |
| Backward compatibility risk | Medium                     | Medium                       | Low                          |
| Security attack surface     | Smallest                   | Small                        | Largest                      |
| Long-term strategic fit     | Limited                    | Strong                       | Strong                       |

## Selected Recommendation

Select approach B as the primary lightweight strategy, implemented using approach C style feature flags and staged compatibility controls.

Why this is the best fit:

- It meets the "lightweight now" requirement with real persistence, unlike approach A
- It preserves a clean path to enterprise scale, unlike a pure in-memory design
- It leverages existing ENGRAM resilience patterns:
  - optional dependency usage in MemoryLtmService (packages/memory-ltm/src/memory-ltm.service.ts:46-53)
  - graceful no-vector behavior in semantic search and reindex (packages/memory-ltm/src/memory-ltm.service.ts:513-516, 600-603)
  - embedding non-fatal behavior (packages/embeddings/src/embeddings.service.ts:36-40, 97-105)
- It avoids forcing immediate high-ops footprint on local/small deployments

## Staged Rollout Plan

Stage 0: Flag and wiring hardening (short-term)

- Introduce explicit mode profile env vars (for example DEPLOYMENT_PROFILE=lightweight|enterprise)
- Make Qdrant and Redis truly optional in app and health modules for non-enterprise profiles
- Make Prisma and Redis startup initialization profile-aware to avoid eager connection failures in lightweight mode
- Keep existing enterprise profile as default for safety

Stage 1: Lightweight durable mode MVP

- Add SQLite-backed repository implementation for LTM/STM storage contracts
- Implement lexical search baseline (FTS5) and optional in-process vector index adapter
- Add import/export utilities for migration to Postgres

Stage 2: Enterprise promotion path

- Add migration command from SQLite to Postgres + chosen vector backend
- Reuse/extend reindex flow to populate external vector store after promotion
- Add observability counters for migration success, skip, and failure counts

Stage 3: Hardening and scale controls

- Add automated compatibility tests across profiles
- Add security hardening for local DB encryption/key management guidance
- Add deployment matrix docs and SLO guidance

## Concrete Repository Files Likely Impacted

Primary wiring and config:

- packages/config/src/env.schema.ts
- apps/mcp-server/src/app.module.ts
- apps/mcp-server/src/health/health.module.ts
- apps/mcp-server/src/health/health.controller.ts
- apps/mcp-server/src/health/qdrant.health.ts
- packages/vector-store/src/vector-store.module.ts
- packages/vector-store/src/qdrant.module.ts

Memory/domain services and adapters:

- packages/memory-ltm/src/memory-ltm.module.ts
- packages/memory-ltm/src/memory-ltm.service.ts
- packages/memory-stm/src/memory-stm.module.ts
- packages/memory-stm/src/memory-stm.service.ts
- packages/database/src/prisma.module.ts
- prisma/schema.prisma
- apps/mcp-server/src/reindex.cli.ts

Likely new files/modules:

- packages/memory-ltm/src/adapters/sqlite-memory-ltm.repository.ts
- packages/memory-stm/src/adapters/sqlite-memory-stm.repository.ts
- packages/vector-store/src/inmemory.vector-store.ts
- apps/mcp-server/src/config/deployment-profile.ts
- scripts/migrate-sqlite-to-postgres.mjs

Documentation likely impacted:

- README.md
- docs/SETUP.md
- apps/mcp-server/README.md
- packages/vector-store/README.md
- packages/database/USAGE.md

## Verification Strategy

Test strategy:

- Unit tests
  - Mode selection logic in config/env validation
  - Optional health indicator behavior by profile
  - SQLite adapter CRUD/list/search correctness
  - In-memory vector fallback scoring/filtering behavior
- Integration tests
  - Lightweight profile startup without Redis/Qdrant
  - Enterprise profile unchanged behavior
  - Migration command SQLite -> Postgres roundtrip
- Contract tests
  - Ensure API responses and DTO behavior remain stable across profiles
- Performance checks
  - Lightweight baseline p50/p95 CRUD and recall latency on representative local dataset
  - Enterprise regression guardrails compared to current baseline
- Security checks
  - Validate local DB file permissions and secret handling
  - Ensure tenant-scoped filtering remains enforced in recall paths

Commands/checks to run (repo standard):

- npm exec --yes pnpm@11.4.0 -- build
- npm exec --yes pnpm@11.4.0 -- lint
- npm exec --yes pnpm@11.4.0 -- typecheck
- npm exec --yes pnpm@11.4.0 -- test
- npm exec --yes pnpm@11.4.0 -- docs:check

## Documentation Update Plan

Required doc updates for rollout:

- Add a deployment profiles section in README.md
- Extend docs/SETUP.md with lightweight and enterprise setup paths
- Update apps/mcp-server/README.md env matrix and health semantics by profile
- Update packages/vector-store/README.md to document in-process fallback and migration guidance
- Add migration runbook from SQLite mode to enterprise mode

## Risks and Open Questions

Key risks:

- SQLite path may diverge from PostgreSQL semantics over time
- Vector recall parity may vary between fallback and enterprise backends
- Migration tooling quality is critical to trust and adoption

Clarifying questions requiring product/ops input:

1. Is lightweight mode expected for single-user local only, or small-team shared deployments too?
2. Must lightweight mode support full semantic recall parity, or is lexical-first acceptable initially?
3. Is local encryption at rest a strict requirement for lightweight mode v1?
4. What is the acceptable migration downtime budget when promoting from lightweight to enterprise?
