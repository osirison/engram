import { z } from 'zod';
import { DeploymentProfile, coerceDeploymentProfile } from './profile';

/**
 * Boolean flag parsed from an environment string. `z.coerce.boolean()` is
 * unusable here — it treats the string `'false'` as truthy — so we map the
 * common truthy spellings explicitly and default everything else to `false`.
 */
const booleanFlag = (defaultValue: boolean): z.ZodType<boolean> =>
  z
    .preprocess(
      (value) =>
        typeof value === 'string'
          ? ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase())
          : value,
      z.boolean()
    )
    .default(defaultValue) as z.ZodType<boolean>;

/**
 * Environment validation schema for ENGRAM.
 *
 * URL requirements are conditional on the active deployment profile so that
 * profile-memory can boot with zero external services while profile-enterprise
 * still enforces the full set of dependencies. Profile is resolved once via
 * {@link coerceDeploymentProfile} and the conditional rules are applied
 * inside a single transform pass instead of duplicating per-profile schemas.
 */
/**
 * Unwrapped, introspectable env object schema. `envSchema` below wraps this in
 * a profile-aware `.transform()` (producing a `ZodEffects`, not a `ZodObject`),
 * so tooling that needs to enumerate the fields — e.g. the configuration
 * reference generator (`scripts/gen-env-table.mjs`) — must read `baseSchema`.
 */
