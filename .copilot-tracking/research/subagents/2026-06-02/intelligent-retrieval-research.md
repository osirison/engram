---
title: Intelligent Retrieval Research
description: Research note for keeping retrieval intelligent in pure in-memory and no-persistence profiles
author: GitHub Copilot
ms.date: 2026-06-02
ms.topic: reference
---

## Scope

This note answers whether retrieval can stay intelligent, fast, and efficient when the runtime uses pure in-memory storage and no persistence. The target profiles `profile-memory` and `profile-lite` are product targets, not existing repo concepts.

The focus is the current retrieval pipeline in memory services, vector store, embeddings, and MCP wiring, plus a migration path to a no-persistence-friendly design.

## Evidence

### Current production retrieval

- Exact match already exists in the service layer. `apps/mcp-server/src/memory/memory.service.ts:185-241` tries STM by ID first, then falls back to LTM by ID.
- STM exact retrieval is a Redis key lookup. `packages/memory-stm/src/memory-stm.service.ts:90-179` reads a single key and returns the parsed memory.
- LTM lexical retrieval is substring search, not semantic ranking. `packages/memory-ltm/src/memory-ltm.service.ts:254-384` uses Prisma `content.contains` for `list()` and `count()` filtering.
- Semantic retrieval exists only on the LTM path. `packages/memory-ltm/src/memory-ltm.service.ts:506-579` embeds the query, calls the vector store, then hydrates the ranked IDs from Postgres.
- The MCP surface exposes `list_memories`, `recall`, and the reindex tools. `apps/mcp-server/src/memory/memory.controller.ts:163-349` implements the handlers, and `apps/mcp-server/src/memory/memory.controller.ts:619-700` registers them as MCP tools.
- The app still wires persistence services globally. `apps/mcp-server/src/app.module.ts:5-31` imports `PrismaModule`, `RedisModule`, and `QdrantModule`.
- Env validation still requires persistence endpoints. `packages/config/src/env.schema.ts:10-12` requires `DATABASE_URL`, `REDIS_URL`, and `QDRANT_URL`.

### Graceful degradation already present

- Embedding generation already fails soft. `packages/embeddings/src/embeddings.service.ts:52-111` returns `null` when the cache, provider, or API call is unavailable.
- OpenAI embeddings disable themselves when the API key is missing. `packages/embeddings/src/providers/openai-embedding.provider.ts:11-19` sets the client to `null` and logs a warning.
- The disabled provider is a deliberate no-op. `packages/embeddings/src/providers/disabled-embedding.provider.ts:6-14` returns `null`.
- Semantic search already degrades to an empty result when the vector layer is absent. `packages/memory-ltm/src/memory-ltm.service.ts:601-610` returns `[]` if there is no vector store or no embeddings service.
- Reindex already degrades to a zero summary when there is no vector store. `packages/memory-ltm/src/memory-ltm.service.ts:599-603` returns an empty progress object.
- Qdrant and pgvector both provide scored vector search, but both are persistence-backed. `packages/vector-store/src/qdrant.vector-store.ts:44-106` and `packages/vector-store/src/pgvector.vector-store.ts:123-232` rely on external storage.

### Benchmark-only retrieval modes

- The evaluation harness already has keyword, embedding, and hybrid fusion retrievers. `packages/eval/src/retrievers/keyword-retriever.ts:20-78`, `packages/eval/src/retrievers/embedding-retriever.ts:64-101`, and `packages/eval/src/retrievers/fusion-retriever.ts:31-108` cover those modes.
- `packages/eval/src/run.ts:73-94` demonstrates the intended production shape of a hybrid stack using keyword retrieval, embeddings, and reciprocal-rank fusion.
- These retrievers are not wired into the production memory service yet.

## Current Retrieval Flow

| Mode               | Status  | Evidence                                                                                                                                                                         | What it means today                                                           |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Exact match        | Yes     | `apps/mcp-server/src/memory/memory.service.ts:185-241`, `packages/memory-stm/src/memory-stm.service.ts:90-179`                                                                   | Fast ID lookup in STM and LTM                                                 |
| Lexical            | Yes     | `packages/memory-ltm/src/memory-ltm.service.ts:254-384`, `apps/mcp-server/src/memory/memory.controller.ts:163-209`                                                               | Substring filtering on LTM content, not an inverted index                     |
| Semantic or vector | Yes     | `packages/memory-ltm/src/memory-ltm.service.ts:506-579`                                                                                                                          | Query embedding plus vector search and hydration                              |
| Hybrid             | Partial | `packages/eval/src/retrievers/fusion-retriever.ts:31-108`, `packages/eval/src/run.ts:73-94`                                                                                      | Exists in eval only, not in production memory retrieval                       |
| Ranking            | Yes     | `packages/memory-ltm/src/memory-ltm.service.ts:506-579`, `packages/vector-store/src/qdrant.vector-store.ts:90-106`, `packages/vector-store/src/pgvector.vector-store.ts:192-232` | Vector search returns scored hits and LTM preserves that order                |
| Reranking          | No      | No production implementation found                                                                                                                                               | No second-stage scorer or fusion layer in the memory service                  |
| Caching            | Partial | `packages/embeddings/src/embeddings.service.ts:52-111`                                                                                                                           | Query embeddings can be cached in Redis, but retrieval results are not cached |

