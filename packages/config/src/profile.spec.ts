import { describe, expect, it } from 'vitest';
import {
  DeploymentProfile,
  resolveCapabilities,
  coerceDeploymentProfile,
  usesPgVector,
  usesQdrant,
  DEFAULT_VECTOR_BACKEND,
  type ProfileCapabilities,
} from './profile';

describe('resolveCapabilities', () => {
  it('maps MEMORY to a zero-dependency, in-process capability set', () => {
    expect(resolveCapabilities(DeploymentProfile.MEMORY)).toEqual<ProfileCapabilities>({
      profile: DeploymentProfile.MEMORY,
      requiresDatabase: false,
      requiresRedis: false,
      requiresQdrant: false,
      inProcessAdapters: true,
      persistent: false,
    });
  });

  it('maps LITE to a Postgres-only, Qdrant-free capability set', () => {
    expect(resolveCapabilities(DeploymentProfile.LITE)).toEqual<ProfileCapabilities>({
      profile: DeploymentProfile.LITE,
      requiresDatabase: true,
      requiresRedis: false,
      requiresQdrant: false,
      inProcessAdapters: false,
      persistent: true,
    });
  });

  it('maps ENTERPRISE to the full remote-service capability set', () => {
    expect(resolveCapabilities(DeploymentProfile.ENTERPRISE)).toEqual<ProfileCapabilities>({
      profile: DeploymentProfile.ENTERPRISE,
      requiresDatabase: true,
      requiresRedis: true,
      requiresQdrant: true,
      inProcessAdapters: false,
      persistent: true,
    });
  });

  it('throws on an unrecognised profile', () => {
    expect(() => resolveCapabilities('nope' as unknown as DeploymentProfile)).toThrow(
      /Unknown deployment profile/
    );
  });
});

describe('coerceDeploymentProfile', () => {
  it('falls back to ENTERPRISE when the value is absent', () => {
    expect(coerceDeploymentProfile(undefined)).toBe(DeploymentProfile.ENTERPRISE);
    expect(coerceDeploymentProfile('')).toBe(DeploymentProfile.ENTERPRISE);
  });

  it('honours an explicit fallback', () => {
    expect(coerceDeploymentProfile(undefined, DeploymentProfile.LITE)).toBe(DeploymentProfile.LITE);
  });

  it('accepts known profiles case-insensitively', () => {
    expect(coerceDeploymentProfile('LITE')).toBe(DeploymentProfile.LITE);
    expect(coerceDeploymentProfile('memory')).toBe(DeploymentProfile.MEMORY);
  });

  it('throws on an unknown profile string', () => {
    expect(() => coerceDeploymentProfile('staging')).toThrow(
      /must be one of memory\|lite\|enterprise/
    );
  });
});

describe('usesPgVector', () => {
  const memory = resolveCapabilities(DeploymentProfile.MEMORY);
  const lite = resolveCapabilities(DeploymentProfile.LITE);
  const enterprise = resolveCapabilities(DeploymentProfile.ENTERPRISE);

  it('defaults to the qdrant backend, which never selects pgvector', () => {
    expect(DEFAULT_VECTOR_BACKEND).toBe('qdrant');
    expect(usesPgVector(lite, undefined)).toBe(false);
    expect(usesPgVector(lite, null)).toBe(false);
    expect(usesPgVector(enterprise, undefined)).toBe(false);
  });

  it('is true for any DB-bearing profile when the backend is pgvector', () => {
    // LITE is the headline fix: requiresQdrant is false but pgvector lives in
    // Postgres, which LITE provisions.
    expect(usesPgVector(lite, 'pgvector')).toBe(true);
    expect(usesPgVector(enterprise, 'pgvector')).toBe(true);
  });

  it('is false when the backend is qdrant regardless of profile', () => {
    expect(usesPgVector(lite, 'qdrant')).toBe(false);
    expect(usesPgVector(enterprise, 'qdrant')).toBe(false);
  });

  it('is false for MEMORY because it has no database to host vectors', () => {
    expect(usesPgVector(memory, 'pgvector')).toBe(false);
    expect(usesPgVector(memory, 'qdrant')).toBe(false);
  });

  it('normalises backend casing', () => {
    expect(usesPgVector(lite, 'PgVector')).toBe(true);
    expect(usesPgVector(lite, 'PGVECTOR')).toBe(true);
  });
});

describe('usesQdrant', () => {
  const memory = resolveCapabilities(DeploymentProfile.MEMORY);
  const lite = resolveCapabilities(DeploymentProfile.LITE);
  const enterprise = resolveCapabilities(DeploymentProfile.ENTERPRISE);

  it('defaults to the qdrant backend, which selects Qdrant on Qdrant-bearing profiles', () => {
    expect(DEFAULT_VECTOR_BACKEND).toBe('qdrant');
    expect(usesQdrant(enterprise, undefined)).toBe(true);
    expect(usesQdrant(enterprise, null)).toBe(true);
  });

  it('is true only when a Qdrant-bearing profile also selects the qdrant backend', () => {
    expect(usesQdrant(enterprise, 'qdrant')).toBe(true);
  });

  it('is false when the backend is pgvector even on a Qdrant-bearing profile', () => {
    // The headline fix: ENTERPRISE deploys Qdrant, but with
    // VECTOR_BACKEND=pgvector the active vector store is pgvector, so Qdrant
    // must not gate readiness.
    expect(usesQdrant(enterprise, 'pgvector')).toBe(false);
  });

  it('is false for profiles that do not deploy Qdrant regardless of backend', () => {
    expect(usesQdrant(lite, 'qdrant')).toBe(false);
    expect(usesQdrant(lite, 'pgvector')).toBe(false);
    expect(usesQdrant(lite, undefined)).toBe(false);
    expect(usesQdrant(memory, 'qdrant')).toBe(false);
    expect(usesQdrant(memory, undefined)).toBe(false);
  });

  it('normalises backend casing', () => {
    expect(usesQdrant(enterprise, 'Qdrant')).toBe(true);
    expect(usesQdrant(enterprise, 'QDRANT')).toBe(true);
  });

  it('is mutually exclusive with usesPgVector for any backend value', () => {
    for (const caps of [memory, lite, enterprise]) {
      for (const backend of [undefined, null, 'qdrant', 'pgvector', 'PGVECTOR']) {
        expect(usesQdrant(caps, backend) && usesPgVector(caps, backend)).toBe(false);
      }
    }
  });
});
