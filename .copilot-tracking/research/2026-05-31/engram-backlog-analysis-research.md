<!-- markdownlint-disable-file -->

# ENGRAM Codebase + Backlog Analysis

Date: 2026-05-31
Repo: osirison/engram (branch: docs/simplify-onboarding-docs; default: main)

## Vision (user-stated)

ENGRAM is positioned as the next evolution of AI: the natural memory substrate that lets AI agents
store, recall, and compound intelligence over time. The backlog must deliver a _cognitive memory
layer for agents_, not a generic SaaS CRUD app.

## Implemented (verified in code)

- Monorepo: Turborepo, pnpm workspaces, Docker Compose, CI, pre-commit hooks.
- MCP server (NestJS): config (Zod), Pino logging, Terminus health checks (PG/Redis/Qdrant/embeddings).
- Prisma + Postgres. `Memory` model has `embedding Float[]` + `tags`, `metadata`, `type`, `expiresAt`.
- `@engram/memory-stm`: Redis STM incl. bulk ops (list/count/clear).
- `@engram/memory-ltm`: Postgres LTM; generates embeddings on create (via optional EmbeddingsService).
- `@engram/embeddings`: OpenAI provider + cache; embeddings written to Postgres `Float[]`.
- `@engram/vector-store`: Qdrant service with full vector ops (createCollection, upsert, search, delete).
- MCP tools: `ping` + memory CRUD tools registered (`registerAdditionalTools`).
- Integration tests for memory system.

## Critical Gap (the broken core)

**Semantic memory is NOT functional end-to-end.** Embeddings are generated and stored in Postgres
`Float[]`, but:

- Qdrant is wired ONLY to the health check. Memory create/update/delete never upsert vectors to Qdrant.
- There is NO semantic search path. LTM "search" is a Postgres `contains` substring filter.
- No MCP tool exposes vector/semantic recall.

So ENGRAM's defining capability — meaning-based recall for agents — does not exist yet despite the
embedding plumbing being half-built. This is the #1 thing to fix.

## Backlog Inventory

Open epics: #72 (Semantic Search), #9 (Auth/Multi-tenancy), #10 (Advanced/Reconciliation+Insights),
#11 (API & Dashboard/tRPC+UI), #12 (Production Readiness).

Open stories: #74-79 (search/cache/perf/hybrid/batch/docs under #72), #85-92 (UI: Tailwind, shadcn,
layout, NextAuth, tRPC, dashboards, navigator, detail view), #96 (lint hardening). Open PR #94 (e2e).

Closed/done: Foundation (#1-5), Core infra (#6, #16-25), Storage epic (#7, #56-71), embeddings (#73),
DI fix (#80), integration tests (#68). Closed dup epic #8 (re-created as open #72).

## Project-state problems to clean up

1. Stale milestone "Core" (#1): 0 open / 3 closed. Close it.
2. Label sprawl / duplicates: `docs` vs `type:docs` vs `documentation`; low-value bare labels
   (`epic:foundation`, `health-check`, `redis`, `linting`, `devex`) colored `#ededed`. Normalize.
3. Epics framed as generic "Phase 3/4/5/6 SaaS" rather than agent-memory-intelligence outcomes.
4. #72 child stories don't capture the actual broken integration (Qdrant unwired; embeddings stranded
   in Postgres). They jump to perf/cache before the basic vector path exists.

## Challenges / things that don't make sense (to raise with user)

- **Sequencing**: A large admin UI epic (#11, #85-92: NextAuth, shadcn, dashboards) is queued at high
  priority while the core semantic-recall engine is non-functional. Recommend deprioritizing the
  heavy admin UI until the memory-intelligence core works end-to-end.
- **Embeddings are stranded**: generating vectors into Postgres `Float[]` with no ANN search is wasted
  work; the vector lifecycle must run through Qdrant (or pgvector) with a real retrieval path.
- **No retrieval-quality evaluation**: epics claim ">95% relevance" and "sub-100ms p95" with no eval
  harness or benchmark. Need an eval/benchmark story before making accuracy/latency claims.
- **Missing agent-facing primitives** absent from backlog: high-level `remember`/`recall` MCP tools,
  relevance ranking (recency+importance+similarity), automatic STM→LTM consolidation/decay,
  dedup/contradiction detection, memory scoping/namespaces per agent/session/project.

## Proposed new epic structure (agent-memory-first)

1. **E1 Semantic Memory Engine (recall that works)** — wire Qdrant into memory lifecycle, vector
   upsert on write, `recall`/semantic-search MCP tool, hybrid (vector + metadata) search, ranking.
2. **E2 Memory Intelligence** — STM→LTM consolidation, importance/decay scoring, dedup + contradiction
   reconciliation, insight extraction. (absorbs #10)
3. **E3 Agent Ergonomics & SDK** — high-level MCP tools (`remember`/`recall`/`forget`), memory scoping
   /namespaces, client SDK, prompt-context assembly API.
4. **E4 Auth & Multi-tenancy** — keep #9 (OAuth, JWT, RLS isolation, API keys).
5. **E5 Retrieval Quality & Evaluation** — eval harness, relevance/latency benchmarks, regression gates.
6. **E6 Admin API & Dashboard** — keep #11 but reposition after the engine works; reuse #85-92.
7. **E7 Production Readiness** — keep #12 (security, rate limiting, deploy, observability).

## Decisions needed from user (product judgment)

1. Confirm priority: memory-intelligence core (E1/E2/E3) before heavy admin UI (E6).
2. Keep or close existing UI stories #85-92 (reassign under E6 vs rewrite).
3. Vector backend: keep Qdrant as the ANN store (recommended; already wired to health) vs migrate to
   pgvector to avoid dual stores.
4. Scope of label cleanup (safe rename/merge vs leave as-is to avoid breaking any automation).
