import { z } from 'zod';
import { DeploymentProfile, coerceDeploymentProfile } from './profile';

/**
 * Environment validation schema for ENGRAM.
 *
 * URL requirements are conditional on the active deployment profile so that
 * profile-memory can boot with zero external services while profile-enterprise
 * still enforces the full set of dependencies. Profile is resolved once via
 * {@link coerceDeploymentProfile} and the conditional rules are applied
 * inside a single transform pass instead of duplicating per-profile schemas.
 */
const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  /**
   * Conditional Postgres URL. Required for `lite` and `enterprise` profiles,
   * optional for `memory`. The validation rule is applied in the transform
   * below; we keep the field optional here so the same schema can parse a
   * `memory`-profile environment without forcing an empty string.
   */
  DATABASE_URL: z.string().url().optional(),
  /** Conditional Redis URL. Required only for `enterprise`. */
  REDIS_URL: z.string().url().optional(),
  /** Conditional Qdrant URL. Required only for `enterprise`. */
  QDRANT_URL: z.string().url().optional(),
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
  /**
   * Number of times an STM memory must be accessed before it qualifies for
   * automatic promotion to LTM. Defaults to 3.
   */
  STM_CONSOLIDATION_ACCESS_THRESHOLD: z.coerce.number().int().min(1).optional().default(3),
  /**
   * How often the consolidation job scans for promotion candidates, in
   * milliseconds. Defaults to 5 minutes. Set to 0 to disable the scheduler.
   */
  STM_CONSOLIDATION_INTERVAL_MS: z.coerce.number().int().min(0).optional().default(300_000),
  /** Optional pgvector HNSW build-time `m` (max connections per layer). */
  PGVECTOR_HNSW_M: z.coerce.number().int().min(2).max(100).optional(),
  /** Optional pgvector HNSW build-time `ef_construction` (candidate list size). */
  PGVECTOR_HNSW_EF_CONSTRUCTION: z.coerce.number().int().min(4).max(1000).optional(),
  /** Optional pgvector HNSW query-time `ef_search` (recall/latency tuning). */
  PGVECTOR_HNSW_EF_SEARCH: z.coerce.number().int().min(1).max(1000).optional(),
  /**
   * Deployment profile ladder:
   *   - `memory`     → in-process, zero external services.
   *   - `lite`       → requires DATABASE_URL; no Redis/Qdrant.
   *   - `enterprise` → requires DATABASE_URL, REDIS_URL, QDRANT_URL.
   *
   * Defaults to `enterprise` for backward compatibility with existing
   * production deployments.
   */
  DEPLOYMENT_PROFILE: z
    .enum(['memory', 'lite', 'enterprise'])
    .optional()
    .default(DeploymentProfile.ENTERPRISE),
});

/**
 * Profile-aware env schema. Conditional URL rules are enforced via a single
 * transform so that all dependency requirements are validated together and
 * the resulting {@link Env} type is fully typed.
 */
export const envSchema: z.ZodType<Env> = baseSchema.transform((value, ctx) => {
  const profile = coerceDeploymentProfile(value.DEPLOYMENT_PROFILE, DeploymentProfile.ENTERPRISE);

  if (profile !== DeploymentProfile.MEMORY) {
    if (typeof value.DATABASE_URL !== 'string' || value.DATABASE_URL.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: `DATABASE_URL is required when DEPLOYMENT_PROFILE='${profile}'`,
      });
      return z.NEVER;
    }
    if (!isLikelyUrl(value.DATABASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL must be a valid URL',
      });
      return z.NEVER;
    }
  } else {
    // Normalise optional URLs to undefined in profile-memory so downstream
    // modules never see stale connection strings from a previous enterprise
    // environment.
    value.DATABASE_URL = undefined;
  }

  if (profile === DeploymentProfile.ENTERPRISE) {
    if (typeof value.REDIS_URL !== 'string' || value.REDIS_URL.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: `REDIS_URL is required when DEPLOYMENT_PROFILE='${profile}'`,
      });
      return z.NEVER;
    }
    if (!isLikelyUrl(value.REDIS_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'REDIS_URL must be a valid URL',
      });
      return z.NEVER;
    }

    if (typeof value.QDRANT_URL !== 'string' || value.QDRANT_URL.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['QDRANT_URL'],
        message: `QDRANT_URL is required when DEPLOYMENT_PROFILE='${profile}'`,
      });
      return z.NEVER;
    }
    if (!isLikelyUrl(value.QDRANT_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['QDRANT_URL'],
        message: 'QDRANT_URL must be a valid URL',
      });
      return z.NEVER;
    }
  } else {
    value.REDIS_URL = undefined;
    value.QDRANT_URL = undefined;
  }

  return {
    ...value,
    DEPLOYMENT_PROFILE: profile,
  } as Env;
});

function isLikelyUrl(value: string): boolean {
  // Permissive URL check that matches `z.string().url()` without requiring
  // the `URL` constructor (which needs `@types/node`). We only need to
  // reject obvious malformations like bare strings without a scheme.
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

/**
 * Type-safe environment configuration
 */
export type Env = {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  DEPLOYMENT_PROFILE: DeploymentProfile;
  DATABASE_URL?: string;
  REDIS_URL?: string;
  QDRANT_URL?: string;
  OPENAI_API_KEY?: string;
  EMBEDDING_PROVIDER: 'openai' | 'disabled' | 'local';
  VECTOR_BACKEND: 'qdrant' | 'pgvector';
  VECTOR_COLLECTION?: string;
  VECTOR_DIMENSIONS?: number;
  MCP_TRANSPORT: 'stdio' | 'streamable-http';
  STM_CONSOLIDATION_ACCESS_THRESHOLD: number;
  STM_CONSOLIDATION_INTERVAL_MS: number;
  PGVECTOR_HNSW_M?: number;
  PGVECTOR_HNSW_EF_CONSTRUCTION?: number;
  PGVECTOR_HNSW_EF_SEARCH?: number;
};

/**
 * Validates environment variables
 * @param config - Raw environment configuration
 * @returns Validated and typed environment configuration
 * @throws ZodError if validation fails
 */
export function validateEnv(config: Record<string, unknown>): Env {
  return envSchema.parse(config);
}
