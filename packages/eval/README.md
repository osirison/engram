---
title: '@engram/eval'
description: Retrieval evaluation harness for measuring ENGRAM recall relevance
---

# @engram/eval

A small, dependency-free harness for scoring memory retrieval quality against a
labeled dataset. It computes the standard information-retrieval metrics so
changes to recall (keyword, vector, or hybrid) can be compared objectively.

## Metrics

- **precision@k** — fraction of the top `k` results that are relevant.
- **recall@k** — fraction of all relevant memories found within the top `k`.
- **MRR** — mean reciprocal rank of the first relevant result per query.
- **nDCG@k** — normalized discounted cumulative gain, rewarding higher-ranked
  relevant results.

## Run the harness

From the repository root:

```bash
pnpm eval
```

This builds the package and runs the keyword baseline retriever over the labeled
fixtures in [src/fixtures/recall-fixtures.ts](src/fixtures/recall-fixtures.ts),
then prints an aggregate report.

## Baseline results

The keyword baseline (a deterministic TF-IDF retriever) over the bundled
fixtures at `k = 5`:

| Metric      | Value |
| ----------- | ----- |
| precision@5 | 26.7% |
| recall@5    | 91.7% |
| MRR         | 1.000 |
| nDCG@5      | 0.922 |

Precision@5 is low by design: most queries have only one or two relevant
memories, so the remaining slots in the top five are necessarily non-relevant.
Recall, MRR, and nDCG are the headline numbers for recall quality.

## Evaluate a custom retriever

```ts
import { runHarness, recallFixtures } from '@engram/eval';

const report = await runHarness(
  recallFixtures.queries,
  async (query, limit) => {
    // Return an ordered list of memory ids, best match first.
    return myRetriever.search(query, limit);
  },
  5
);
```

The `Retriever` callback may be synchronous or asynchronous, so a live vector
search against Qdrant can be scored with the same harness.

## Hybrid fusion

`createFusionRetriever` combines several retrievers into one hybrid ranking
using Reciprocal Rank Fusion (RRF). Each retriever runs in parallel and every
returned id contributes `weight / (k + rank)` to a fused score, so documents
ranked highly by multiple retrievers rise to the top.

```ts
import {
  runHarness,
  recallFixtures,
  createKeywordRetriever,
  createFusionRetriever,
} from '@engram/eval';

const keyword = createKeywordRetriever(recallFixtures.documents);
const hybrid = createFusionRetriever([keyword, vectorRetriever], {
  k: 60, // damping constant (DEFAULT_RRF_K)
  weights: [1, 2], // optional, aligned with the retriever order
  candidateLimit: 50, // fetch more candidates per retriever before fusing
});

const report = await runHarness(recallFixtures.queries, hybrid, 5);
```

`reciprocalRankFusion(rankings, options)` is also exported for fusing
precomputed id lists directly. Fusion is deterministic: ties break by the best
observed rank, then lexicographically by id.

## Embedding retriever

`createEmbeddingRetriever` scores documents by cosine similarity against an
embedded query. Documents are embedded once during construction, so repeated
queries reuse the cached vectors. Inject a real provider for live scoring or a
deterministic stub for reproducible tests — the same `embed` function must be
used for documents and queries.

```ts
import { runHarness, recallFixtures, createEmbeddingRetriever } from '@engram/eval';

const retriever = await createEmbeddingRetriever(
  recallFixtures.documents,
  (text) => embeddings.embed(text), // sync or async, returns number[]
  { minScore: 0.2 } // optional cosine floor
);

const report = await runHarness(recallFixtures.queries, retriever, 5);
```

`cosineSimilarity` is exported for ad-hoc scoring. Combine the embedding
retriever with the keyword retriever via `createFusionRetriever` for a hybrid
baseline.

## Latency benchmarking

`runLatencyBenchmark` measures search latency for any backend that implements
the small `LatencyTarget` contract (`seed?`, `search`, `teardown?`). It is
backend-agnostic: wrap a Qdrant or pgvector `VectorStore` to compare their
percentiles under the same workload.

```ts
import { runLatencyBenchmark } from '@engram/eval';

const result = await runLatencyBenchmark({
  target: {
    seed: async () => store.upsert(fixtures),
    search: async (i) => store.search(queryVectors[i % queryVectors.length], { userId }),
    teardown: async () => store.delete(fixtureIds),
  },
  iterations: 200,
  warmup: 20,
  thresholds: { p95: 50, p99: 100 }, // milliseconds
});

console.log(result.summary); // { count, min, max, mean, p50, p95, p99 }
console.log(result.passed, result.breaches);
```

The result reports the full latency distribution, the raw per-call samples, and
any threshold breaches. The clock is injectable (`now`) for deterministic tests.
`percentile` and `summarize` are also exported for ad-hoc analysis.

### Vector store adapter

`createVectorStoreLatencyTarget` builds a `LatencyTarget` from any object that
matches the minimal `VectorStoreLike` shape (`upsert`, `search`, optional
`delete`). Both the Qdrant and pgvector backends satisfy it, so the eval package
benchmarks either one without importing `@engram/vector-store`.

```ts
import { createVectorStoreLatencyTarget, runLatencyBenchmark } from '@engram/eval';

const target = createVectorStoreLatencyTarget({
  store, // QdrantVectorStore | PgVectorStore | any VectorStoreLike
  records: fixtures, // [{ id, vector, metadata? }]
  queries: [{ vector: queryVector, limit: 10 }],
  cleanup: true, // delete seeded ids on teardown when supported
});

const result = await runLatencyBenchmark({ target, iterations: 200, warmup: 20 });
```

### Bench CLI

```bash
pnpm --filter @engram/eval bench -- --iterations 200 --warmup 20 --p95 50
```

The CLI runs against a deterministic in-memory fake target by default, so it
needs no external services. Flags: `--iterations`/`-n`, `--warmup`, `--p95`,
`--p99` (thresholds in milliseconds). It exits non-zero on a threshold breach.