export const baseSchema = z.object({
  /** Runtime environment. Controls dev-only behaviours and log verbosity. */
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** TCP port the MCP/HTTP server listens on. */
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
  /** Required only when `EMBEDDING_PROVIDER=openai`; when absent, OpenAI embedding generation is silently disabled. */
  OPENAI_API_KEY: z.string().optional(),
  /** Embedding provider selection. Defaults to `ollama` (local-first, no API key). `openai` requires OPENAI_API_KEY; `local` is a deterministic hash for testing. */
  EMBEDDING_PROVIDER: z
    .enum(['ollama', 'openai', 'disabled', 'local'])
    .optional()
    .default('ollama'),
  /** Embedding model id. Defaults per provider: ollama→`nomic-embed-text` (768 dims), openai→`text-embedding-3-small` (1536 dims). Changing it requires a full reindex with recreate+regenerate. */
  EMBEDDING_MODEL: z.string().min(1).optional(),
  /** Base URL of the Ollama server used when `EMBEDDING_PROVIDER=ollama`. Defaults to `http://localhost:11434`. */
  OLLAMA_URL: z.string().url().optional(),
  /** Vector backend selection. Both `qdrant` and `pgvector` are implemented. */
  VECTOR_BACKEND: z.enum(['qdrant', 'pgvector']).default('qdrant'),
  /** Optional override for the vector collection/table name. */
  VECTOR_COLLECTION: z.string().min(1).optional(),
  /** Optional strict pin for embedding dimensionality. When unset, dimensions are inferred from the model (if known) or from the first generated vector. */
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
  /**
   * How often the long-term decay/staleness job scans the corpus, in
   * milliseconds. Defaults to 24h. Set to 0 to disable the scheduler.
   */
  MEMORY_DECAY_INTERVAL_MS: z.coerce.number().int().min(0).optional().default(86_400_000),
  /** Rows scanned per decay batch (cursor-resumable). Defaults to 100. */
  MEMORY_DECAY_BATCH_SIZE: z.coerce.number().int().positive().optional().default(100),
  /** Importance score at/below which a memory is marked `stale`. Defaults to 0.3. */
  MEMORY_DECAY_STALE_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).optional().default(0.3),
  /** Importance score below which an old, unpinned memory is pruned. Defaults to 0.15. */
  MEMORY_DECAY_PRUNE_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).optional().default(0.15),
  /** Minimum age in days before a low-importance memory becomes prune-eligible. Defaults to 30. */
  MEMORY_DECAY_PRUNE_OLDER_THAN_DAYS: z.coerce.number().min(0).optional().default(30),
  /** Cosine similarity at/above which a new write collapses into an existing row. Defaults to 0.97. */
  MEMORY_DUPLICATE_THRESHOLD: z.coerce.number().min(0).max(1).optional().default(0.97),
  /** Lower bound (inclusive) of the corpus-consolidation near-duplicate merge band `[merge, duplicate)`. Must stay strictly below `MEMORY_DUPLICATE_THRESHOLD` (enforced at boot). Defaults to 0.85. */
  MEMORY_CONSOLIDATION_MERGE_THRESHOLD: z.coerce.number().min(0).max(1).optional().default(0.85),
  /** How often the corpus-consolidation job (near-duplicate clustering, `consolidate_corpus`) runs, in milliseconds. Defaults to 0 = DISABLED — a scheduled pass merges without review, so the operator must opt in explicitly after inspecting a dry run. */
  MEMORY_CONSOLIDATION_INTERVAL_MS: z.coerce.number().int().min(0).optional().default(0),
  /** Lower bound of the contradiction similarity band. Defaults to 0.8. */
  MEMORY_CONTRADICTION_THRESHOLD: z.coerce.number().min(0).max(1).optional().default(0.8),
  /** Upper bound (exclusive) of the contradiction band, below the duplicate zone. Defaults to 0.97. */
  MEMORY_CONTRADICTION_THRESHOLD_MAX: z.coerce.number().min(0).max(1).optional().default(0.97),
  /** What happens when a new write contradicts an existing memory: `flag` keeps BOTH rows visible in recall and marks them `contradicted` for review; `supersede` hides the older row from default recall (latest-wins). Defaults to `flag` (conservative — no data is hidden without review). */
  MEMORY_CONTRADICTION_POLICY: z.enum(['supersede', 'flag']).optional().default('flag'),
  /** Half-life in days for the recency component of importance scoring. Defaults to 14. */
  MEMORY_IMPORTANCE_HALF_LIFE_DAYS: z.coerce.number().positive().optional().default(14),
  /** Absolute directory the `import_agent_memory` server-side path must resolve into (symlinks resolved). Defaults to the server process home directory when unset. */
  IMPORT_ALLOWED_ROOT: z.string().min(1).optional(),
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

  // ──────────────────────────────────────────────────────────────────────────
  // Authentication & multi-tenancy (Epic E4)
  // ──────────────────────────────────────────────────────────────────────────
  /**
   * HMAC secret for issuing/verifying session JWTs. Required (≥32 chars) when
   * `AUTH_REQUIRED=true`; otherwise optional. Never logged.
   */
  JWT_SECRET: z.string().optional(),
  /** JWT lifetime as a duration string (`7d`, `24h`, `30m`, `3600s`) or seconds. */
  JWT_EXPIRES_IN: z.string().default('7d'),
  /**
   * When true, `/mcp` tool calls must present a valid JWT or API key, and the
   * acting `userId` is derived from that credential — the `userId` in tool input
   * is ignored. Default false preserves the trusted-caller behaviour. Only
   * enforced over the streamable-http transport.
   */
  AUTH_REQUIRED: booleanFlag(false),
  /** Explicit operator acknowledgement to run a multi-tenant streamable-http server WITHOUT auth (trusted-network posture). Without it such a server refuses to boot in every NODE_ENV. */
  ALLOW_UNAUTHENTICATED_HTTP: booleanFlag(false),
  /** Base URL used to build OAuth callback URLs, e.g. `https://api.example.com`. */
  OAUTH_REDIRECT_BASE_URL: z.string().url().optional(),
  /** GitHub OAuth app credentials. Both must be set to enable GitHub login. */
  GITHUB_CLIENT_ID: z.string().optional(),
  /** GitHub OAuth client secret (pairs with `GITHUB_CLIENT_ID`). Never logged. */
  GITHUB_CLIENT_SECRET: z.string().optional(),
  /** Google OAuth app credentials. Both must be set to enable Google login. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  /** Google OAuth client secret (pairs with `GOOGLE_CLIENT_ID`). Never logged. */
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // ──────────────────────────────────────────────────────────────────────────
  // Rate limiting (Epic E4 / #132)
  // ──────────────────────────────────────────────────────────────────────────
  /** Master switch for the Redis-backed rate limiter (enterprise only). */
  RATE_LIMIT_ENABLED: booleanFlag(false),
  /** Fixed-window length in seconds. Default 60 → the `*_RPM` limits are per minute. */
  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().min(1).default(60),
  /** Max requests per window for an authenticated user. */
  RATE_LIMIT_USER_RPM: z.coerce.number().int().min(1).default(120),
  /** Max requests per window aggregated across an organization. */
  RATE_LIMIT_ORG_RPM: z.coerce.number().int().min(1).default(6000),
  /** Max requests per window for an unauthenticated client IP. */
  RATE_LIMIT_IP_RPM: z.coerce.number().int().min(1).default(60),
  /**
   * Optional JSON map of per-tool overrides, e.g.
   * `{"reindex_memories":{"limit":2,"windowSeconds":3600}}`. Parsed by the app.
   */
  RATE_LIMIT_TOOL_OVERRIDES: z.string().optional(),
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

  // Fail fast on a malformed RATE_LIMIT_TOOL_OVERRIDES rather than silently
  // dropping all per-tool limits at runtime.
  if (
    typeof value.RATE_LIMIT_TOOL_OVERRIDES === 'string' &&
    value.RATE_LIMIT_TOOL_OVERRIDES.trim().length > 0
  ) {
    if (!isValidToolOverrides(value.RATE_LIMIT_TOOL_OVERRIDES)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RATE_LIMIT_TOOL_OVERRIDES'],
        message:
          'RATE_LIMIT_TOOL_OVERRIDES must be a JSON object mapping tool name to { "limit": positive int, "windowSeconds": positive int }',
      });
      return z.NEVER;
    }
  }

  // A relative import root would silently depend on the process CWD, making
  // the import path allowlist (A18) unpredictable — reject it at boot.
  if (
    typeof value.IMPORT_ALLOWED_ROOT === 'string' &&
    !isAbsolutePathLike(value.IMPORT_ALLOWED_ROOT)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['IMPORT_ALLOWED_ROOT'],
      message: 'IMPORT_ALLOWED_ROOT must be an absolute filesystem path',
    });
    return z.NEVER;
  }

  // The consolidation merge band is [merge, duplicate): an empty or inverted
  // band would either do nothing or swallow the exact-duplicate zone, so an
  // out-of-order pair is a misconfiguration — reject it at boot (G3-T2).
  if (value.MEMORY_CONSOLIDATION_MERGE_THRESHOLD >= value.MEMORY_DUPLICATE_THRESHOLD) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MEMORY_CONSOLIDATION_MERGE_THRESHOLD'],
      message: `MEMORY_CONSOLIDATION_MERGE_THRESHOLD (${value.MEMORY_CONSOLIDATION_MERGE_THRESHOLD}) must be strictly below MEMORY_DUPLICATE_THRESHOLD (${value.MEMORY_DUPLICATE_THRESHOLD})`,
    });
    return z.NEVER;
  }

  // When auth enforcement is on, a real JWT secret is mandatory.
  if (value.AUTH_REQUIRED) {
    if (typeof value.JWT_SECRET !== 'string' || value.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET must be set and at least 32 characters when AUTH_REQUIRED=true',
      });
      return z.NEVER;
    }
  }

  return {
    ...value,
    DEPLOYMENT_PROFILE: profile,
  } as Env;
});

