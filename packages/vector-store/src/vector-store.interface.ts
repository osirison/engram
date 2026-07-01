import type { Logger } from '@nestjs/common';

/**
 * Dependency injection token for the active {@link VectorStore} implementation.
 *
 * Resolves to a concrete provider (Qdrant or pgvector) selected at runtime by
 * {@link VectorStoreModule} based on the `VECTOR_BACKEND` environment variable.
 */
export const VECTOR_STORE_TOKEN = 'VECTOR_STORE';

/**
 * Supported vector-store backends.
 */
export type VectorBackend = 'qdrant' | 'pgvector';

/**
 * A single vector record to store or update.
 */
export interface VectorRecord {
  /** Stable identifier, normally the owning memory id. */
  id: string;
  /** Dense embedding vector. */
  vector: number[];
  /** Arbitrary, filterable metadata stored alongside the vector. */
  payload?: VectorPayload;
}

/**
 * Metadata persisted with each vector and used for scoped filtering.
 */
export interface VectorPayload {
  /** Owning user/tenant; every search must be scoped by this. */
  userId: string;
  /** Organization the memory belongs to; absent for personal memories. */
  organizationId?: string;
  /** Optional logical namespace (agent / session / project). */
  scope?: string;
  /** Memory type, e.g. `long-term`. */
  type?: string;
  /** Free-form tags. */
  tags?: string[];
  /**
   * Creation time as epoch milliseconds. Stored so searches can be constrained
   * to a time range without a round-trip to the source database.
   */
  createdAt?: number;
  [key: string]: unknown;
}

/**
 * Filter applied to a similarity search. All provided fields are combined with
 * logical AND. `userId` is mandatory to guarantee tenant isolation.
 */
export interface VectorSearchFilter {
  userId: string;
  /** When set, restricts results to the given organization. */
  organizationId?: string;
  scope?: string;
  type?: string;
  /** Match records containing all of these tags. */
  tags?: string[];
  /** Lower bound (inclusive) on the record's `createdAt`. */
  createdFrom?: Date;
  /** Upper bound (inclusive) on the record's `createdAt`. */
  createdTo?: Date;
}

/**
 * A single similarity-search hit.
 */
export interface VectorSearchResult {
  id: string;
  /** Similarity score (higher is more similar). */
  score: number;
  payload?: VectorPayload;
}

/**
 * Backend-agnostic vector storage contract.
 *
 * Implementations wrap a concrete engine (Qdrant, pgvector, ...) so the memory
 * layer can perform the vector lifecycle (upsert / delete / search) without
 * depending on a specific database.
 */
export interface VectorStore {
  /** Human-readable backend name, used for logging and diagnostics. */
  readonly backend: VectorBackend;

  /**
   * Ensure the backing collection/table exists with the given dimensionality.
   * Implementations must be idempotent.
   */
  ensureReady(dimensions: number): Promise<void>;

  /**
   * Insert or replace one or more vectors.
   */
  upsert(records: VectorRecord[]): Promise<void>;

  /**
   * Remove vectors by id. Missing ids are ignored.
   */
  delete(ids: string[]): Promise<void>;

  /**
   * Remove all stored vectors so a subsequent {@link upsert} rebuilds the index
   * from scratch. Used by a full reindex for a clean backfill. Idempotent.
   */
  reset(): Promise<void>;

  /**
   * Run a k-nearest-neighbour search filtered by {@link VectorSearchFilter}.
   */
  search(
    vector: number[],
    filter: VectorSearchFilter,
    limit?: number
  ): Promise<VectorSearchResult[]>;
}

/**
 * Shared guard helpers reused by concrete implementations.
 */
export function assertNonEmptyVector(vector: number[], logger?: Logger): void {
  if (!Array.isArray(vector) || vector.length === 0) {
    logger?.warn('Vector must contain at least one dimension');
    throw new Error('Vector must contain at least one dimension');
  }
}
