import { z } from 'zod';

/**
 * Environment validation schema for ENGRAM
 * Validates all required environment variables on startup
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  QDRANT_URL: z.string().url(),
  /** Optional — when absent, embedding generation is silently disabled. */
  OPENAI_API_KEY: z.string().optional(),
  /** Optional embedding provider selection, defaults to OpenAI. */
  EMBEDDING_PROVIDER: z.enum(['openai', 'disabled', 'local']).optional().default('openai'),
  /** Vector backend selection. Both `qdrant` and `pgvector` are implemented. */
  VECTOR_BACKEND: z.enum(['qdrant', 'pgvector']).default('qdrant'),
  /** Optional override for the vector collection/table name. */
  VECTOR_COLLECTION: z.string().min(1).optional(),
  /** Optional override for embedding dimensionality (defaults to the provider's model dimension). */
  VECTOR_DIMENSIONS: z.coerce.number().int().positive().optional(),
  /** MCP transport selection: stdio for local clients, streamable-http for Inspector. */
  MCP_TRANSPORT: z.enum(['stdio', 'streamable-http']).default('stdio'),
  /** Optional pgvector HNSW build-time `m` (max connections per layer). */
  PGVECTOR_HNSW_M: z.coerce.number().int().min(2).max(100).optional(),
  /** Optional pgvector HNSW build-time `ef_construction` (candidate list size). */
  PGVECTOR_HNSW_EF_CONSTRUCTION: z.coerce.number().int().min(4).max(1000).optional(),
  /** Optional pgvector HNSW query-time `ef_search` (recall/latency tuning). */
  PGVECTOR_HNSW_EF_SEARCH: z.coerce.number().int().min(1).max(1000).optional(),
});

/**
 * Type-safe environment configuration
 */
export type Env = z.infer<typeof envSchema>;

/**
 * Validates environment variables
 * @param config - Raw environment configuration
 * @returns Validated and typed environment configuration
 * @throws ZodError if validation fails
 */
export function validateEnv(config: Record<string, unknown>): Env {
  return envSchema.parse(config);
}
