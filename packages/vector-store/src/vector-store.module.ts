import { Module } from '@nestjs/common';
import { PrismaService } from '@engram/database';
import { PgVectorStore, type PgVectorClient, type PgVectorOptions } from './pgvector.vector-store';
import { VECTOR_STORE_TOKEN, type VectorStore } from './vector-store.interface';

/**
 * Optional strict dimensionality pin from `VECTOR_DIMENSIONS`. When unset,
 * the store infers dimensions from the first upserted vector, so the
 * embedding model alone determines the index dimensionality.
 */
function resolveDimensions(): number | undefined {
  const parsed = Number.parseInt(process.env.VECTOR_DIMENSIONS ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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
 * Provides the {@link VectorStore} implementation under
 * {@link VECTOR_STORE_TOKEN}. pgvector is the only backend: vectors live in
 * the runtime-managed `embedding_vec` column on `memories`, so the vector
 * index needs no service beyond Postgres itself.
 *
 * The store infers embedding dimensionality from the first upserted vector;
 * `VECTOR_DIMENSIONS` acts as an optional strict pin. HNSW tuning via
 * `PGVECTOR_HNSW_M` / `PGVECTOR_HNSW_EF_CONSTRUCTION` / `PGVECTOR_HNSW_EF_SEARCH`.
 */
@Module({
  providers: [
    {
      provide: VECTOR_STORE_TOKEN,
      inject: [{ token: PrismaService, optional: true }],
      useFactory: (prisma?: PgVectorClient): VectorStore => {
        if (!prisma) {
          throw new Error(
            'The pgvector store requires PrismaService to be available. ' +
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
      },
    },
  ],
  exports: [VECTOR_STORE_TOKEN],
})
export class VectorStoreModule {}