function isValidToolOverrides(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return false;
  }
  return Object.values(parsed).every((rule) => {
    if (typeof rule !== 'object' || rule === null) return false;
    const { limit, windowSeconds } = rule as {
      limit?: unknown;
      windowSeconds?: unknown;
    };
    return (
      Number.isInteger(limit) &&
      (limit as number) > 0 &&
      Number.isInteger(windowSeconds) &&
      (windowSeconds as number) > 0
    );
  });
}

function isAbsolutePathLike(value: string): boolean {
  // POSIX absolute (`/…`), Windows drive (`C:\…` / `C:/…`), or UNC (`\\…`).
  // A regex keeps this package free of `node:path` (no `@types/node` here).
  return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(value);
}

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
  EMBEDDING_PROVIDER: 'ollama' | 'openai' | 'disabled' | 'local';
  EMBEDDING_MODEL?: string;
  OLLAMA_URL?: string;
  VECTOR_BACKEND: 'qdrant' | 'pgvector';
  VECTOR_COLLECTION?: string;
  VECTOR_DIMENSIONS?: number;
  MCP_TRANSPORT: 'stdio' | 'streamable-http';
  STM_CONSOLIDATION_ACCESS_THRESHOLD: number;
  STM_CONSOLIDATION_INTERVAL_MS: number;
  MEMORY_DECAY_INTERVAL_MS: number;
  MEMORY_DECAY_BATCH_SIZE: number;
  MEMORY_DECAY_STALE_SCORE_THRESHOLD: number;
  MEMORY_DECAY_PRUNE_SCORE_THRESHOLD: number;
  MEMORY_DECAY_PRUNE_OLDER_THAN_DAYS: number;
  MEMORY_DUPLICATE_THRESHOLD: number;
  MEMORY_CONSOLIDATION_MERGE_THRESHOLD: number;
  MEMORY_CONSOLIDATION_INTERVAL_MS: number;
  MEMORY_CONTRADICTION_THRESHOLD: number;
  MEMORY_CONTRADICTION_THRESHOLD_MAX: number;
  MEMORY_CONTRADICTION_POLICY: 'supersede' | 'flag';
  MEMORY_IMPORTANCE_HALF_LIFE_DAYS: number;
  IMPORT_ALLOWED_ROOT?: string;
  PGVECTOR_HNSW_M?: number;
  PGVECTOR_HNSW_EF_CONSTRUCTION?: number;
  PGVECTOR_HNSW_EF_SEARCH?: number;
  JWT_SECRET?: string;
  JWT_EXPIRES_IN: string;
  AUTH_REQUIRED: boolean;
  ALLOW_UNAUTHENTICATED_HTTP: boolean;
  OAUTH_REDIRECT_BASE_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RATE_LIMIT_ENABLED: boolean;
  RATE_LIMIT_WINDOW_SEC: number;
  RATE_LIMIT_USER_RPM: number;
  RATE_LIMIT_ORG_RPM: number;
  RATE_LIMIT_IP_RPM: number;
  RATE_LIMIT_TOOL_OVERRIDES?: string;
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
