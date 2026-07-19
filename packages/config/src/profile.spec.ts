import { describe, expect, it } from 'vitest';
import {
  DeploymentProfile,
  resolveCapabilities,
  coerceDeploymentProfile,
  usesPgVector,
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
      multiTenant: false,
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
      multiTenant: false,
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
      multiTenant: true,
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

  it('is true for every DB-bearing profile (pgvector is the only backend)', () => {
    expect(usesPgVector(lite)).toBe(true);
    expect(usesPgVector(enterprise)).toBe(true);
  });

  it('is false for MEMORY because it has no database to host vectors', () => {
    expect(usesPgVector(memory)).toBe(false);
  });
});
