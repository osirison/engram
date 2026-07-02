/**
 * Deployment profile taxonomy for ENGRAM.
 *
 * The profile ladder controls which runtime dependencies the server expects
 * on startup and which adapters are wired into the application graph. Each
 * profile is a contract, not a fallback — capabilities must be known before
 * modules are imported so the dependency graph stays consistent.
 */

export enum DeploymentProfile {
  /** In-process, zero-dependency onboarding. No Postgres, Redis, or Qdrant. */
  MEMORY = 'memory',
  /** Secure local durability. Requires Postgres (or local store) but no Redis/Qdrant. */
  LITE = 'lite',
  /** Production-scale. Requires Postgres, Redis, and Qdrant. */
  ENTERPRISE = 'enterprise',
}

/**
 * Capabilities exposed by a deployment profile.
 *
 * Modules and health indicators read these flags instead of inspecting the
 * raw enum so the contract stays stable as new profiles are introduced.
 */
export interface ProfileCapabilities {
  /** Profile identifier. */
  readonly profile: DeploymentProfile;
  /** True when a SQL datastore (Prisma) is part of the active graph. */
  readonly requiresDatabase: boolean;
  /** True when Redis is part of the active graph. */
  readonly requiresRedis: boolean;
  /** True when Qdrant (or any vector store) is part of the active graph. */
  readonly requiresQdrant: boolean;
  /** True when in-process adapters must be used instead of remote services. */
  readonly inProcessAdapters: boolean;
  /** True when local persistence is expected (anything other than memory-only). */
  readonly persistent: boolean;
}

/**
 * Resolve the capability set for a given profile.
 *
 * Throws when the input is not a recognised profile so misconfiguration fails
 * loudly at startup rather than silently degrading retrieval.
 */
export function resolveCapabilities(profile: DeploymentProfile): ProfileCapabilities {
  switch (profile) {
    case DeploymentProfile.MEMORY:
      return {
        profile,
        requiresDatabase: false,
        requiresRedis: false,
        requiresQdrant: false,
        inProcessAdapters: true,
        persistent: false,
      };
    case DeploymentProfile.LITE:
      return {
        profile,
        requiresDatabase: true,
        requiresRedis: false,
        requiresQdrant: false,
        inProcessAdapters: false,
        persistent: true,
      };
    case DeploymentProfile.ENTERPRISE:
      return {
        profile,
        requiresDatabase: true,
        requiresRedis: true,
        requiresQdrant: true,
        inProcessAdapters: false,
        persistent: true,
      };
    default: {
      // Exhaustiveness guard for future profiles.
      const exhaustive: never = profile;
      throw new Error(`Unknown deployment profile: ${String(exhaustive)}`);
    }
  }
}

/**
 * Coerce a raw environment value into a {@link DeploymentProfile}.
 *
 * Returns the provided default (or {@link DeploymentProfile.ENTERPRISE}) when
 * the input is missing; throws when the input is present but invalid.
 */
export function coerceDeploymentProfile(
  raw: unknown,
  fallback: DeploymentProfile = DeploymentProfile.ENTERPRISE
): DeploymentProfile {
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  if (typeof raw !== 'string') {
    throw new Error(`DEPLOYMENT_PROFILE must be a string; received ${typeof raw}`);
  }

  const value = raw.toLowerCase();
  if (
    value === DeploymentProfile.MEMORY ||
    value === DeploymentProfile.LITE ||
    value === DeploymentProfile.ENTERPRISE
  ) {
    return value as DeploymentProfile;
  }

  throw new Error(`DEPLOYMENT_PROFILE must be one of memory|lite|enterprise; received '${raw}'`);
}

/**
 * The vector backend value used when `VECTOR_BACKEND` is unset.
 *
 * Mirrors the default in `env.schema` so callers that read `process.env`
 * directly resolve the same backend the validated config would.
 */
export const DEFAULT_VECTOR_BACKEND = 'qdrant';

/**
 * Decide whether the pgvector backend is active for a given profile.
 *
 * pgvector stores embeddings inside Postgres, so it is reachable in any
 * profile that provisions a database (LITE and ENTERPRISE) whenever
 * `VECTOR_BACKEND=pgvector` — independent of whether the profile also runs a
 * remote Qdrant service.
 *
 * This predicate exists so the pgvector health wiring no longer piggybacks on
 * `requiresQdrant` (which is precisely the *no-pgvector* backend). The choice
 * between Qdrant and pgvector is environment-driven (`VECTOR_BACKEND`), not a
 * property of the profile, so it lives here rather than as a profile flag.
 */
export function usesPgVector(
  capabilities: ProfileCapabilities,
  backend: string | null | undefined
): boolean {
  const normalized = (backend ?? DEFAULT_VECTOR_BACKEND).toLowerCase();
  return capabilities.requiresDatabase && normalized === 'pgvector';
}

/**
 * Decide whether the Qdrant backend is active for a given profile.
 *
 * Mirrors {@link usesPgVector}: Qdrant is probed only on profiles that deploy
 * the Qdrant service (`requiresQdrant`) *and* when `VECTOR_BACKEND` actually
 * selects it. A Qdrant-bearing profile (ENTERPRISE) that runs with
 * `VECTOR_BACKEND=pgvector` should not require a healthy Qdrant to be ready —
 * the active vector store is pgvector.
 *
 * This exists so the Qdrant health wiring no longer conflates "this profile
 * deploys the Qdrant service" with "Qdrant is the active vector backend".
 */
export function usesQdrant(
  capabilities: ProfileCapabilities,
  backend: string | null | undefined
): boolean {
  const normalized = (backend ?? DEFAULT_VECTOR_BACKEND).toLowerCase();
  return capabilities.requiresQdrant && normalized === 'qdrant';
}
