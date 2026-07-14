import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { QdrantService } from './qdrant.service';
import {
  assertNonEmptyVector,
  type VectorBackend,
  type VectorRecord,
  type VectorSearchFilter,
  type VectorSearchResult,
  type VectorStore,
} from './vector-store.interface';

/**
 * Default Qdrant collection used for memory embeddings. Overridable via
 * `VECTOR_COLLECTION`.
 */
export const DEFAULT_VECTOR_COLLECTION = 'engram_memories';

/**
 * Fixed namespace for deriving Qdrant point ids from memory ids via RFC 4122
 * name-based (v5) UUIDs. This value MUST NEVER change: it deterministically
 * maps a memory id to a point id, so altering it re-keys every derived point
 * and orphans all previously-indexed vectors.
 */
export const ENGRAM_POINT_ID_NAMESPACE = 'a1e0f4c2-3d5b-4e6a-9c8d-7f0b1a2c3d4e';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  );
}

/** Compute an RFC 4122 v5 (SHA-1, name-based) UUID for `name` under `namespace`. */
function uuidV5(name: string, namespace: string): string {
  const bytes = createHash('sha1')
    .update(uuidToBytes(namespace))
    .update(Buffer.from(name, 'utf8'))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(bytes);
}

/**
 * Map a memory id to a valid Qdrant point id. Qdrant only accepts unsigned
 * integers or UUIDs as point ids, but memory ids are CUIDs. Ids that are
 * already a UUID (e.g. promotion-origin memories keyed by `randomUUID`) pass
 * through unchanged for backward compatibility; every other id is mapped to a
 * deterministic v5 UUID. Digit-only ids are intentionally NOT passed through:
 * Qdrant's uint point ids are JSON numbers, so forwarding a numeric *string*
 * would be rejected — and real memory ids are never pure digits (CUIDs start
 * with a letter), so this costs nothing. The original memory id is preserved in
 * the point payload as `memoryId` so {@link QdrantVectorStore.search} can
 * round-trip it back to the caller.
 */
export function toQdrantPointId(id: string): string {
  return UUID_RE.test(id) ? id : uuidV5(id, ENGRAM_POINT_ID_NAMESPACE);
}

type QdrantFilter = {
  must: Array<
    | { key: string; match: { value: string } }
    | { key: string; match: { any: string[] } }
    | { key: string; range: { gte?: number; lte?: number } }
  >;
};

/**
 * Qdrant-backed {@link VectorStore} implementation.
 *
 * Wraps the lower-level {@link QdrantService} and adds collection lifecycle
 * management plus payload-based filtering for tenant-scoped search.
 */
@Injectable()
export class QdrantVectorStore implements VectorStore {
  readonly backend: VectorBackend = 'qdrant';

  private readonly logger = new Logger(QdrantVectorStore.name);
  private ensured = false;

  constructor(
    private readonly qdrant: QdrantService,
    private readonly collection: string = DEFAULT_VECTOR_COLLECTION
  ) {}

  async ensureReady(dimensions: number): Promise<void> {
    if (this.ensured) {
      return;
    }
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error('dimensions must be a positive integer');
    }

    const exists = await this.qdrant.collectionExists(this.collection);
    if (!exists) {
      await this.qdrant.createCollection(this.collection, dimensions, 'Cosine');
      this.logger.log(`Created vector collection ${this.collection} (${dimensions} dims)`);
    } else {
      // Guard against an existing collection created for a different embedding
      // model: without this check, every upsert fails point-by-point with an
      // opaque Qdrant error. Turn it into one actionable failure instead.
      const liveSize = await this.readCollectionSize();
      if (liveSize !== null && liveSize !== dimensions) {
        throw new Error(
          `Qdrant collection "${this.collection}" is ${liveSize}-dimensional but the embedding ` +
            `pipeline produced ${dimensions}-dim vectors. After changing the embedding model, ` +
            `run an unscoped full reindex with recreate+regenerate ` +
            `(CLI: pnpm --filter mcp-server reindex -- --recreate --regenerate).`
        );
      }
    }
    this.ensured = true;
  }

  /**
   * Read the vector size of the existing collection. Returns null when the
   * size cannot be determined (e.g. named-vector configurations), in which
   * case the guard is skipped rather than producing false positives.
   */
  private async readCollectionSize(): Promise<number | null> {
    try {
      const info = await this.qdrant.getClient().getCollection(this.collection);
      const vectors = (info as { config?: { params?: { vectors?: { size?: unknown } | unknown } } })
        .config?.params?.vectors;
      const size = (vectors as { size?: unknown } | undefined)?.size;
      return typeof size === 'number' ? size : null;
    } catch (error) {
      this.logger.warn(
        `Could not read collection info for dimension guard: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
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
    await this.ensureReady(first.vector.length);

    await this.qdrant.upsertPoints(
      this.collection,
      records.map((record) => ({
        // Qdrant point ids must be a uint or UUID; memory ids are CUIDs, so
        // derive a stable point id and keep the real memory id in the payload.
        id: toQdrantPointId(record.id),
        vector: record.vector,
        payload: { ...(record.payload ?? {}), memoryId: record.id },
      }))
    );
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const client = this.qdrant.getClient();
    await client.delete(this.collection, {
      wait: true,
      points: ids.map((id) => toQdrantPointId(id)),
    });
  }

  /**
   * Drop and forget the collection so a subsequent {@link upsert} rebuilds it
   * from scratch. Used by a full reindex to guarantee a clean backfill with no
   * orphaned points (e.g. legacy points keyed by a raw id). Idempotent.
   */
  async reset(): Promise<void> {
    if (await this.qdrant.collectionExists(this.collection)) {
      await this.qdrant.deleteCollection(this.collection);
      this.logger.log(`Reset vector collection ${this.collection}`);
    }
    this.ensured = false;
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

    const exists = await this.qdrant.collectionExists(this.collection);
    if (!exists) {
      return [];
    }

    const client = this.qdrant.getClient();
    const results = await client.search(this.collection, {
      vector,
      limit,
      filter: this.buildFilter(filter),
      with_payload: true,
    });

    return results.map((result) => {
      const payload = result.payload as VectorSearchResult['payload'];
      // Prefer the memory id stored in the payload; fall back to the point id
      // for legacy points written before payload.memoryId existed (those were
      // keyed by the raw memory id, so the point id IS the memory id).
      const memoryId = typeof payload?.memoryId === 'string' ? payload.memoryId : String(result.id);
      return { id: memoryId, score: result.score, payload };
    });
  }

  private buildFilter(filter: VectorSearchFilter): QdrantFilter {
    const must: QdrantFilter['must'] = [{ key: 'userId', match: { value: filter.userId } }];
    if (filter.organizationId !== undefined) {
      if (!filter.organizationId) {
        throw new Error('organizationId must not be empty when provided');
      }
      must.push({ key: 'organizationId', match: { value: filter.organizationId } });
    }
    if (filter.scope) {
      must.push({ key: 'scope', match: { value: filter.scope } });
    }
    if (filter.type) {
      must.push({ key: 'type', match: { value: filter.type } });
    }
    if (filter.tags && filter.tags.length > 0) {
      must.push({ key: 'tags', match: { any: filter.tags } });
    }
    if (filter.createdFrom || filter.createdTo) {
      const range: { gte?: number; lte?: number } = {};
      if (filter.createdFrom) {
        range.gte = filter.createdFrom.getTime();
      }
      if (filter.createdTo) {
        range.lte = filter.createdTo.getTime();
      }
      must.push({ key: 'createdAt', range });
    }
    return { must };
  }
}
