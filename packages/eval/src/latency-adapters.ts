/**
 * Adapters that turn a production vector store into a {@link LatencyTarget}.
 *
 * The eval package stays dependency free: instead of importing
 * `@engram/vector-store`, the adapter accepts a minimal structural interface
 * that both the Qdrant and pgvector backends satisfy. This keeps benchmarking
 * backend-agnostic while avoiding a hard package dependency.
 */

import type { LatencyTarget } from './latency.js';

/** A single seeded record. */
export interface LatencyFixtureRecord {
  readonly id: string;
  readonly vector: readonly number[];
  readonly metadata?: Record<string, unknown>;
}

/** A query issued during measurement. */
export interface LatencyFixtureQuery {
  readonly vector: readonly number[];
  readonly limit?: number;
  readonly filter?: unknown;
}

/**
 * Minimal structural contract shared by ENGRAM vector stores. Both
 * `QdrantVectorStore` and `PgVectorStore` satisfy this shape, but neither type
 * is imported here so the eval package remains standalone.
 */
export interface VectorStoreLike {
  upsert(
    records: ReadonlyArray<{
      id: string;
      vector: readonly number[];
      metadata?: Record<string, unknown>;
    }>
  ): Promise<unknown>;
  search(vector: readonly number[], limit: number, filter?: unknown): Promise<unknown>;
  delete?(ids: readonly string[]): Promise<unknown>;
}

export interface VectorStoreLatencyTargetOptions {
  /** The vector store under test. */
  store: VectorStoreLike;
  /** Records upserted once before measurement. */
  records: readonly LatencyFixtureRecord[];
  /** Queries cycled through across measured iterations. Must be non-empty. */
  queries: readonly LatencyFixtureQuery[];
  /** Fallback filter used when a query omits one. */
  defaultFilter?: unknown;
  /** Default search limit when a query omits one (default 10). */
  defaultLimit?: number;
  /**
   * When true (default), seeded record ids are deleted during teardown if the
   * store exposes a `delete` method.
   */
  cleanup?: boolean;
}

/**
 * Build a {@link LatencyTarget} that seeds a vector store with fixtures and
 * measures search latency by cycling through the provided queries.
 */
export function createVectorStoreLatencyTarget(
  options: VectorStoreLatencyTargetOptions
): LatencyTarget {
  const { store, records, queries, defaultLimit = 10, cleanup = true } = options;
  const defaultFilter = options.defaultFilter;

  if (queries.length === 0) {
    throw new Error('createVectorStoreLatencyTarget requires at least one query');
  }

  return {
    seed: async () => {
      if (records.length > 0) {
        await store.upsert(
          records.map((record) => ({
            id: record.id,
            vector: record.vector,
            metadata: record.metadata,
          }))
        );
      }
    },
    search: async (iteration: number) => {
      const query = queries[iteration % queries.length] as LatencyFixtureQuery;
      return store.search(query.vector, query.limit ?? defaultLimit, query.filter ?? defaultFilter);
    },
    teardown: async () => {
      if (cleanup && store.delete && records.length > 0) {
        await store.delete(records.map((record) => record.id));
      }
    },
  };
}
