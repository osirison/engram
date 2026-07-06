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

  it('is enabled in development when the flag is set', async () => {
    const { serverEnv } = await loadEnv({
      NODE_ENV: 'development',
      ENGRAM_DASHBOARD_DEV_AUTH: 'true',
    });
    expect(serverEnv.devAuthEnabled).toBe(true);
  });

  it.each(['test', 'staging', ''])(
    'is forced off outside development (NODE_ENV=%s) even when the flag is set',
    async (nodeEnv) => {
      const { serverEnv } = await loadEnv({
        NODE_ENV: nodeEnv,
        ENGRAM_DASHBOARD_DEV_AUTH: 'true',
      });
      expect(serverEnv.devAuthEnabled).toBe(false);
    }
  );
});

describe('parseOperatorTenants + canOperatorManageUser (WP2 T9)', () => {
  it('parses email:tenant|tenant;email:* into a lower-cased map', async () => {
    const { parseOperatorTenants } = await import('./env');
    const map = parseOperatorTenants('Alice@x.com:qp|ci-bot; bob@x.com:*');
    expect(map.get('alice@x.com')).toEqual(['qp', 'ci-bot']);
    expect(map.get('bob@x.com')).toBe('*');
  });

  it('skips malformed segments defensively', async () => {
    const { parseOperatorTenants } = await import('./env');
    const map = parseOperatorTenants(';:onlycolon;noColon;alice@x.com:;:;good@x.com:qp');
    expect(map.size).toBe(1);
    expect(map.get('good@x.com')).toEqual(['qp']);
  });

  it('allows any userId when no binding is configured (zero-config)', async () => {
    const { canOperatorManageUser } = await loadEnv({ ENGRAM_OPERATOR_TENANTS: '' });
    expect(canOperatorManageUser('anyone@x.com', 'qp')).toBe(true);
    expect(canOperatorManageUser(null, 'qp')).toBe(true);
  });

  it('binds an operator to its tenants and forbids others', async () => {
    const { canOperatorManageUser } = await loadEnv({
      ENGRAM_OPERATOR_TENANTS: 'op@x.com:qp;admin@x.com:*',
    });
    expect(canOperatorManageUser('op@x.com', 'qp')).toBe(true);
    expect(canOperatorManageUser('op@x.com', 'other')).toBe(false);
    // A '*' binding manages any tenant.
    expect(canOperatorManageUser('admin@x.com', 'other')).toBe(true);
    // An operator with bindings configured but none of their own manages nobody.
    expect(canOperatorManageUser('stranger@x.com', 'qp')).toBe(false);
  });
});
