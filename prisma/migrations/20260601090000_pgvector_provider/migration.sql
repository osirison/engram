-- Enable the pgvector extension for native vector storage and cosine kNN search.
CREATE EXTENSION IF NOT EXISTS vector;

-- Dedicated vector column on memories (1536 dims for text-embedding-3-small).
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "embedding_vec" vector(1536);

-- Approximate-nearest-neighbour index using cosine distance.
CREATE INDEX IF NOT EXISTS "memories_embedding_vec_hnsw"
  ON "memories" USING hnsw ("embedding_vec" vector_cosine_ops);
