---
title: Engram Enterprise Implementation Plan
description: Comprehensive gap analysis vs context-mem and parallel implementation streams for enterprise-grade agentic memory
---

## Overview

This plan closes the gap between Engram's current state and both context-mem's feature set and
enterprise-grade production requirements. It is structured into **8 independent parallel streams**
that teams can execute concurrently, each with its own scope, deliverables, and quality gates.

The dual goal: a **production-grade enterprise memory system** that can also run as a
**zero-dependency single-process lite mode** in under 5 seconds.

---

## Comparison: Engram vs context-mem

| Dimension | Engram (current) | context-mem |
|---|---|---|
| MCP tools | 13 | 44 |
| Storage | Postgres + Redis + Qdrant/pgvector | SQLite + markdown vault |
| Search | Vector similarity only | Hybrid BM25 + vector + RRF |
| Memory types | STM (Redis/TTL) + LTM (Postgres) | Single unified store |
| Token savings | None | ~99% via contextual compression |
| Memory intelligence | None (roadmap #99) | Consolidation, summarization |
| Multi-tenancy | userId only | None (single-user) |
| Auth | adminToken (reindex only) | None |
| Knowledge graph | None | None |
| Agent profiles | None | None |
| Session memory | None | None |
| Lite/embedded mode | None | SQLite (is the mode) |
| Evaluation harness | Full (precision/recall/MRR/nDCG) | LongMemEval claims 100% |
| Benchmarking | Latency p50/p95/p99 | None documented |
| Async jobs | BullMQ | None |
| Horizontal scale | Partial (stateless HTTP) | No |
| Observability | Basic logs | None |
| SDK | None | None |
| Streaming events | None | None |

### Engram Advantages
- Enterprise Postgres/Redis architecture scales to millions of memories
- Dual vector backends with HNSW tuning
- Async reindex with cursor resumption and BullMQ
- Strict multi-tenant isolation (all operations scoped to userId)
- Evaluation harness with CI regression gates
- NestJS DI makes feature addition fast and testable

### context-mem Advantages
- 44 tools — higher-level agent ergonomics (remember/recall/forget/reflect/compress)
- Hybrid BM25 + vector search with RRF fusion
- Contextual compression (massive token savings)
- Zero-dependency SQLite deployment
- Markdown vault (human-readable memory store)

---

## Gap Analysis — Tools Missing in Engram

context-mem's 44 tools vs Engram's 13 implies ~31 additional tools. Categories:

| Category | Missing tools |
|---|---|
| High-level agent UX | `remember`, `forget`, `reflect`, `compress_context`, `load_context` |
| Search | `search_memories` (BM25/FTS), `find_similar`, `filter_memories` |
| Organization | `add_tags`, `remove_tags`, `list_tags`, `archive_memory`, `unarchive_memory`, `pin_memory`, `bulk_tag` |
| Relationships | `link_memories`, `unlink_memories`, `get_linked_memories`, `find_related` |
| Bulk | `bulk_create`, `bulk_delete`, `bulk_update`, `export_memories`, `import_memories` |
| Analytics | `get_memory_stats`, `get_user_stats`, `get_recall_stats` |
| Session | `start_session`, `end_session`, `get_session_context`, `clear_working_memory` |
| Agent | `create_agent_profile`, `get_agent_profile`, `update_agent_profile` |
| Snapshots | `create_snapshot`, `restore_snapshot`, `list_snapshots` |

---

## Stream Map

```
Stream A ─── Search & Retrieval Intelligence     (no deps)
Stream B ─── Memory Intelligence                 (no deps)
Stream C ─── MCP Tool Expansion     ────────────►(depends on A + B for some tools)
Stream D ─── Lite / Embedded Mode               (no deps)
Stream E ─── Multi-tenancy & Auth               (no deps)
Stream F ─── Knowledge Graph                    (no deps)
Stream G ─── Agent-native Patterns  ────────────►(light dep on E for scoping)
Stream H ─── Observability & SDK    ────────────►(benefits from A–G completion)
```

All streams are independently startable. Streams C, G, H have soft dependencies but can
begin with the non-dependent tasks first.

---

## Stream A — Search & Retrieval Intelligence

**Goal**: Close the BM25 + hybrid search gap vs context-mem; achieve top-tier retrieval quality.

### A1 — Postgres Full-Text Search (BM25 equivalent)

**Package**: `packages/memory-ltm`  
**Prisma migration**: add `tsvector` generated column on `memories.content`

```sql
ALTER TABLE memories ADD COLUMN content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX memories_content_tsv_gin ON memories USING GIN(content_tsv);
```

**New method** in `MemoryLtmService`:
```typescript
async fullTextSearch(userId: string, query: string, limit: number): Promise<Memory[]>
// Uses $queryRaw with ts_rank_cd and plainto_tsquery
```

### A2 — Hybrid Search with RRF Fusion

**Package**: `packages/memory-ltm` + new `packages/search`

Create `packages/search` with:
- `HybridSearchService` — orchestrates BM25 (Postgres FTS) + vector (existing VectorStore)
- `RrfFusion` — Reciprocal Rank Fusion (already in `@engram/eval` as `FusionRetriever`, extract to shared)
- `SearchResult<T>` — typed result with `score`, `source: 'bm25' | 'vector' | 'fused'`, `rank`

Config via env:
```
HYBRID_SEARCH_ENABLED=true
HYBRID_BM25_WEIGHT=0.3
HYBRID_VECTOR_WEIGHT=0.7
HYBRID_RRF_K=60
```

Update `recall` tool and add `search_memories` tool to use hybrid pipeline.

### A3 — Re-ranking Layer

**Package**: `packages/search`

`RerankerService` with two strategies (selectable via `RERANKER_STRATEGY`):
- `cross-score` — uses a second LLM call to score query–memory pairs (high quality)
- `cohere` — Cohere Rerank API (fast, cheap)
- `heuristic` (default) — combines recency, access count, importance score, and vector similarity

### A4 — Query Expansion

**Package**: `packages/search`

`QueryExpander` — optionally expands the query before embedding/FTS:
- Hypothetical Document Embeddings (HyDE): generate a fake "ideal memory" and embed that
- Synonym expansion via lightweight word list
- Toggle via `QUERY_EXPANSION=hyde|synonyms|disabled`

### A5 — Contextual Compression

**Package**: `packages/search`

`ContextCompressor` — post-retrieval compression to reduce token usage:
- Extracts only the sentence(s) from each memory relevant to the query
- Uses OpenAI with a tight prompt; falls back to truncation if provider unavailable
- Returns `CompressedMemory[]` with original id + compressed_content + token_delta
- Enables ~90%+ token savings on large memory sets (matching context-mem's key feature)

New MCP tool: `compress_context` — retrieve + compress in one call

**Quality gate**: Add A-stream metrics to `@engram/eval`:
- `hybridPrecision@k`, `hybridRecall@k`, `compressionRatio`, `tokenSavings`

---

## Stream B — Memory Intelligence

**Goal**: Memories that think — consolidation, decay, deduplication, reflection.

### B1 — Importance Scoring

**Package**: `packages/memory-ltm`  
**Schema**: add `importanceScore Float? @default(0.5)` and `accessCount Int @default(0)` to Memory

`ImportanceScoringService`:
- Base score: 0.5 at creation
- Boosted by: explicit `importance` in metadata, manual pinning, tag count
- Decayed by: time since last access (half-life configurable via `IMPORTANCE_HALF_LIFE_DAYS`)
- Updated on each `recall` hit: `accessCount++`, `lastAccessedAt = now()`
- Persisted back to Postgres asynchronously (fire-and-forget, no recall latency impact)

### B2 — Decay & Archiving

**Package**: `packages/memory-ltm`  
**Schema**: add `status: 'active' | 'archived' | 'pinned'`  
**New Prisma migration**: index on `(userId, status, importanceScore)`

`DecayService` (scheduled, runs via `@nestjs/schedule` cron):
- Daily job: find memories where `importanceScore < DECAY_ARCHIVE_THRESHOLD` (default 0.1)
  and `lastAccessedAt < now() - DECAY_ARCHIVE_AFTER_DAYS` (default 90 days)
- Archives them (sets `status='archived'`) — does NOT delete
- Emits memory events (`memory.archived`) via EventEmitter

`ArchivePolicy` configurable per-user via metadata:
```
DECAY_ENABLED=true
DECAY_ARCHIVE_THRESHOLD=0.1
DECAY_ARCHIVE_AFTER_DAYS=90
DECAY_DELETE_AFTER_DAYS=365  # hard delete after archival
```

### B3 — Deduplication & Consolidation

**Package**: `packages/memory-ltm`  
**New service**: `ConsolidationService`

Two strategies:
1. **Exact dedup**: hash-based (SHA-256 of normalized content) — checked on every `create_memory`
2. **Semantic dedup**: on `promote_memory` and nightly, check if new memory has cosine similarity > `DEDUP_SIMILARITY_THRESHOLD` (default 0.92) with existing LTM memories
   - If duplicate found: merge metadata + tags, keep higher importance, delete lower

**Merge policy**:
- Union of tags
- Newer content wins (or LLM-merged if content differs slightly)
- `importanceScore = max(a, b)`
- `accessCount = a + b`

### B4 — Contradiction Detection

**Package**: `packages/memory-ltm`  
**New service**: `ContradictionDetector`

- Runs on `create_memory` and `promote_memory` for LTM
- Retrieves top-3 semantically similar memories
- Sends to LLM with prompt: "Do these statements contradict each other?"
- If contradiction detected: adds `contradiction: true` + `contradicts: [id]` to metadata
- Does NOT auto-resolve — surface to agent via `get_memory` response and `reflect` tool

### B5 — Auto-Summarization

**Package**: `packages/memory-ltm`  
**New service**: `SummarizationService`

Triggered when:
- User's LTM memory count exceeds `SUMMARIZE_THRESHOLD` (default 5000)
- A tag group exceeds `SUMMARIZE_TAG_THRESHOLD` (default 500) memories
- Explicitly called via MCP tool `reflect`

Strategy:
- Group memories by tag or time window
- LLM-summarize the group into a single higher-level "insight" memory
- Archive the individual memories that were summarized
- New insight memory gets `type='insight'` in metadata and `importanceScore=0.8`

**Schema addition**: `Memory.type` field to distinguish `'short-term' | 'long-term' | 'insight'`

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

## Implementation Priority

Execute all streams in parallel. Within each stream, sequence A→B→C within the stream's tasks.

| Priority | Stream | Why |
|---|---|---|
| P0 (start immediately) | A — Search | Closes biggest quality gap; unblocks C tools |
| P0 (start immediately) | D — Lite Mode | Enables fast local testing; unblocks adoption |
| P1 | B — Intelligence | Core differentiator; feeds Stream C tools |
| P1 | E — Auth | Required for enterprise; feeds Stream G scoping |
| P2 | C — Tool Expansion | High user-visible impact; depends on A+B |
| P2 | G — Agent Patterns | Core enterprise differentiator |
| P3 | F — Knowledge Graph | Powerful but additive |
| P3 | H — Observability | Production requirement; can ship incrementally |

---

## Schema Migration Summary

All migrations are additive (no breaking changes to existing tables).

| Migration | Tables affected | Breaking? |
|---|---|---|
| Add FTS column | memories | No |
| Add status, importanceScore, accessCount | memories | No |
| Add threadId | memories | No |
| Add tsvector index | memories | No |
| Add Organization, Member, ApiKey, OrgQuota | new tables | No |
| Add MemoryLink | new table | No |
| Add AgentProfile | new table | No |
| Add MemoryEvent (analytics) | new table | No |
| Add WebhookConfig | new table | No |

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

Stream A additionally gates on hybrid search precision@5 ≥ 0.40 (vs current 0.267 vector-only).  
Stream D gates on lite-mode cold start < 3s.  
Stream E gates on auth penetration test (no userId cross-contamination).
