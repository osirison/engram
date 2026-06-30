import { afterEach, describe, expect, it, vi } from 'vitest';

/** Re-import env.ts under a stubbed environment (it reads process.env at load). */
async function loadEnv(vars: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  return import('./env');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('isAllowedOperator', () => {
  it('allows anyone when the allow-list is empty outside production', async () => {
    const { isAllowedOperator } = await loadEnv({
      NODE_ENV: 'development',
      ENGRAM_ADMIN_EMAILS: '',
    });
    expect(isAllowedOperator('anyone@example.com')).toBe(true);
  });

  it('fails closed when the allow-list is empty in production', async () => {
    const { isAllowedOperator } = await loadEnv({
      NODE_ENV: 'production',
      ENGRAM_ADMIN_EMAILS: '',
    });
    expect(isAllowedOperator('anyone@example.com')).toBe(false);
  });

  it('matches the allow-list case-insensitively', async () => {
    const { isAllowedOperator } = await loadEnv({
      NODE_ENV: 'production',
      ENGRAM_ADMIN_EMAILS: 'Admin@Example.com, ops@example.com',
    });
    expect(isAllowedOperator('admin@example.com')).toBe(true);
    expect(isAllowedOperator('OPS@EXAMPLE.COM')).toBe(true);
    expect(isAllowedOperator('intruder@example.com')).toBe(false);
    expect(isAllowedOperator(null)).toBe(false);
  });
});

describe('devAuthEnabled', () => {
  it('is forced off in production even when the flag is set', async () => {
    const { serverEnv } = await loadEnv({
      NODE_ENV: 'production',
      ENGRAM_DASHBOARD_DEV_AUTH: 'true',
    });
    expect(serverEnv.devAuthEnabled).toBe(false);
  });

  it('is enabled outside production when the flag is set', async () => {
    const { serverEnv } = await loadEnv({
      NODE_ENV: 'development',
      ENGRAM_DASHBOARD_DEV_AUTH: 'true',
    });
    expect(serverEnv.devAuthEnabled).toBe(true);
  });
});
