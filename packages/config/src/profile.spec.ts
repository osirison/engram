import { describe, it, expect } from 'vitest';
import {
  DeploymentProfile,
  coerceDeploymentProfile,
  resolveCapabilities,
  usesPgVector,
} from './profile';

describe('resolveCapabilities', () => {
  it('maps LITE to a single-user, Postgres-backed capability set', () => {
    expect(resolveCapabilities(DeploymentProfile.LITE)).toEqual({
      profile: DeploymentProfile.LITE,
      requiresDatabase: true,
      persistent: true,
      multiTenant: false,
    });
  });

  it('maps STANDARD to the multi-tenant, Postgres-backed capability set', () => {
    expect(resolveCapabilities(DeploymentProfile.STANDARD)).toEqual({
      profile: DeploymentProfile.STANDARD,
      requiresDatabase: true,
      persistent: true,
      multiTenant: true,
    });
  });

  it('throws on an unknown profile', () => {
    expect(() => resolveCapabilities('cluster' as DeploymentProfile)).toThrow(
      /Unknown deployment profile/
    );
  });
});

describe('coerceDeploymentProfile', () => {
  it('defaults to STANDARD when unset', () => {
    expect(coerceDeploymentProfile(undefined)).toBe(DeploymentProfile.STANDARD);
    expect(coerceDeploymentProfile(null)).toBe(DeploymentProfile.STANDARD);
    expect(coerceDeploymentProfile('')).toBe(DeploymentProfile.STANDARD);
  });

  it('accepts both profiles case-insensitively', () => {
    expect(coerceDeploymentProfile('lite')).toBe(DeploymentProfile.LITE);
    expect(coerceDeploymentProfile('LITE')).toBe(DeploymentProfile.LITE);
    expect(coerceDeploymentProfile('standard')).toBe(DeploymentProfile.STANDARD);
    expect(coerceDeploymentProfile('Standard')).toBe(DeploymentProfile.STANDARD);
  });

  it('maps the legacy enterprise alias to STANDARD', () => {
    expect(coerceDeploymentProfile('enterprise')).toBe(DeploymentProfile.STANDARD);
    expect(coerceDeploymentProfile('ENTERPRISE')).toBe(DeploymentProfile.STANDARD);
  });

  it('rejects the removed memory profile with guidance', () => {
    expect(() => coerceDeploymentProfile('memory')).toThrow(/was removed/);
  });

  it('rejects unknown values', () => {
    expect(() => coerceDeploymentProfile('cluster')).toThrow(/lite\|standard/);
    expect(() => coerceDeploymentProfile(42)).toThrow(/must be a string/);
  });
});

describe('usesPgVector', () => {
  it('is true for every profile (pgvector is the only backend)', () => {
    expect(usesPgVector(resolveCapabilities(DeploymentProfile.LITE))).toBe(true);
    expect(usesPgVector(resolveCapabilities(DeploymentProfile.STANDARD))).toBe(true);
  });
});
