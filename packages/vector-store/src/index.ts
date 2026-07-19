export { VectorStoreModule } from './vector-store.module';
export {
  PgVectorStore,
  PGVECTOR_TABLE,
  PGVECTOR_COLUMN,
  PGVECTOR_INDEX,
} from './pgvector.vector-store';
export type { PgVectorClient } from './pgvector.vector-store';
export type { PgVectorOptions } from './pgvector.vector-store';
export { VECTOR_STORE_TOKEN, assertNonEmptyVector } from './vector-store.interface';
export type {
  VectorStore,
  VectorBackend,
  VectorRecord,
  VectorPayload,
  VectorSearchFilter,
  VectorSearchResult,
} from './vector-store.interface';