## Alternatives

| Strategy                                                      | What it is                                                                                                                               | Strengths                                                                                     | Gaps                                                                                                                  | Fit for pure in-memory                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| A. Lexical + ephemeral in-memory index                        | Build a transient inverted index, token stats, and maybe phrase proximity scoring in process memory                                      | Very fast, simple, cheap, no external dependencies                                            | Weak semantic recall, brittle for paraphrases                                                                         | Good as a baseline, but not enough alone for "intelligent" retrieval |
| B. Semantic embeddings + ephemeral ANN or brute-force ranking | Store normalized vectors in process memory and score queries against them                                                                | Strong semantic recall, easy to keep deterministic, works with local embeddings               | Brute force can get expensive as corpus grows, ANN adds complexity, weak exact-term handling without lexical fallback | Good for small to medium corpora, but not enough alone for mass use  |
| C. Hybrid lexical + semantic with fallback heuristics         | Generate lexical candidates, score with embeddings when available, fuse the ranks, and fall back by query shape or provider availability | Best recall and robustness, graceful fallback, easiest path to accessible-by-default behavior | More moving parts than A or B                                                                                         | Best fit for the default profile and for no-persistence mode         |

## Recommendation

### Profile-memory

Use strategy C as the default. Keep a transient lexical index and a transient vector index in memory, then fuse the scores with a deterministic rank combiner such as reciprocal-rank fusion.

This preserves intelligence without persistence because the quality comes from the scoring pipeline, not from durable storage. The process memory holds the index, so queries stay fast and do not need Postgres, Redis, or Qdrant round trips.

Recommended behavior:

- Use lexical candidate generation first for exact terms, tags, identifiers, and short queries.
- Use local or cached embeddings for natural-language queries.
- Fuse lexical and semantic ranks, then apply stable tie-breaks such as recency and ID.
- Keep a lexical-only fallback when embeddings are unavailable or the query is too short to benefit from semantics.

### Profile-lite

Use the same hybrid kernel, but budget it more aggressively.

Recommended behavior:

- Keep lexical candidate generation always on.
- Run semantic scoring only on the top-N lexical candidates or when the query clearly looks semantic.
- Reduce vector dimensions or model cost if needed, but do not remove the fallback path.
- If a strict low-footprint mode is required, strategy A is the fallback, not the default.

If the profiles must differ materially, profile-memory should be full hybrid and profile-lite should be lexical-first hybrid with semantic rerank only on bounded candidate sets.

## Migration Path

1. Add a transient retrieval store for process memory. It should own `documentsById`, a lexical inverted index, and normalized vectors for semantic scoring.
2. Route create, update, delete, and promote events through that store so the index stays current without persistence.
3. Move `MemoryService.recall()` to a hybrid retrieval service that performs lexical scoring, semantic scoring, and fusion before returning ranked memories.
4. Keep `MemoryLtmService.semanticSearch()` as the persistent backend path, but make it an adapter behind the same retrieval contract.
5. Relax startup requirements for the no-persistence profile. `packages/config/src/env.schema.ts:10-12` and `apps/mcp-server/src/app.module.ts:5-31` currently hard-require persistence infrastructure.
6. Add tests for lexical candidate ranking, semantic fallback when the provider is missing, and hybrid tie-breaking with stable ordering.

## Implementation-Ready Plan

- Introduce a `RetrievalIndex` or `InMemoryVectorStore` abstraction in `packages/memory-ltm` or a new shared package.
- Reuse `packages/eval/src/retrievers/fusion-retriever.ts:31-108` as the first reference implementation for rank fusion.
- Default the no-persistence profile to `EMBEDDING_PROVIDER=local` when possible, and keep Redis optional because `packages/embeddings/src/embeddings.service.ts:52-111` already handles a missing cache.
- Keep the public MCP surface stable: `recall` should remain the semantic entry point, but its backend can switch from persistent vector search to the transient hybrid index.
- Add a small in-memory result cache only after the core hybrid pipeline is in place.

## Open Questions

- Should the no-persistence profile also drop Prisma and Redis from app startup, or only make retrieval independent of them?
- What corpus size should profile-lite support before it must promote from brute-force vector scoring to ANN?
- Do we want recency to influence ranking, or should relevance stay purely lexical plus semantic?
