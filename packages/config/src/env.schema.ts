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
  EMBEDDING_PROVIDER: z.enum(['openai', 'disabled']).optional().default('openai'),
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
