---
title: Accessibility-to-Scale Path Research
description: Product strategy research for ENGRAM setup profiles that minimize installation friction while preserving enterprise scale, reliability, and quality.
author: GitHub Copilot
ms.date: 2026-06-02
ms.topic: reference
keywords:
  - engram
  - setup profiles
  - enterprise scale
  - reliability
  - quality gates
estimated_reading_time: 16
---

## Research scope

This research answers the following goals for ENGRAM:

- Define install and setup UX profiles with explicit command paths
- Evaluate architecture and operations alternatives for easy setup plus enterprise scale
- Recommend a productized profile strategy with versioning and feature gating
- Specify concrete docs and config changes needed
- Set a quality bar with testing matrix, latency targets, and reliability targets

## Current pain points

1. Setup flow is still full-stack-first for all users.

- Current quick start requires Docker services, Prisma generation, and migrations before server run
- Evidence: README.md:23-35, docs/SETUP.md:22-30

2. Runtime dependency graph is eager and broad.

- App startup imports Prisma, Redis, Qdrant, Health, and Memory unconditionally
- Evidence: apps/mcp-server/src/app.module.ts:27-31

3. Environment validation blocks lightweight startup.

- DATABASE_URL, REDIS_URL, and QDRANT_URL are required regardless of active runtime profile
- Evidence: packages/config/src/env.schema.ts:10-12

4. DB startup currently fail-fast.

- Prisma service throws when DATABASE_URL missing and connects on module init
- Evidence: packages/database/src/prisma.service.ts:13-15, packages/database/src/prisma.service.ts:28-29

5. Health semantics require all backing services by default.

- Health indicator list always includes database, redis, and qdrant checks
- Evidence: apps/mcp-server/src/health/health.controller.ts:26-32, apps/mcp-server/src/health/health.controller.ts:44-54

6. Some graceful degradation exists, but too deep in service layer.

- LTM semantic search and reindex already degrade to empty or no-op when vector/embeddings missing
- Embeddings are optional and return null on provider/cache failures
- Evidence: packages/memory-ltm/src/memory-ltm.service.ts:513-519, packages/memory-ltm/src/memory-ltm.service.ts:600-603, packages/embeddings/src/embeddings.service.ts:31-33, packages/embeddings/src/embeddings.service.ts:97-105

7. STM is still Redis-coupled.

- STM service constructor requires RedisService, and core create path persists to Redis
- Evidence: packages/memory-stm/src/memory-stm.service.ts:27-29, packages/memory-stm/src/memory-stm.service.ts:77-82

8. Quality baseline exists but is only partially productized.

- Backend benchmark thresholds and trend regression checks already exist in scripts
- Evidence: package.json:17-20, scripts/bench-vector-backends.mjs:200-207, scripts/compare-benchmark-trend.mjs:51-56

## Install and setup UX profiles

### Profile 1: Zero-dependency quickstart

Intent:

- Fastest time-to-first-memory for local experimentation
- No Docker requirement
- Accepts no-durability tradeoff

Proposed runtime shape:

- In-process STM and LTM adapters
- Embeddings local or disabled
- Lexical-first retrieval with optional in-memory semantic rerank
- Health endpoint reflects process readiness, not unavailable external dependencies

Explicit command path (proposed productized path):

```bash
npm exec --yes pnpm@11.5.0 -- install
npm exec --yes pnpm@11.5.0 -- --filter mcp-server dev -- --profile zero
```

Equivalent short form after pnpm install:

```bash
pnpm install
pnpm --filter mcp-server dev -- --profile zero
```

### Profile 2: Durable local

Intent:

- Single-user or small-team local deployment with persistence
- Keep setup easy while preserving memory across restarts

Proposed runtime shape:

- SQLite-backed durable local memory store
- Optional local embeddings provider
- Profile-aware health checks
- Optional background maintenance features only when enabled

Explicit command path (proposed productized path):

```bash
npm exec --yes pnpm@11.5.0 -- install
test -f .env.localprofile || cp .env.example .env.localprofile
npm exec --yes pnpm@11.5.0 -- --filter mcp-server dev -- --profile durable-local
```

Equivalent short form:

```bash
pnpm install
pnpm --filter mcp-server dev -- --profile durable-local
```

### Profile 3: Enterprise

Intent:

- Full scale, multi-instance, and high reliability operations
- Existing architecture continuity with explicit profile contract

Current command path (already available):

```bash
npm exec --yes pnpm@11.5.0 -- install
test -f .env || cp .env.example .env
npm exec --yes pnpm@11.5.0 -- docker:up
npm exec --yes pnpm@11.5.0 -- db:generate
npm exec --yes pnpm@11.5.0 -- db:migrate
npm exec --yes pnpm@11.5.0 -- --filter mcp-server dev
```

Evidence:

- README.md:27-35
- docs/SETUP.md:22-30
- package.json:24-33

## Alternatives evaluated

### Alternative A: Keep current external-services-first default and add docs only

Pros:

- Minimal engineering risk
- No compatibility risk in short term

Cons:

