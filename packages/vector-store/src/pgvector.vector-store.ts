import { Injectable, Logger } from '@nestjs/common';
import {
  assertNonEmptyVector,
  type VectorBackend,
  type VectorPayload,
  type VectorRecord,
  type VectorSearchFilter,
  type VectorSearchResult,
  type VectorStore,
} from './vector-store.interface';

/**
 * Default table and column names backing the pgvector provider. The provider
 * stores embeddings in a dedicated `vector` column on the existing `memories`
 * table so Postgres remains the single source of truth.
 */
export const PGVECTOR_TABLE = 'memories';
export const PGVECTOR_COLUMN = 'embedding_vec';
export const PGVECTOR_INDEX = 'memories_embedding_vec_hnsw';

/**
 * Minimal structural contract for the Prisma client used by the pgvector
 * provider. `PrismaService` from `@engram/database` satisfies this interface,
 * but keeping it structural avoids a hard runtime dependency and keeps the
 * provider unit-testable with a lightweight mock.
 */
export interface PgVectorClient {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

/**
 * HNSW index tuning knobs.
 *
 * - `m` and `efConstruction` are build-time parameters baked into the index and
 *   trade index build cost for recall/latency.
 * - `efSearch` is the query-time search breadth; higher values improve recall at
 *   the cost of latency. It is applied via `SET hnsw.ef_search` before each
 *   search. Under transaction-pooled connections (e.g. PgBouncer transaction
 *   mode) the GUC may not persist, so prefer session pooling when tuning it.
 */
export interface PgVectorOptions {
  /** HNSW `m` (max connections per layer). pgvector range 2-100. */
  m?: number;
  /** HNSW `ef_construction` (build-time candidate list size). pgvector range 4-1000. */
  efConstruction?: number;
  /** HNSW `hnsw.ef_search` (query-time candidate list size). >= 1. */
  efSearch?: number;
}

function assertOptionalIntInRange(
  value: number | undefined,
  name: string,
  min: number,
  max: number
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/** Row shape returned by the kNN search query. */
interface PgVectorSearchRow {
  id: string;
  userId: string;
  organizationId: string | null;
  type: string | null;
  tags: string[] | null;
  scope: string | null;
  createdAt: Date | string | null;
  score: number | string;
}

/**
 * pgvector-backed {@link VectorStore} implementation.
 *
 * Stores embeddings in a `vector` column on the `memories` table and performs
 * cosine k-nearest-neighbour search using the pgvector `<=>` distance operator.
 * Enables single-datastore deployments (no separate Qdrant service required).
 *
 * All dynamic values are passed as bound parameters; only validated integer
 * dimensions and limits are interpolated into SQL text.
 */
@Injectable()
export class PgVectorStore implements VectorStore {
  readonly backend: VectorBackend = 'pgvector';

  private readonly logger = new Logger(PgVectorStore.name);
  private ensured = false;

  private readonly hnswM?: number;
  private readonly hnswEfConstruction?: number;
  private readonly hnswEfSearch?: number;

  constructor(
    private readonly client: PgVectorClient,
    private readonly dimensions: number,
    private readonly table: string = PGVECTOR_TABLE,
    private readonly column: string = PGVECTOR_COLUMN,
    options: PgVectorOptions = {}
  ) {
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error('PgVectorStore requires a positive integer dimensions value');
    }
    this.hnswM = assertOptionalIntInRange(options.m, 'PgVector HNSW m', 2, 100);
    this.hnswEfConstruction = assertOptionalIntInRange(
      options.efConstruction,
      'PgVector HNSW ef_construction',
      4,
      1000
    );
    this.hnswEfSearch = assertOptionalIntInRange(
      options.efSearch,
      'PgVector HNSW ef_search',
      1,
      1000
    );
  }

  async ensureReady(dimensions: number): Promise<void> {
    if (this.ensured) {
      return;
    }
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error('dimensions must be a positive integer');
    }

    await this.client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
    await this.client.$executeRawUnsafe(
      `ALTER TABLE "${this.table}" ADD COLUMN IF NOT EXISTS "${this.column}" vector(${dimensions})`
    );
    await this.client.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "${PGVECTOR_INDEX}" ON "${this.table}" ` +
        `USING hnsw ("${this.column}" vector_cosine_ops)${this.hnswBuildClause()}`
    );
    this.ensured = true;
    this.logger.log(`pgvector ready: ${this.table}.${this.column} (${dimensions} dims)`);
  }

  /** Builds the `WITH (...)` clause for HNSW build-time parameters, if configured. */
  private hnswBuildClause(): string {
    const params: string[] = [];
    if (this.hnswM !== undefined) {
      params.push(`m = ${this.hnswM}`);
    }
    if (this.hnswEfConstruction !== undefined) {
      params.push(`ef_construction = ${this.hnswEfConstruction}`);
    }
    return params.length > 0 ? ` WITH (${params.join(', ')})` : '';
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const first = records[0];
    if (!first) {
      return;
    }
    assertNonEmptyVector(first.vector, this.logger);
    if (first.vector.length !== this.dimensions) {
      throw new Error(
        `Vector dimensionality ${first.vector.length} does not match configured ${this.dimensions}`
      );
    }
    await this.ensureReady(this.dimensions);

    for (const record of records) {
      assertNonEmptyVector(record.vector, this.logger);
      await this.client.$executeRawUnsafe(
        `UPDATE "${this.table}" SET "${this.column}" = $1::vector WHERE "id" = $2`,
        this.toVectorLiteral(record.vector),
        record.id
      );
    }
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.client.$executeRawUnsafe(
      `UPDATE "${this.table}" SET "${this.column}" = NULL WHERE "id" = ANY($1::text[])`,
      ids
    );
  }

  async search(
    vector: number[],
    filter: VectorSearchFilter,
    limit = 10
  ): Promise<VectorSearchResult[]> {
    assertNonEmptyVector(vector, this.logger);
    if (!filter.userId) {
      throw new Error('search filter must include a userId for tenant isolation');
    }
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;

    if (this.hnswEfSearch !== undefined) {
      // Query-time recall/latency tuning. Applied per search; see PgVectorOptions
      // for the connection-pooling caveat. The value is a validated integer.
      await this.client.$executeRawUnsafe(`SET hnsw.ef_search = ${this.hnswEfSearch}`);
    }

    const params: unknown[] = [this.toVectorLiteral(vector)];
    const clauses: string[] = [`"${this.column}" IS NOT NULL`];

    params.push(filter.userId);
    clauses.push(`"userId" = $${params.length}`);

    if (filter.organizationId !== undefined) {
      if (!filter.organizationId) {
        throw new Error('organizationId must not be empty when provided');
      }
      params.push(filter.organizationId);
      clauses.push(`"organizationId" = $${params.length}`);
    }

    if (filter.type) {
      params.push(filter.type);
      clauses.push(`"type" = $${params.length}`);
    }
    if (filter.scope) {
      params.push(filter.scope);
      clauses.push(`"scope" = $${params.length}`);
    }
    if (filter.tags && filter.tags.length > 0) {
      params.push(filter.tags);
      clauses.push(`"tags" @> $${params.length}::text[]`);
    }
    if (filter.createdFrom) {
      params.push(filter.createdFrom);
      clauses.push(`"createdAt" >= $${params.length}`);
    }
    if (filter.createdTo) {
      params.push(filter.createdTo);
      clauses.push(`"createdAt" <= $${params.length}`);
    }

    const sql =
      `SELECT "id", "userId", "organizationId", "type", "tags", "scope", "createdAt", ` +
      `1 - ("${this.column}" <=> $1::vector) AS score ` +
      `FROM "${this.table}" WHERE ${clauses.join(' AND ')} ` +
      `ORDER BY "${this.column}" <=> $1::vector LIMIT ${safeLimit}`;

    const rows = await this.client.$queryRawUnsafe<PgVectorSearchRow[]>(sql, ...params);
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * Lightweight readiness probe for health checks. Verifies the pgvector
   * extension is installed and the embedding column exists. Returns a structured
   * status rather than throwing so callers can shape their own health response.
   */
  async healthCheck(): Promise<{ ok: boolean; extension: boolean; column: boolean }> {
    const extensionRows = await this.client.$queryRawUnsafe<Array<{ installed: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS installed`
    );
    const columnRows = await this.client.$queryRawUnsafe<Array<{ present: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns ` +
        `WHERE table_name = $1 AND column_name = $2) AS present`,
      this.table,
      this.column
    );
    const extension = extensionRows[0]?.installed === true;
    const column = columnRows[0]?.present === true;
    return { ok: extension && column, extension, column };
  }

  private mapRow(row: PgVectorSearchRow): VectorSearchResult {
    const payload: VectorPayload = {
      userId: row.userId,
      tags: row.tags ?? [],
    };
    if (row.organizationId) {
      payload.organizationId = row.organizationId;
    }
    if (row.type) {
      payload.type = row.type;
    }
    if (row.scope) {
      payload.scope = row.scope;
    }
    if (row.createdAt) {
      payload.createdAt = new Date(row.createdAt).getTime();
    }
    return {
      id: row.id,
      score: typeof row.score === 'string' ? Number.parseFloat(row.score) : row.score,
      payload,
    };
  }

  private toVectorLiteral(vector: number[]): string {
    for (const value of vector) {
      if (!Number.isFinite(value)) {
        throw new Error('Vector values must be finite numbers');
      }
    }
    return `[${vector.join(',')}]`;
  }
}
