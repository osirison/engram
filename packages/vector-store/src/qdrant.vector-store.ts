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
    }
    this.ensured = true;
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
        id: record.id,
        vector: record.vector,
        payload: record.payload ? { ...record.payload } : undefined,
      }))
    );
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const client = this.qdrant.getClient();
    await client.delete(this.collection, { wait: true, points: ids });
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

    return results.map((result) => ({
      id: String(result.id),
      score: result.score,
      payload: result.payload as VectorSearchResult['payload'],
    }));
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