- Does not solve setup friction for most users
- Does not provide true zero-dependency or durable-local path
- Keeps current env and startup blockers

Evidence baseline:

- apps/mcp-server/src/app.module.ts:27-31
- packages/config/src/env.schema.ts:10-12

### Alternative B: In-process memory-only plus enterprise profile

Pros:

- Lowest setup friction
- Fast startup and no infrastructure operations burden

Cons:

- No durability for users who need persistence
- Weak transition path for teams who start local but later scale

### Alternative C: Durable-local (SQLite) plus zero mode plus enterprise mode

Pros:

- Covers full onboarding funnel: quick experimentation, local persistence, enterprise scale
- Strong promotion path to enterprise
- Aligns with existing graceful-degradation patterns in embeddings and vector behavior

Cons:

- Highest implementation scope
- Requires careful profile-gated module wiring and test matrix expansion

## Selected approach

Select Alternative C: productized profile ladder.

Reasoning:

- Accessibility: zero mode removes Docker and service URL friction
- Retention: durable-local avoids data loss and supports practical adoption
- Scale: enterprise profile preserves current operational architecture and controls
- Reliability: profile contracts can make health and readiness semantics explicit per mode

Selected architecture principles:

1. Profile-driven module composition at startup

- Replace unconditional imports with profile-aware modules
- Current hard coupling evidence: apps/mcp-server/src/app.module.ts:27-31, apps/mcp-server/src/health/health.module.ts:22-26

2. Profile-aware env validation

- Make required envs conditional by active profile and backend
- Current hard requirements evidence: packages/config/src/env.schema.ts:10-12

3. Feature capability registry per profile

- Explicitly gate tools and maintenance commands by profile
- Existing MCP tool registration seam: apps/mcp-server/src/main.ts:41-42

4. Preserve enterprise defaults and safe migration paths

- Keep enterprise as compatibility baseline while introducing zero and durable-local as additive profiles

## Productized profile matrix

| Dimension          | Zero                                     | Durable local                | Enterprise                                         |
| ------------------ | ---------------------------------------- | ---------------------------- | -------------------------------------------------- |
| Primary user       | First-time evaluator                     | Local power user, small team | Production org                                     |
| Required services  | None                                     | None external by default     | Postgres + Redis + Qdrant or pgvector              |
| Data durability    | No                                       | Yes                          | Yes                                                |
| Horizontal scale   | Low                                      | Medium                       | High                                               |
| Setup complexity   | Lowest                                   | Low                          | Highest                                            |
| Default embedding  | local or disabled                        | local or openai              | openai or local                                    |
| Retrieval strategy | lexical plus optional in-memory semantic | lexical plus semantic local  | lexical plus semantic with external vector backend |
| Maintenance tools  | Limited                                  | Limited                      | Full                                               |
| Upgrade path       | zero to durable-local or enterprise      | durable-local to enterprise  | N/A                                                |

## Versioning and feature gating strategy

### Versioning model

- Use profile maturity flags over one major cycle:
  - v0.x: zero and durable-local as opt-in experimental profiles
  - v1.0: enterprise stable, durable-local stable, zero beta
  - v1.2+: zero stable after reliability and correctness gates pass

### Feature gating contract

Proposed env contract:

- DEPLOYMENT_PROFILE: zero | durable-local | enterprise
- ENABLE_STM: true | false
- ENABLE_LTM: true | false
- ENABLE_VECTOR_SEARCH: true | false
- ENABLE_REINDEX_TOOLS: true | false
- ENABLE_QUEUE_REINDEX: true | false

Precedence rules:

1. DEPLOYMENT_PROFILE sets defaults
2. Explicit ENABLE\_\* can only tighten profile, not widen unsafe capabilities
3. Startup logs the resolved profile and capability map

Safety rules:

- Enterprise profile enforces strict readiness and dependency checks
- Zero profile must hide unsupported tools rather than exposing guaranteed failures
- Durable-local profile can expose tools only if backing adapters are active

## Quality gates

### Testing matrix

Required matrix across profiles and vector backends:

| Area                         | Zero     | Durable local | Enterprise |
| ---------------------------- | -------- | ------------- | ---------- |
| Unit tests                   | Required | Required      | Required   |
| Contract tests for MCP tools | Required | Required      | Required   |
| Profile startup integration  | Required | Required      | Required   |
| Docker e2e                   | Optional | Optional      | Required   |
| Migration tests              | N/A      | Required      | Required   |
| Security/config linting      | Required | Required      | Required   |

Current quality baseline evidence:

- apps/mcp-server test scripts and docker e2e path: apps/mcp-server/package.json:19-24
- Coverage threshold baseline: apps/mcp-server/package.json:102-108

### Performance and latency targets

Baseline inherited from existing benchmark guardrails:

- Enterprise vector backend p95 retrieval target <= 120 ms
- Evidence: package.json:18, scripts/bench-vector-backends.mjs:200-207
- Enterprise benchmark trend regression budget <= 20 ms p95 delta
- Evidence: package.json:20, scripts/compare-benchmark-trend.mjs:51-56

Proposed additional profile targets:

