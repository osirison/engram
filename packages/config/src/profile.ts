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
  /**
   * True when the profile serves multiple tenants (the auth/organization stack
   * is wired). Single-user profiles (memory, lite) are false, so an
   * unauthenticated deployment there does not expose cross-tenant data.
   */
  readonly multiTenant: boolean;
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
        multiTenant: false,
      };
    case DeploymentProfile.LITE:
      return {
        profile,
        requiresDatabase: true,
        requiresRedis: false,
        requiresQdrant: false,
        inProcessAdapters: false,
        persistent: true,
        multiTenant: false,
      };
    case DeploymentProfile.ENTERPRISE:
      return {
        profile,
        requiresDatabase: true,
        requiresRedis: true,
        requiresQdrant: true,
        inProcessAdapters: false,
        persistent: true,
        multiTenant: true,
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
 * Decide whether the pgvector store is active for a given profile.
 *
 * pgvector is the only vector backend: it stores embeddings inside Postgres,
 * so it is active in every profile that provisions a database (LITE and
 * ENTERPRISE).
 */
export function usesPgVector(capabilities: ProfileCapabilities): boolean {
  return capabilities.requiresDatabase;
}
