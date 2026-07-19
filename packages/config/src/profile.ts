/**
 * Deployment profile taxonomy for ENGRAM.
 *
 * The profile ladder controls which runtime dependencies the server expects
 * on startup and which adapters are wired into the application graph. Each
 * profile is a contract, not a fallback — capabilities must be known before
 * modules are imported so the dependency graph stays consistent.
 *
 * Both profiles run on Postgres alone (pgvector included): `standard` is the
 * default, multi-tenant deployment; `lite` is the single-user local profile
 * with the auth/organization stack left unwired.
 */

export enum DeploymentProfile {
  /** Single-user local durability. Postgres only; auth/org stack not wired. */
  LITE = 'lite',
  /** Default profile. Postgres (with pgvector) + the multi-tenant auth stack. */
  STANDARD = 'standard',
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
  /** True when local persistence is expected. */
  readonly persistent: boolean;
  /**
   * True when the profile serves multiple tenants (the auth/organization stack
   * is wired). The single-user profile (lite) is false, so an unauthenticated
   * deployment there does not expose cross-tenant data.
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
    case DeploymentProfile.LITE:
      return {
        profile,
        requiresDatabase: true,
        persistent: true,
        multiTenant: false,
      };
    case DeploymentProfile.STANDARD:
      return {
        profile,
        requiresDatabase: true,
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
 * Returns the provided default (or {@link DeploymentProfile.STANDARD}) when
 * the input is missing; throws when the input is present but invalid.
 *
 * Legacy values from the three-profile ladder are handled explicitly:
 * `enterprise` maps to `standard` (same capabilities minus the retired
 * Redis/Qdrant services) so existing deployments keep booting; `memory` was
 * removed and fails with guidance.
 */
export function coerceDeploymentProfile(
  raw: unknown,
  fallback: DeploymentProfile = DeploymentProfile.STANDARD
): DeploymentProfile {
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  if (typeof raw !== 'string') {
    throw new Error(`DEPLOYMENT_PROFILE must be a string; received ${typeof raw}`);
  }

  const value = raw.toLowerCase();
  if (value === DeploymentProfile.LITE || value === DeploymentProfile.STANDARD) {
    return value as DeploymentProfile;
  }
  if (value === 'enterprise') {
    // Pre-simplification name for the default multi-tenant profile.
    return DeploymentProfile.STANDARD;
  }
  if (value === 'memory') {
    throw new Error(
      "DEPLOYMENT_PROFILE 'memory' was removed: every profile now runs on Postgres. " +
        "Use 'lite' (single-user) or 'standard' (default, multi-tenant)."
    );
  }

  throw new Error(`DEPLOYMENT_PROFILE must be one of lite|standard; received '${raw}'`);
}

/**
 * Decide whether the pgvector store is active for a given profile.
 *
 * pgvector is the only vector backend: it stores embeddings inside Postgres,
 * so it is active in every profile (both provision a database).
 */
export function usesPgVector(capabilities: ProfileCapabilities): boolean {
  return capabilities.requiresDatabase;
}