- Zero profile:
  - cold startup to healthy <= 5 s on developer laptop
  - recall p95 <= 80 ms for 10k-memory corpus with local embeddings
- Durable-local profile:
  - cold startup to healthy <= 8 s
  - recall p95 <= 100 ms for 50k-memory corpus
- Enterprise profile:
  - maintain <= 120 ms p95 for baseline benchmark workloads
  - maintain <= 20 ms p95 regression budget release-over-release

### Reliability targets

Proposed reliability SLOs:

- Zero profile:
  - startup success >= 99% in CI smoke over 30-day window
- Durable-local profile:
  - no data loss across controlled restart tests
  - crash recovery restores last committed state in >= 99.9% of test runs
- Enterprise profile:
  - service availability target >= 99.9%
  - MTTR for dependency outage recovery <= 30 minutes
  - readiness semantics fail only on truly required dependencies per profile

## Concrete docs and config changes needed

### Docs

1. README.md

- Add profile-first quick start section with three command paths
- Move current Docker-first path under enterprise subsection
- Add capability matrix and profile selection guidance

2. docs/SETUP.md

- Split into setup by profile
- Add troubleshooting by profile
- Add migration guide from zero or durable-local to enterprise

3. apps/mcp-server/README.md

- Add profile flags, capability behavior, and health semantics by profile
- Document expected tool availability per profile

4. docs/roadmap.md

- Add profile rollout milestones and quality gates

### Config and runtime

1. packages/config/src/env.schema.ts

- Add DEPLOYMENT_PROFILE
- Make DATABASE_URL, REDIS_URL, QDRANT_URL conditional on profile/backend

2. apps/mcp-server/src/app.module.ts

- Refactor to profile-aware DynamicModule composition

3. apps/mcp-server/src/health/health.module.ts

- Make health dependencies conditional by profile

4. apps/mcp-server/src/health/health.controller.ts

- Build indicator list from capability map rather than unconditional dependency set

5. package.json and apps/mcp-server/package.json

- Add first-class scripts:
  - dev:profile:zero
  - dev:profile:durable-local
  - dev:profile:enterprise
  - test:matrix:profiles

6. .env.example

- Add profile section and per-profile defaults

7. docker-compose.yml

- Retain enterprise defaults
- Optional profile aliases for enterprise smoke path

## Implementation roadmap

### Phase 0: Contract and scaffolding (1 sprint)

- Add DEPLOYMENT_PROFILE and capability resolver
- Add profile-specific startup banner and configuration validation
- Add docs skeleton for profile setup

### Phase 1: Zero profile MVP (1 to 2 sprints)

- Add in-process adapters and profile-gated tool exposure
- Implement profile-aware health behavior
- Ship startup and basic CRUD tests for zero profile

### Phase 2: Durable-local MVP (2 to 3 sprints)

- Add durable local store adapters
- Add migration export path to enterprise ingest format
- Add profile matrix CI for zero, durable-local, enterprise

### Phase 3: Enterprise hardening and promotion tooling (1 to 2 sprints)

- Add robust promotion flow from durable-local to enterprise
- Add explicit reindex and backfill migration checks
- Lock quality gates as release blockers

### Phase 4: GA readiness (1 sprint)

- Reliability burn-in across profile matrix
- Complete docs and operator runbooks
- Promote profile maturity based on SLO and defect rate outcomes

## Evidence with file and line references

Setup and command paths:

- README.md:23-35
- README.md:58-77
- docs/SETUP.md:22-30
- docs/SETUP.md:54-66
- package.json:24-39

Current dependency coupling:

- apps/mcp-server/src/app.module.ts:27-31
- packages/config/src/env.schema.ts:10-12
- packages/database/src/prisma.service.ts:13-15
- packages/database/src/prisma.service.ts:28-29
- apps/mcp-server/src/health/health.module.ts:22-26
- apps/mcp-server/src/health/health.controller.ts:26-32

Current graceful degradation hooks:

- packages/embeddings/src/embeddings.service.ts:31-33
- packages/embeddings/src/embeddings.service.ts:97-105
- packages/memory-ltm/src/memory-ltm.service.ts:513-519
- packages/memory-ltm/src/memory-ltm.service.ts:600-603
- packages/memory-ltm/src/memory-ltm.service.ts:716-719

Current ops and quality hooks:

- apps/mcp-server/package.json:19-24
- apps/mcp-server/package.json:102-108
- package.json:17-20
- scripts/bench-vector-backends.mjs:200-207
- scripts/compare-benchmark-trend.mjs:51-56
- scripts/inspector-stack-up.mjs:37-40
- docker-compose.yml:83-89

## Clarifying questions

- Should durable-local require encrypted local persistence at launch, or can encryption be phase-2 with explicit warning labels?
- Should zero profile expose semantic recall by default using local embeddings, or start lexical-only and require an explicit flag for semantic mode?
- Do we want enterprise profile to remain default in v1.0, or should first-run UX default to durable-local for developer installs?
- What is the expected enterprise tenant scale target for GA, so performance and load-test envelopes can be pinned to real customer tiers?
