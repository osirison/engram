-- embedding_vec is a derived vector-index column; its dimensionality now
-- follows the configured embedding model and is provisioned at runtime by
-- PgVectorStore.ensureReady (first vector write). Dropping it here is safe:
-- "embedding" (Float[]) remains the source of truth and the column is rebuilt
-- by a reindex, which reuses stored embeddings without further API calls.
DROP INDEX IF EXISTS "memories_embedding_vec_hnsw";
ALTER TABLE "memories" DROP COLUMN IF EXISTS "embedding_vec";
