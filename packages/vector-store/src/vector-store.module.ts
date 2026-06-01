import { Module } from '@nestjs/common';
import { PrismaService } from '@engram/database';
import { QdrantModule } from './qdrant.module';
import { QdrantService } from './qdrant.service';
import { DEFAULT_VECTOR_COLLECTION, QdrantVectorStore } from './qdrant.vector-store';
import { PgVectorStore, type PgVectorClient, type PgVectorOptions } from './pgvector.vector-store';
import { VECTOR_STORE_TOKEN, type VectorBackend, type VectorStore } from './vector-store.interface';

const DEFAULT_VECTOR_DIMENSIONS = 1536;

function resolveBackend(): VectorBackend {
  const raw = (process.env.VECTOR_BACKEND ?? 'qdrant').toLowerCase();
  return raw === 'pgvector' ? 'pgvector' : 'qdrant';
}

function resolveDimensions(): number {
  const parsed = Number.parseInt(process.env.VECTOR_DIMENSIONS ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_VECTOR_DIMENSIONS;
}

function resolvePgVectorOptions(): PgVectorOptions {
  const options: PgVectorOptions = {};
  const m = Number.parseInt(process.env.PGVECTOR_HNSW_M ?? '', 10);
  if (Number.isInteger(m)) {
    options.m = m;
  }
  const efConstruction = Number.parseInt(process.env.PGVECTOR_HNSW_EF_CONSTRUCTION ?? '', 10);
  if (Number.isInteger(efConstruction)) {
    options.efConstruction = efConstruction;
  }
  const efSearch = Number.parseInt(process.env.PGVECTOR_HNSW_EF_SEARCH ?? '', 10);
  if (Number.isInteger(efSearch)) {
    options.efSearch = efSearch;
  }
  return options;
}

/**
 * Provides the active {@link VectorStore} implementation under
 * {@link VECTOR_STORE_TOKEN}, selected from the `VECTOR_BACKEND` environment
 * variable (`qdrant` by default, `pgvector` for the Postgres-backed provider).
 *
 * The Qdrant collection name is configurable via `VECTOR_COLLECTION`; the
 * pgvector embedding dimensionality is configurable via `VECTOR_DIMENSIONS`.
 * `PrismaService` is injected optionally so Qdrant-only deployments do not
 * require a database connection from this module.
 */
@Module({
  imports: [QdrantModule],
  providers: [
    {
      provide: VECTOR_STORE_TOKEN,
      inject: [QdrantService, { token: PrismaService, optional: true }],
      useFactory: (qdrant: QdrantService, prisma?: PgVectorClient): VectorStore => {
        const backend = resolveBackend();
        if (backend === 'pgvector') {
          if (!prisma) {
            throw new Error(
              'VECTOR_BACKEND=pgvector requires PrismaService to be available. ' +
                'Ensure the database module is registered.'
            );
          }
          return new PgVectorStore(
            prisma,
            resolveDimensions(),
            undefined,
            undefined,
            resolvePgVectorOptions()
          );
        }
        const collection = process.env.VECTOR_COLLECTION ?? DEFAULT_VECTOR_COLLECTION;
        return new QdrantVectorStore(qdrant, collection);
      },
    },
  ],
  exports: [VECTOR_STORE_TOKEN],
})
export class VectorStoreModule {}
