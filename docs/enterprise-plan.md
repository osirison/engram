---
title: Engram Enterprise Implementation Plan
description: Comprehensive gap analysis vs context-mem and parallel implementation streams for enterprise-grade agentic memory
---

## Overview

This plan closes the gap between Engram's current state and both context-mem's feature set and
enterprise-grade production requirements. It is structured into **10 independent parallel streams**
that teams can execute concurrently, each with its own scope, deliverables, and quality gates.

The dual goal: a **production-grade enterprise memory system** that can also run as a
**zero-dependency single-process lite mode** in under 5 seconds.

---

## Comparison: Engram vs context-mem

context-mem v4.0.0 "Cognition" — MIT, 45+ MCP tools, fully local SQLite.

| Dimension | Engram (current) | context-mem v4.0 |
|---|---|---|
| MCP tools | 13 | 45+ (6 deprecated) |
| Storage | Postgres + Redis + Qdrant/pgvector | SQLite (FTS5 + sqlite-vec) + markdown vault |
| Vector embeddings | 1536-dim OpenAI or pgvector HNSW | 768-dim nomic-embed-text-v1.5 (local) |
| Search | Vector similarity only | 8 parallel BM25 + vector + trigram + Levenshtein, RRF fused |
| BM25 strategies | None | AND, phrase, entity-focused, sanitized, relaxed-AND, OR+synonyms, keywords, synonym-tokens |
| LLM reranker | None | Optional Claude Haiku judge (R@5: 97.8% → 100%) |
| Ingest pipeline | Store → embed | 13-step pipeline (privacy, dedup, entity, topic, importance, summarize, write, log, graph, backlinks, embed, FTS, vault) |
| Token compression | None | 15 content-aware summarizers, 99.1% savings (365KB → 3.2KB) |
| Compression tiers | None | 4-tier age-based: verbatim (0-7d), light (7-30d), medium (30-90d), distilled (90+d) |
| Memory types | STM (Redis/TTL) + LTM (Postgres) | Observations, entities, knowledge entries, topics, sessions |
| Memory intelligence | None (roadmap #99) | Dreamer background agent (5 min cycle), auto-consolidation, auto-archive |
| Decay | None | Exponential (14-day half-life) + 30d stale mark + 90d auto-archive |
| Context window mgmt | None | `wake_up` token-budgeted briefing (profile 15%, knowledge 40%, decisions 30%, entities 15%) |
| Temporal tools | None | `temporal_query`, `time_travel`, `explain_decision`, `predict_loss` |
| Session tools | None | `wake_up`, `restore_session`, `handoff_session` |
| Multi-agent | None | `agent_register`, `agent_status`, `claim_files`, `agent_broadcast` |
| Cross-project | None | `promote_knowledge`, `global_search`, `find_tunnels` |
| Knowledge graph | None | 9 graph tools, entity-relationship graph, graph_query, graph_neighbors |
| Answer-as-page | None | `ask` answers persisted as knowledge pages (self-improving cache) |
| Dashboard | None | Web UI at localhost:3141 (6 pages: Intelligence, Graph, Topics, Timeline, Entities, Diagnostics) |
| Code execution | None | `execute` (JS, TS, Python, Shell, Ruby, Go, Rust, PHP, Perl, R, Elixir) |
| Vault/human-readable | None | Markdown vault, Obsidian-compatible, Context Protocol RFC v1 |
| Multi-tenancy | userId scoping, per-user quota | None (single-user, filesystem-scoped) |
| Auth | adminToken (reindex only) | None |
| Horizontal scale | Yes (stateless NestJS + Postgres + Redis) | No |
| Async jobs | BullMQ with cursor resumption | None (synchronous except embedding) |
| Evaluation harness | Full (precision/recall/MRR/nDCG, latency p50/p95/p99) | Claims LongMemEval R@5 100% (session-retrieval recall, not end-to-end QA) |
| Observability | Basic logs | Diagnostics tool, dashboard stats |
| SDK | None | None |
| Privacy | None | 9-detector privacy engine, `<private>` tag stripping |

### Engram's Durable Advantages (never-match by context-mem)
- Enterprise Postgres/Redis/Qdrant → scales to millions of memories, horizontal reads
- Dual vector backends with tunable HNSW parameters
- Async reindex with BullMQ, cursor resumption, per-item skip-without-corrupt
- Strict multi-tenant isolation with userId scoping in every query
- Full offline evaluation harness (precision/recall/MRR/nDCG, latency benchmarks)
- NestJS DI makes every feature independently testable and injectable

### context-mem's Durable Advantages (gaps Engram must close)
- 15-summarizer adaptive compression system (the 99% token savings feature)
- 8 parallel BM25 strategies with intent-adaptive fusion weights
- 13-step typed ingest pipeline (privacy filter, entity extraction, importance scoring baked in)
- Dreamer background agent (autonomous consolidation, verification, archival)
- 4-tier age-based compression with priority cascade (pinned/DECISION entries never compress)
- Temporal tools: time-travel debugging, decision trail reconstruction
- Token-budgeted `wake_up` session primer (most important feature for agent UX)
- Multi-agent coordination tools (claim_files, agent_broadcast)
- Markdown vault with Obsidian compatibility and Context Protocol RFC

---

## Gap Analysis — Tools Missing in Engram

context-mem ships 45 tools (13 Engram have vs 45 context-mem = 32+ missing). Full mapping:

| Category | Missing in Engram | context-mem equivalent |
|---|---|---|
| Ingest | `observe` (typed ingest with 13-step pipeline) | `observe` |
| High-level UX | `remember`, `forget`, `reflect` | no direct equiv — `observe` covers ingest |
| Search | `search_memories` (BM25/FTS), `ask` (NL Q&A synthesized over all memories) | `search`, `ask` |
| Similarity | `find_similar` | `search` with vector-only mode |
| Session | `wake_up` (token-budgeted primer), `restore_session`, `handoff_session` | `wake_up`, `restore_session`, `handoff_session` |
| Multi-agent | `agent_register`, `agent_status`, `claim_files`, `agent_broadcast` | same |
| Organization | `add_tags`, `remove_tags`, `list_tags`, `archive_memory`, `unarchive_memory`, `pin_memory`, `bulk_tag` | partial via flags |
| Relationships | `link_memories`, `unlink_memories`, `get_linked_memories`, `find_related` | `add_relationship`, `graph_query`, `graph_neighbors` |
| Bulk | `bulk_create`, `bulk_delete`, `export_memories`, `import_memories`, `import_conversations` | `import_conversations` |
| Temporal | `temporal_query`, `time_travel`, `explain_decision`, `predict_loss` | same |
| Intelligence | `generate_story`, `find_tunnels` | same |
| Analytics | `get_memory_stats`, `get_user_stats`, `get_recall_stats`, `diagnostics`, `stats` | `stats`, `diagnostics` |
| Token budget | `budget_status`, `budget_configure` | same |
| Context | `compress_context`, `load_context`, `summarize` | implicit in `wake_up` |
| Code runner | `execute` (polyglot: JS/TS/Python/Shell/Ruby/Go/Rust/PHP/Perl/R/Elixir) | `execute` |
| Content index | `index_content`, `search_content` | same |
| Snapshots | `create_snapshot`, `restore_snapshot`, `list_snapshots` | `restore_session` (partial) |
| Agent | `create_agent_profile`, `get_agent_profile`, `update_agent_profile` | none |
| Cross-project | `promote_to_global`, `global_search`, `find_tunnels` | same |

---

## Stream Map

```
Stream A ─── Search & Retrieval Intelligence     (no deps)
Stream B ─── Memory Intelligence + Dreamer       (no deps)
Stream C ─── MCP Tool Expansion     ────────────►(depends on A + B for some tools)
Stream D ─── Lite / Embedded Mode               (no deps)
Stream E ─── Multi-tenancy & Auth               (no deps)
Stream F ─── Knowledge Graph                    (no deps)
Stream G ─── Agent-native Patterns  ────────────►(light dep on E for scoping)
Stream H ─── Observability & SDK    ────────────►(benefits from A–G completion)
Stream I ─── Temporal & Decision Trail          (no deps)
Stream J ─── Token Budget & Compression         (soft dep on A for compression)
```

All streams are independently startable. Streams C, G, H have soft dependencies but can
begin with the non-dependent tasks first. Streams I and J are new streams surfaced from
the detailed context-mem feature inventory.

---

## Stream A — Search & Retrieval Intelligence

**Goal**: Close the BM25 + hybrid search gap vs context-mem; achieve top-tier retrieval quality.
context-mem runs 8 parallel BM25 strategies simultaneously with RRF fusion and intent-adaptive weights.
Engram must match or exceed this with Postgres FTS5-equivalent (`tsvector`) as foundation.

### A1 — Postgres Full-Text Search (BM25 foundation)

**Package**: `packages/memory-ltm`  
**Prisma migration**:
```sql
ALTER TABLE memories ADD COLUMN content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX memories_content_tsv_gin ON memories USING GIN(content_tsv);
```

**New method** in `MemoryLtmService`:
```typescript
async fullTextSearch(userId: string, query: string, limit: number): Promise<ScoredMemory[]>
// $queryRaw with ts_rank_cd(content_tsv, plainto_tsquery($query)) with userId filter
```

### A2 — 8 Parallel BM25 Search Strategies

**Package**: `packages/search` (new)

Mirror context-mem's architecture: 8 strategies run concurrently via `Promise.all`, results
merged by `RrfFusion` with per-strategy weights.

| Strategy | Postgres implementation | Fusion weight |
|---|---|---|
| AND-mode | `phraseto_tsquery` — all terms required | 2.0 |
| Phrase matching | Adjacent term pairs via `to_tsquery` with `<->` | 1.9 |
| Entity-focused | Boost matches in `tags[]` column additionally | 1.8 |
| Sanitized FTS | `plainto_tsquery` (standard) | 1.5 |
| Relaxed AND | `plainto_tsquery` with lower rank threshold | 1.2 |
| OR + synonyms | `to_tsquery` with `|` operators, synonym expansion | 1.0 |
| Individual keywords | One query per token, union | 0.5 |
| Individual synonyms | Synonym tokens individually | 0.2 |

**Intent-adaptive fusion**: detect query intent (causal, temporal, lookup, general) and
adjust BM25:vector weight ratio dynamically (e.g., temporal queries boost recency-score).

### A3 — Hybrid Search with RRF Fusion

**Package**: `packages/search`

`HybridSearchService`:
- Runs A2 (8 BM25 strategies) + vector search + trigram search in parallel
- Fusion weights: BM25=0.45, vector=0.35, trigram=0.15, Levenshtein=0.05
- `RrfFusion` extracted from `@engram/eval`'s `FusionRetriever` into `@engram/search`
- `SearchResult<T>` typed with `score`, `source: 'bm25'|'vector'|'trigram'|'fused'`, `rank`, `strategy`

Config:
```
HYBRID_SEARCH_ENABLED=true
HYBRID_RRF_K=60
INTENT_ADAPTIVE_WEIGHTS=true
```

Update `recall` tool to use hybrid pipeline. Add `search_memories` tool (keyword-primary).

### A4 — Re-ranking Layer

**Package**: `packages/search`

`RerankerService` (`RERANKER_STRATEGY` env):
- `haiku` (default when key available) — Claude Haiku cross-encoder, blends 50/50 with retrieval score; ~100ms, ~$0.002/query. Matches context-mem's LongMemEval 97.8→100% improvement.
- `cohere` — Cohere Rerank API
- `heuristic` — recency (70%) + 7-day recency (20%) + access count (10%) + importance score

### A5 — Query Expansion

**Package**: `packages/search`

`QueryExpander` (`QUERY_EXPANSION=hyde|synonyms|disabled`):
- HyDE: generate a hypothetical ideal memory and embed that instead of the raw query
- Synonym expansion via lightweight English synonym list

### A6 — Trigram Search (fuzzy match)

**Package**: `packages/search`  
**Postgres extension**: `pg_trgm`

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX memories_content_trgm ON memories USING GIN(content gin_trgm_ops);
```

`TrigramSearchService`:
- `similarity(content, $query)` scored search
- Fusion weight: 0.15 (handles typos, partial matches, code identifiers)

**Quality gate**: Hybrid precision@5 ≥ 0.40 (vs current 0.267 vector-only). Add to CI gate in `@engram/eval`.

---

## Stream B — Memory Intelligence + Dreamer

**Goal**: Memories that think. Matches context-mem's 13-step ingest pipeline, Dreamer background
agent, 4-tier compression, and decay system — then surpasses with enterprise-grade Postgres backing.

### B0 — Typed Ingest Pipeline (13 steps)

**Package**: `packages/memory-ltm`  
**New service**: `IngestPipeline`

Replace the current single-step `create()` with a typed 13-step pipeline. Each step is a
`PipelineStep<T>` (composable, independently testable):

```
1. PrivacyFilter       — strip <private> tags, redact 9 pattern types (API keys, tokens, passwords, PII)
2. ContentHashDedup    — SHA-256 of normalized content; reject exact duplicates
3. EntityExtractor     — extract PERSON/PLACE/ORG/DATE/CONCEPT/TECHNOLOGY entities (async, non-blocking)
4. TopicDetector       — cluster detection; assign to existing topic or create new
5. ImportanceScorer    — score 0.0–1.0 with 6 flags: DECISION, ORIGIN, PIVOT, CORE, MILESTONE, PROBLEM
6. ContentSummarizer   — content-aware compression (15 summarizer types, see B3)
7. PostgresWrite       — upsert to memories table via Prisma
8. EventLogAppend      — append to audit event log (immutable)
9. EntityGraphUpdate   — upsert entity nodes, compute backlinks
10. BacklinkCompute    — update reverse-reference index
11. EmbeddingGenerate  — async, non-blocking (already exists in EmbeddingsService)
12. SearchIndexUpdate  — upsert to vector store + trigger FTS tsvector update
13. VaultSync          — sync to markdown vault if VAULT_ENABLED=true (async)
```

Steps 3, 11, 13 are non-blocking (fire-and-forget). Steps 1-7 are synchronous in the tool response path.

### B1 — Importance Scoring with 6 Flags

**Schema**: add to Memory model:
```
importanceScore  Float   @default(0.5)
importanceFlags  String[] // ['DECISION','MILESTONE','PROBLEM','ORIGIN','PIVOT','CORE']
accessCount      Int      @default(0)
lastAccessedAt   DateTime?
pinned           Boolean  @default(false)
status           String   @default("active") // 'active'|'archived'|'pinned'|'stale'
```

`ImportanceScoringService`:
- Base: 0.5
- Flag boost: DECISION+0.3, MILESTONE+0.2, PROBLEM+0.2, ORIGIN+0.15, PIVOT+0.15, CORE+0.1
- Access boost: `score += 0.01 * log(accessCount + 1)` (diminishing returns)
- Decay: `score *= e^(-ln(2) * daysSinceAccess / HALF_LIFE_DAYS)` (default 14-day half-life)
- Pinned entries: importance floor = 0.9, exempt from decay
- Updated on each recall hit asynchronously (no latency impact)

### B2 — 4-Tier Age-Based Compression

**Package**: `packages/memory-ltm`  
**Schema**: add `compressionTier Int @default(0)` (0=verbatim, 1=light, 2=medium, 3=distilled)

`CompressionTierService` (scheduled cron, daily):
- Tier 0 (0-7 days): stored verbatim
- Tier 1 (7-30 days): light compression applied
- Tier 2 (30-90 days): medium compression
- Tier 3 (90+ days): maximum distillation

Priority cascade (immune to compression regardless of age):
- `pinned=true` → always verbatim
- `importanceFlags` contains DECISION/MILESTONE/PROBLEM → always verbatim
- `importanceScore >= 0.8` → always verbatim

Config:
```
COMPRESSION_ENABLED=true
COMPRESSION_TIER1_DAYS=7
COMPRESSION_TIER2_DAYS=30
COMPRESSION_TIER3_DAYS=90
```

### B3 — 15 Content-Aware Summarizers

**Package**: `packages/memory-ltm`  
**New service**: `ContentSummarizer`

Context-mem achieves 99.1% token savings (365KB → 3.2KB) via content-type detection and
appropriate compression strategy. Engram must implement equivalent:

| Summarizer | Detection heuristic | Target compression |
|---|---|---|
| Binary/hex | `/^[0-9a-fA-F\s]+$/` or buffer-like | 98% |
| Log output | Lines with timestamps, log levels | 97% |
| Errors | Stack traces, error: prefixes | 95% |
| Shell/CLI | `$` prompts, command outputs | 95% |
| Build output | webpack/tsc/jest output patterns | 94% |
| Code | Fenced ``` blocks, indentation | 92% |
| HTML | `<[^>]+>` density | 92% |
| JSON | Valid JSON objects/arrays | 89% |
| Network responses | HTTP headers, REST payloads | 88% |
| TypeScript errors | `TS[0-9]+:` error codes | 88% |
| Tests | Test runner output, pass/fail lines | 85% |
| CSV | Comma-separated tabular data | 80% |
| Markdown | Headers, bullets, links | 75% |
| Git logs | `commit [sha]` lines | 90% |
| Python tracebacks | `Traceback (most recent call last)` | 95% |

Each summarizer: extract the key fact (error message, command name, function signature,
decision) and discard boilerplate. LLM used only when rule-based extraction is insufficient.

### B4 — Decay & Archiving

`DecayService` (`@nestjs/schedule` cron, daily):
- 30 days without access → mark `status='stale'`
- 90 days without access AND `importanceScore < 0.1` → `status='archived'`
- 365 days + archived → hard delete (configurable)
- Emits `memory.archived` / `memory.stale` events

Config:
```
DECAY_ENABLED=true
DECAY_STALE_AFTER_DAYS=30
DECAY_ARCHIVE_AFTER_DAYS=90
DECAY_DELETE_AFTER_DAYS=365
```

### B5 — Dreamer Background Agent

**Package**: `packages/memory-ltm`  
**New service**: `DreamerService` (scheduled via `@nestjs/schedule`)

Runs on configurable cycle (`DREAMER_INTERVAL_MS`, default 300000 = 5 minutes):

```
DreamerCycle:
  1. MergePass    — find pairs with cosine similarity > 0.92; merge (union tags, max score, sum accessCount)
  2. VerifyPass   — detect contradictions in recently added memories; flag in metadata
  3. ArchivePass  — apply decay rules (B4); archive stale entries
  4. PromotePass  — identify high-importance STM memories not yet promoted; auto-promote
  5. CompressPass — apply B2 tier compression to memories crossing age thresholds
  6. RewritePass  — shorten verbose memories (>2000 chars) via LLM compression
  7. SynthesisPass— update topic/entity synthesis pages in vault
```

Each pass runs independently and fails gracefully (exception in one pass doesn't stop others).
Progress tracked in `DreamerRun { id, startedAt, completedAt, passStats }` Prisma table.
Admin MCP tool: `get_dreamer_status`, `trigger_dreamer_cycle` (adminToken required).

### B6 — Contradiction Detection

`ContradictionDetector` (runs in Dreamer VerifyPass + on promote):
- Retrieves top-3 similar memories
- LLM prompt: classify pair as AGREE / CONTRADICT / UNRELATED
- On CONTRADICT: adds `{ contradiction: true, contradicts: [id], contradictionType: 'factual|temporal|preference' }` to metadata
- Does NOT auto-resolve — surfaces via `reflect` tool and `get_memory` response

### B7 — Auto-Summarization / Reflection

`SummarizationService` (triggered by Dreamer SynthesisPass or `reflect` tool):
- Group memories by tag cluster or time window
- LLM-synthesize group into `type='insight'` memory with `importanceScore=0.8`
- Archive individual source memories
- Answer-as-page: `ask` tool responses stored as insight memories (self-improving cache)

---

## Stream C — MCP Tool Expansion

**Goal**: Expand from 13 to 40+ tools, close the ergonomic gap with context-mem.

All new tools follow the existing pattern: Zod `.strict()` schema + typed handler + definition
registered in `packages/core/src/mcp/tools/index.ts`.

### C1 — High-Level Agent UX Tools

| Tool | Description |
|---|---|
| `remember` | Smart create: auto-detects STM vs LTM, extracts tags, deduplicates |
| `forget` | Smart delete: semantic search + confirmation, can forget by concept not just ID |
| `reflect` | Synthesize insights across memories matching a query; returns summary + source IDs |
| `compress_context` | Retrieve + contextually compress memories for context window injection |
| `load_context` | Load the most relevant memories for a session opening; returns formatted context block |

### C2 — Search Tools

| Tool | Description |
|---|---|
| `search_memories` | Full-text / BM25 keyword search (distinct from semantic `recall`) |
| `find_similar` | Given a memory ID, find semantically similar memories |
| `filter_memories` | List with rich filters: date ranges, importance thresholds, status, type |

### C3 — Organization Tools

| Tool | Description |
|---|---|
| `add_tags` | Add tags to an existing memory |
| `remove_tags` | Remove specific tags |
| `list_tags` | List all unique tags for a user with counts |
| `archive_memory` | Manually archive (soft-hide) a memory |
| `unarchive_memory` | Restore archived memory |
| `pin_memory` | Pin (protect from decay) |
| `bulk_tag` | Apply tags to all memories matching a filter |

### C4 — Relationship Tools

| Tool | Description |
|---|---|
| `link_memories` | Create a typed directional link between two memories |
| `unlink_memories` | Remove a link |
| `get_linked_memories` | Traverse links (depth 1 or 2) from a memory |
| `find_related` | Find memories related by entity overlap or semantic proximity |

### C5 — Bulk & Import/Export Tools

| Tool | Description |
|---|---|
| `bulk_create` | Create up to 100 memories in a single call |
| `bulk_delete` | Delete by filter (tag, date range, status) |
| `export_memories` | Export all memories as JSON or markdown vault format |
| `import_memories` | Import from JSON or markdown vault |

### C6 — Analytics Tools

| Tool | Description |
|---|---|
| `get_memory_stats` | Count by type, status, tag distribution, storage size |
| `get_recall_stats` | Top recalled memories, recall frequency, last 7/30 day activity |
| `get_user_stats` | Quota usage, memory age distribution, importance histogram |

### C7 — Session Tools

| Tool | Description |
|---|---|
| `start_session` | Create a working-memory session (returns sessionId, loads agent profile context) |
| `end_session` | Close session: promote important working memories to LTM |
| `get_session_context` | Return the current session's working memory formatted for injection |
| `clear_working_memory` | Wipe session working memory without promoting |

### C8 — Snapshot Tools

| Tool | Description |
|---|---|
| `create_snapshot` | Create a point-in-time snapshot of all memories (stored in Postgres) |
| `restore_snapshot` | Restore from snapshot (creates copies, does not overwrite) |
| `list_snapshots` | List available snapshots |

---

## Stream D — Lite / Embedded Mode

**Goal**: Zero-dependency single-process deployment that starts in <5 seconds.

**Entry point**: `ENGRAM_MODE=lite` (or `ENGRAM_MODE=enterprise` for current full mode)

### D1 — SQLite Backend

**New package**: `packages/database-lite`

- SQLite via `better-sqlite3` with Prisma SQLite adapter
- Same Prisma schema with SQLite-compatible types (no `vector(1536)`, no `tsvector`)
- Migrations: separate `prisma/schema.lite.prisma` and `prisma/migrations-lite/`
- Env: `DATABASE_URL=file:./engram.db`

### D2 — In-Memory Vector Store

**New implementation**: `packages/vector-store/src/backends/in-memory.ts`

- `InMemoryVectorStore` implementing existing `VectorStore` interface
- Flat cosine similarity scan (good up to ~50k vectors)
- Optional HNSW via `hnswlib-node` (install only in lite mode)
- Zero external service dependency
- Selected via `VECTOR_BACKEND=memory`

### D3 — In-Process Cache (Redis replacement)

**New package**: `packages/cache`

- `CacheService` interface: `get(key)`, `set(key, value, ttlMs)`, `del(key)`, `keys(pattern)`
- Two implementations:
  - `RedisCacheService` — wraps existing RedisService (enterprise mode)
  - `MemoryCacheService` — Node.js `Map` with TTL (lite mode), backed by `node-cache`
- Auto-selected based on `ENGRAM_MODE`
- Replaces `RedisService` injection in STM and embeddings cache

### D4 — In-Process Job Queue (BullMQ replacement)

**New abstraction**: `packages/queue`

- `QueueService` interface: `add(job)`, `process(handler)`, `getJob(id)`
- Two implementations:
  - `BullMqQueueService` — wraps existing BullMQ (enterprise)
  - `InProcessQueueService` — `p-queue` with concurrency=1, persists state in SQLite
- Reindex jobs work identically in both modes

### D5 — Lite NestJS Bootstrap

**New app**: `apps/mcp-server/src/bootstrap.lite.ts`

- Skips `QdrantModule`, `RedisModule` (replaced by `CacheModule`)
- Uses `DatabaseLiteModule`, `InMemoryVectorStoreModule`, `InProcessQueueModule`
- No `docker:up` required
- Single `pnpm start:lite` command
- Docker image: `engram-lite` — ~150MB vs ~400MB full

**CLI**:
```bash
ENGRAM_MODE=lite pnpm --filter mcp-server start
# or
npx engram-lite   # zero-install via npx
```

### D6 — Markdown Vault Export (context-mem compatibility)

`MarkdownVaultService`:
- On each LTM memory create/update/delete, optionally writes to `VAULT_PATH` directory
- One `.md` file per memory: frontmatter (id, tags, importance, createdAt) + content body
- BM25 search over vault via `minisearch` (used in lite mode instead of Postgres FTS)
- `VAULT_ENABLED=true`, `VAULT_PATH=./memories`

---

## Stream E — Multi-tenancy & Auth

**Goal**: Full enterprise multi-tenancy with organizations, API keys, RBAC, and quota management.

### E1 — Data Model

**New Prisma models**:

```prisma
model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  members   OrganizationMember[]
  apiKeys   ApiKey[]
  quotas    OrgQuota?
}

model OrganizationMember {
  id     String @id @default(cuid())
  orgId  String
  userId String
  role   OrgRole  // OWNER | ADMIN | MEMBER | VIEWER
  org    Organization @relation(fields: [orgId], references: [id])
  user   User         @relation(fields: [userId], references: [id])
  @@unique([orgId, userId])
}

model ApiKey {
  id          String    @id @default(cuid())
  hash        String    @unique  // bcrypt hash of key
  prefix      String    // first 8 chars for identification
  orgId       String?
  userId      String
  scopes      String[]  // ['memory:read', 'memory:write', 'admin']
  expiresAt   DateTime?
  lastUsedAt  DateTime?
  createdAt   DateTime  @default(now())
}

model OrgQuota {
  orgId              String @id
  maxMemoriesPerUser Int    @default(10000)
  maxUsersInOrg      Int    @default(100)
  maxApiKeys         Int    @default(50)
  org                Organization @relation(fields: [orgId], references: [id])
}
```

### E2 — JWT Authentication Middleware

**New NestJS module**: `AuthModule`

- `JwtStrategy` using `@nestjs/passport` + `passport-jwt`
- `ApiKeyGuard` — extracts `Authorization: Bearer engram_...` or `X-API-Key` header, validates hash
- `AuthGuard` — applies to all routes except `/health` and `ping` tool
- `CurrentUser` decorator for controller injection

### E3 — API Key Management

**New MCP tools** (admin-scoped):
- `create_api_key` — generate key, return once (only hash stored)
- `list_api_keys` — list by prefix + metadata (never full key)
- `revoke_api_key` — delete by prefix or id

### E4 — Rate Limiting & Quotas

**New middleware**: `RateLimitMiddleware` backed by Redis (enterprise) or in-memory (lite)

- Per-user: `RATE_LIMIT_USER_RPM=60` (requests per minute)
- Per-org: `RATE_LIMIT_ORG_RPM=1000`
- Per-tool: configurable overrides (e.g., `reindex_memories` rate limited separately)
- Quota enforcement: `maxMemoriesPerUser` checked on `create_memory` / `remember`

### E5 — Tenant Isolation Audit

- All existing LTM + STM operations already scope by `userId` — audit and add integration tests
- Add `orgId` foreign key to `Memory` for org-level queries
- Admin dashboard queries always include `orgId` filter

---

## Stream F — Knowledge Graph

**Goal**: Extract relationships between memories; enable graph-based retrieval.

### F1 — Memory Links

**New Prisma model**:

```prisma
model MemoryLink {
  id         String   @id @default(cuid())
  sourceId   String
  targetId   String
  linkType   String   // 'related' | 'contradicts' | 'supports' | 'precedes' | 'caused_by'
  weight     Float    @default(1.0)
  createdAt  DateTime @default(now())
  source     Memory   @relation("SourceLinks", fields: [sourceId], references: [id])
  target     Memory   @relation("TargetLinks", fields: [targetId], references: [id])
  @@unique([sourceId, targetId, linkType])
  @@index([sourceId])
  @@index([targetId])
}
```

**New service**: `MemoryGraphService`
- `link(sourceId, targetId, linkType, weight?)` 
- `unlink(sourceId, targetId)`
- `getNeighbors(memoryId, depth: 1|2, types?: string[])` — BFS/DFS traversal
- `getSubgraph(memoryIds[])` — return all links within a set

### F2 — Entity Extraction

**New service**: `EntityExtractor` in `packages/memory-ltm`

- Extracts named entities from memory content on create/update (async, non-blocking)
- Entity types: PERSON, PLACE, ORGANIZATION, DATE, CONCEPT, TECHNOLOGY
- Storage: JSON in `Memory.metadata.entities`
- Uses OpenAI function calling; falls back to regex patterns when provider unavailable
- Auto-creates links between memories sharing entities: `link_type='related'`, weight based on entity overlap

### F3 — Graph-Aware Recall

**Enhancement to `HybridSearchService`**:

After initial retrieval, expand results by traversing `MemoryLink` graph:
- Fetch direct neighbors (depth 1) of top-k results
- Score neighbor expansion: `neighbor_score = parent_score * link_weight * 0.5`
- Merge into ranked list, remove duplicates

Config: `GRAPH_EXPANSION_ENABLED=true`, `GRAPH_EXPANSION_DEPTH=1`

---

## Stream G — Agent-native Patterns

**Goal**: Memory patterns that match how LLM agents actually work.

### G1 — Working Memory (Session-scoped)

**New package**: `packages/memory-working`

- `WorkingMemoryService` — ephemeral, session-scoped, disappears on session end
- Backed by Redis (enterprise) or MemoryCacheService (lite) with `TTL = session timeout`
- Key structure: `memory:working:{agentId}:{sessionId}:{memoryId}`
- No vector embedding (too ephemeral); keyword search only
- Auto-promotion: if working memory `accessCount > WORKING_PROMOTE_THRESHOLD`, auto-promote to STM/LTM

### G2 — Conversation Thread Memory

**Schema addition**: `Memory.threadId String?` (indexed)

- All memory operations accept optional `threadId`
- `list_memories` and `recall` filter by threadId
- Thread memory is LTM scoped to a conversation
- `get_session_context` returns thread memories in chronological order

### G3 — Agent Profiles

**New Prisma model**:

```prisma
model AgentProfile {
  id          String   @id @default(cuid())
  agentId     String   @unique
  userId      String
  name        String
  description String?
  preferences Json     @default("{}")  // tool preferences, verbosity, domain focus
  systemPrompt String? // injected at session start
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  user        User     @relation(fields: [userId], references: [id])
}
```

**New MCP tools**: `create_agent_profile`, `get_agent_profile`, `update_agent_profile`

### G4 — Context Injection Templates

**New service**: `ContextInjector` in `packages/search`

- `buildContextBlock(memories, format)` — formats memories for LLM injection
- Formats: `xml` (Claude-native), `markdown`, `json`, `plain`
- Auto-truncates to `maxTokens` budget (uses tiktoken for counting)
- `load_context` tool uses this to return a ready-to-paste context block

### G5 — Automatic Promotion Rules

**New service**: `PromotionRuleEngine`

- Configurable rules evaluated on every STM access:
  - `access_count >= N` → promote to LTM
  - `importance_score >= threshold` → promote
  - `tagged_as('important')` → promote immediately
- Rules stored in JSON config (`PROMOTION_RULES_JSON`) or AgentProfile preferences
- Runs asynchronously after STM read; does not block recall latency

---

## Stream H — Observability & SDK

**Goal**: Production visibility and first-class developer SDK.

### H1 — OpenTelemetry Traces

**New package**: `packages/telemetry`

- Wraps `@opentelemetry/sdk-node`
- Auto-instruments: all MCP tool calls, LTM/STM service methods, vector store operations, embeddings
- Span attributes: `memory.userId`, `memory.tool`, `memory.type`, `memory.count`, `memory.latencyMs`
- Exporters: OTLP (default), Jaeger, console
- Config: `OTEL_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT`

### H2 — Memory Analytics

**New NestJS module**: `AnalyticsModule`

- Persists event log in Postgres: `MemoryEvent { id, userId, tool, memoryId, durationMs, success, createdAt }`
- Aggregation queries for `get_recall_stats` and `get_user_stats` tools (Stream C6)
- Exposes `/analytics` REST endpoint (admin-guarded) for dashboard consumption
- TTL: events older than `ANALYTICS_RETENTION_DAYS` (default 90) pruned by daily job

### H3 — TypeScript SDK

**New package**: `packages/sdk`

```typescript
// Usage:
import { EngramClient } from '@engram/sdk';

const engram = new EngramClient({ baseUrl: 'http://localhost:3000', apiKey: '...' });

await engram.remember('Learned that TypeScript generics improve type safety');
const results = await engram.recall('type safety', { limit: 5 });
await engram.forget('outdated information about React');
const context = await engram.loadContext({ maxTokens: 2000 });
```

- Wraps MCP HTTP transport with typed methods
- Streaming support via async iterators
- React hook: `useEngram()` for web app integration
- Auto-retry with exponential backoff

### H4 — Python SDK

**New package**: `sdks/python`

```python
from engram import EngramClient

client = EngramClient(base_url="http://localhost:3000", api_key="...")
client.remember("Python is great for data science")
results = client.recall("data science", limit=5)
```

- Matches TypeScript SDK feature parity
- Async support via `asyncio`
- Published to PyPI as `engram-memory`

### H5 — Webhook Events

**New NestJS module**: `WebhookModule`

- Configurable webhook URLs per user/org
- Events: `memory.created`, `memory.promoted`, `memory.archived`, `memory.consolidated`, `reindex.completed`
- Delivery: queued via BullMQ, retried with exponential backoff
- HMAC-SHA256 signatures on all payloads
- MCP tools: `register_webhook`, `list_webhooks`, `delete_webhook`

### H6 — SSE / Streaming Memory Feed

**New endpoint**: `GET /stream` (SSE)

- Real-time stream of memory events for a user/session
- Useful for agent UIs that show memory activity in real time
- Auth via Bearer token; scoped to authenticated user
- Event types: `memory_created`, `memory_recalled`, `memory_promoted`, `reindex_progress`

---

## Stream I — Temporal & Decision Trail

**Goal**: Time-travel debugging and decision reconstruction — a unique context-mem feature Engram lacks.

### I1 — Event Log (immutable audit trail)

**New Prisma model**:
```prisma
model MemoryEvent {
  id         String   @id @default(cuid())
  userId     String
  memoryId   String?
  eventType  String   // 'created'|'updated'|'deleted'|'promoted'|'recalled'|'archived'|'consolidated'
  snapshot   Json     // full memory state at event time (for time-travel)
  metadata   Json     @default("{}")
  createdAt  DateTime @default(now())
  @@index([userId, createdAt])
  @@index([memoryId, createdAt])
}
```

All LTM write operations append to this log (after-write, non-blocking). The snapshot field
stores the full memory state so any past state is reconstructable without joins.

### I2 — Temporal Query

**New MCP tool**: `temporal_query`

Input: `{ userId, query, asOf: ISO8601 }`  
Logic: filter `MemoryEvent` for records where `createdAt <= asOf` and `eventType != 'deleted'`,
reconstruct memory state from snapshots, run hybrid search over that reconstructed set.

"What did this agent know about authentication on 2025-01-15?"

### I3 — Time Travel / State Comparison

**New MCP tool**: `time_travel`

Input: `{ userId, fromDate: ISO8601, toDate: ISO8601, query? }`  
Returns: memories added, changed, and removed between the two timestamps; optional semantic diff.

### I4 — Decision Trail Reconstruction

**New MCP tool**: `explain_decision`

Input: `{ userId, memoryId }` (the decision memory)  
Logic: traverse `MemoryEvent` backward from the decision's `createdAt` — find all memories
that were active at that time and share entity overlap with the decision.
Returns: ordered evidence chain showing what information was available that led to the decision.

### I5 — Predict Loss

**New MCP tool**: `predict_loss`

Input: `{ userId, daysAhead?: number }`  
Returns: memories that will be archived/compressed within `daysAhead` days based on current
decay trajectory. Allows agents to pin critical memories before they fade.

---

## Stream J — Token Budget & Compression

**Goal**: Context-mem's headline feature — 99% token savings and token-budgeted session primers.

### J1 — Token Budget Tracker

**New Prisma model**:
```prisma
model TokenBudget {
  userId           String  @id
  budgetTokens     Int     @default(8000)
  overflowStrategy String  @default("compress_oldest") // 'compress_oldest'|'compress_low_importance'|'hard_truncate'
  wakeUpProfile    Float   @default(0.15) // fraction for agent profile
  wakeUpKnowledge  Float   @default(0.40)
  wakeUpDecisions  Float   @default(0.30)
  wakeUpEntities   Float   @default(0.15)
}
```

**New service**: `TokenBudgetService`
- `estimate(memories[])` — count tokens via `tiktoken` (cl100k_base)
- `allocate(userId, totalBudget)` — apply profile/knowledge/decisions/entities fractions
- `applyOverflow(memories[], budget, strategy)` — trim to budget via selected strategy

**New MCP tools**: `budget_status`, `budget_configure`

### J2 — Wake-Up Session Primer

**New MCP tool**: `wake_up`

The most important single tool for agent UX — equivalent to "good morning briefing."

Input: `{ userId, agentId?, maxTokens?: number, sessionContext?: string }`  
Logic:
1. Load AgentProfile for system prompt context (J1 profile fraction)
2. Load top critical knowledge by importanceScore (J1 knowledge fraction)
3. Load recent DECISION/MILESTONE flagged memories (J1 decisions fraction)
4. Load most-accessed entity summaries (J1 entities fraction)
5. Pack into `maxTokens` budget, compress if needed (B3 summarizers)
6. Return formatted context block ready for LLM system prompt injection

Returns: `{ contextBlock: string, tokenCount: number, memoriesIncluded: number, memoriesOmitted: number }`

### J3 — Compression-Aware `load_context`

**New MCP tool**: `load_context`

Like `wake_up` but query-targeted: retrieve + compress memories relevant to a specific task.

Input: `{ userId, query, maxTokens, format: 'xml'|'markdown'|'json'|'plain' }`  
Returns compressed context block formatted for the specified LLM injection style.

### J4 — `summarize` (one-shot, no storage)

**New MCP tool**: `summarize`

Compress arbitrary text without storing it. Used for external content (URLs, file contents)
before feeding to LLM context. Uses B3 content-aware summarizer selection.

---

## Implementation Priority

Execute all streams in parallel. Within each stream, sequence tasks in order listed.

| Priority | Stream | Why first |
|---|---|---|
| **P0** | A — Search | Closes biggest quality gap; unblocks C search tools |
| **P0** | B — Intelligence + Dreamer | 13-step pipeline is the core architecture; Dreamer is unique differentiator |
| **P0** | D — Lite Mode | Enables fast local testing; zero-dep deployment for adoption |
| **P0** | J — Token Budget | `wake_up` is the highest-impact single agent UX feature |
| P1 | E — Multi-tenancy & Auth | Required for enterprise production use |
| P1 | G — Agent-native Patterns | Depends on E for scoping; high impact |
| P1 | I — Temporal & Decision Trail | Unique capability; `MemoryEvent` log is a one-time schema change |
| P2 | C — Tool Expansion | User-visible; depends on A+B+J for quality tools |
| P2 | F — Knowledge Graph | Powerful but additive; can ship incrementally |
| P3 | H — Observability & SDK | Production polish; benefits from all other streams |

---

## Schema Migration Summary

All migrations are additive (no breaking changes to existing tables).

| Migration | Tables affected | Breaking? | Stream |
|---|---|---|---|
| Add FTS tsvector column + GIN index | memories | No | A |
| Add pg_trgm extension + trigram index | memories | No | A |
| Add importanceScore, importanceFlags, accessCount, lastAccessedAt, pinned, status, compressionTier | memories | No | B |
| Add threadId | memories | No | G |
| Add MemoryEvent (immutable audit log with snapshots) | new table | No | I |
| Add DreamerRun | new table | No | B |
| Add Organization, OrganizationMember, ApiKey, OrgQuota | new tables | No | E |
| Add MemoryLink | new table | No | F |
| Add AgentProfile | new table | No | G |
| Add TokenBudget | new table | No | J |
| Add WebhookConfig | new table | No | H |
| Add AnalyticsEvent | new table | No | H |

---

## Minimal Overhead Configuration

For single-process, zero-dependency deployments:

```env
ENGRAM_MODE=lite
DATABASE_URL=file:./engram.db
VECTOR_BACKEND=memory
EMBEDDING_PROVIDER=local    # or openai for quality
VAULT_ENABLED=true
VAULT_PATH=./memories
# No REDIS_URL, QDRANT_URL needed
```

Expected startup time: **< 3 seconds**  
Memory footprint: **< 150MB**  
Docker image: **< 100MB** (Alpine + node + SQLite)

For full enterprise:

```env
ENGRAM_MODE=enterprise
# ... existing full config
HYBRID_SEARCH_ENABLED=true
DECAY_ENABLED=true
OTEL_ENABLED=true
GRAPH_EXPANSION_ENABLED=true
```

---

## Quality Gates Per Stream

Each stream must pass before merging:

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test                    # unit + integration
pnpm eval                    # recall quality regression
pnpm bench:backends          # latency regression (p99 < 100ms for recall)
```

| Stream | Additional gate |
|---|---|
| A | Hybrid precision@5 ≥ 0.40 (vs 0.267 vector-only); p99 recall latency ≤ 100ms |
| B | Dreamer cycle completes in < 30s on 10k memories; compression ratio ≥ 80% for log content |
| D | Lite-mode cold start < 3s; memory footprint < 150MB |
| E | Auth integration test: no userId cross-contamination between tenants |
| I | `temporal_query` correctness test: state at T1 never includes events after T1 |
| J | `wake_up` response ≤ maxTokens budget (test with tiktoken); latency < 500ms |

---

## New Package Structure

After all streams, the monorepo gains:

```
packages/
  search/          # Stream A — HybridSearchService, RrfFusion, RerankerService, QueryExpander, TrigramSearch
  cache/           # Stream D — CacheService interface + Redis and in-memory implementations
  queue/           # Stream D — QueueService interface + BullMQ and in-process implementations
  database-lite/   # Stream D — SQLite Prisma schema and migrations
  sdk/             # Stream H — TypeScript client SDK
sdks/
  python/          # Stream H — Python SDK
apps/
  dashboard/       # Stream H — tRPC + React dashboard (localhost:3141 equivalent)
```

All existing packages (`memory-stm`, `memory-ltm`, `vector-store`, `embeddings`, `core`,
`config`, `database`, `redis`, `eval`) are extended in-place — no renames or splits.
