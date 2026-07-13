---
title: Capacity & scaling
description: Load testing results, throughput baselines, and scaling guidance for ENGRAM.
---

<!-- Migrated from docs/CAPACITY.md (WP6 T7b). -->

## Overview

This document captures ENGRAM's memory-pipeline capacity characteristics and
provides guidance on scaling each component. Run the load test script to
reproduce measurements against your own infrastructure.

```bash
# Full 10-second test, 8 concurrent workers
node scripts/load-test.mjs --duration-ms 10000 --concurrency 8 --output artifacts/load-report.json

# Quick smoke test
node scripts/load-test.mjs --duration-ms 3000 --concurrency 4
```

`DATABASE_URL` must be set and point to a Postgres instance with the `vector`
extension available (`pgvector/pgvector:pg16+` Docker image).

## Scenarios

| Scenario   | What it measures                                                                     |
| ---------- | ------------------------------------------------------------------------------------ |
| **Write**  | Concurrent `memories` INSERTs via Prisma (no external embedding call — fake vectors) |
| **Recall** | Concurrent pgvector HNSW kNN searches (`ORDER BY embedding_vec <=> $query LIMIT 10`) |

## Baseline Thresholds

| Metric         | Target   | Action if exceeded                              |
| -------------- | -------- | ----------------------------------------------- |
| Write p95      | < 100 ms | Tune connection pool or switch to batch inserts |
| Recall p95     | < 50 ms  | Tune HNSW `ef_search` / add RAM                 |
| Write ops/sec  | > 100    | Enable PgBouncer or batching                    |
| Recall ops/sec | > 50     | Add read replica for search traffic             |

## Bottleneck Map

### 1. Embedding generation (write path)

**Primary bottleneck in production.** Every memory creation calls the OpenAI
Embeddings API (or a local provider). At 8 concurrent workers, embedding latency
(~100–500 ms/call) dominates over Postgres write latency (~5–20 ms).

Mitigations:

- **Redis cache** — already wired in `EmbeddingsService`; 30-day TTL. Cache hit
  rate is exported via `getPrometheusMetrics()` (`engram_embeddings_cacheHits_total`).
- **Batch embeddings** — OpenAI `/v1/embeddings` accepts up to 2048 texts per
  request. Use `bulk ingest` (#127) to amortize API overhead.
- **Local provider** — `EMBEDDING_PROVIDER=local` uses a deterministic hash
  embedding with no external call. Suitable for development and tests.

### 2. Postgres connection pool

Default NestJS/Prisma configuration opens one connection per process. Under
high concurrency (> 20 workers) connection wait time becomes visible in write
p99.

Mitigations:

- Set `connection_limit` in `DATABASE_URL`:
  `postgresql://...?connection_limit=20&pool_timeout=10`
- Deploy **PgBouncer** in transaction-pooling mode in front of Postgres for
  > 50 concurrent clients.

### 3. HNSW index quality

The `embedding_vec` column uses an HNSW index with default parameters
(`m=16`, `ef_construction=64`). Recall quality and search speed are both
sensitive to these parameters.

Guidance:

- For datasets < 100 K vectors: defaults are fine. Recall p95 < 20 ms.
- For datasets 100 K – 1 M vectors: increase `ef_search` to 100–200:
  ```sql
  SET hnsw.ef_search = 128;
  ```
- For > 1 M vectors: evaluate migrating to Qdrant, which handles large
  collections with better memory control (`VECTOR_BACKEND=qdrant`).

### 4. Redis (STM + embedding cache)

Redis is used for STM keys and the embedding cache. Neither path is typically
a bottleneck at < 500 concurrent clients. If Redis CPU becomes visible, enable
cluster mode or move embedding cache to a separate Redis instance.

## Scaling Playbook

### Horizontal scaling (stateless compute)

The MCP server is stateless — all state lives in Postgres, Redis, and Qdrant.
Add server instances behind a load balancer and set a shared `DATABASE_URL`,
`REDIS_URL`, and `QDRANT_URL`. No session stickiness is required.

### Read replica for recall

Vector search is read-only and often the highest-traffic path. Route `recall`
tool calls to a Postgres read replica:

```
RECALL_DATABASE_URL=postgresql://replica-host/engram
```

The `MemoryLtmService` can be updated to use a separate read-only Prisma
client for search queries.

### Vertical scaling thresholds

| Component | When to scale up                                              |
| --------- | ------------------------------------------------------------- |
| Postgres  | RAM < 2 × working set (HNSW index must fit in shared_buffers) |
| Redis     | Memory usage > 80% of `maxmemory`                             |
| Qdrant    | RAM < 1.5 × total vector bytes                                |

### Connection pool sizing

```
max_connections = (num_cpu_cores × 2) + num_disk_spindles
```

For a 4-core server: `max_connections = 9`. Set Prisma's `connection_limit`
to `max_connections - 2` (reserve 2 for admin / migrations).

## Running in CI

The load test is intentionally **not** wired into default CI because it
requires sustained database resources and ~30+ seconds to complete. Run it
manually before a release or on a nightly schedule:

```bash
DATABASE_URL=postgresql://... node scripts/load-test.mjs \
  --duration-ms 30000 \
  --concurrency 16 \
  --output artifacts/load-report.json
```

For vector-search latency gates that run in every PR, see `pnpm bench:ci`
(runs `bench-vector-backends.mjs` with a p95 ≤ 120 ms threshold).
