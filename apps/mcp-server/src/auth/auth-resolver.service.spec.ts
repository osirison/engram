import {
  JwtRevocationService,
  JwtService,
  type JwtDenylistStore,
} from '@engram/auth';
import { AuthResolver } from './auth-resolver.service';
import type { ApiKeysService } from '../api-keys/api-keys.service';

const SECRET = 'unit-test-secret-at-least-32-characters-long';

/** In-memory jti denylist store. */
class FakeDenylistStore implements JwtDenylistStore {
  public map = new Map<string, string>();
  set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.map.get(key) ?? null);
  }
}

type VerifyResult = Awaited<ReturnType<ApiKeysService['verifyApiKey']>>;

function makeApiKeys(
  verify: (raw: string) => Promise<VerifyResult> | VerifyResult,
): ApiKeysService {
  return { verifyApiKey: jest.fn(verify) } as unknown as ApiKeysService;
}

const sampleKey = (
  over: Partial<NonNullable<VerifyResult>> = {},
): NonNullable<VerifyResult> => ({
  id: 'k1',
  name: 'k',
  prefix: 'eng_abcd',
  userId: 'user-1',
  organizationId: 'org-1',
  scopes: ['memories:read'],
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe('AuthResolver', () => {
  const jwt = new JwtService({ secret: SECRET });

  it('returns anonymous when no credentials are presented', async () => {
    const resolver = new AuthResolver(
      makeApiKeys(() => null),
      jwt,
    );
    expect(await resolver.authenticate({})).toEqual({ status: 'anonymous' });
  });

  it('authenticates via X-API-Key', async () => {
    const resolver = new AuthResolver(
      makeApiKeys(() => sampleKey()),
      jwt,
    );
    const outcome = await resolver.authenticate({ 'x-api-key': 'eng_abcdef' });
    expect(outcome).toMatchObject({
      status: 'authenticated',
      identity: {
        userId: 'user-1',
        organizationId: 'org-1',
        scopes: ['memories:read'],
        method: 'api-key',
        apiKeyId: 'k1',
      },
    });
  });

  it('authenticates an eng_ key supplied as a Bearer token', async () => {
    const apiKeys = makeApiKeys(() => sampleKey());
    const resolver = new AuthResolver(apiKeys, jwt);
    const outcome = await resolver.authenticate({
      authorization: 'Bearer eng_abcdef123',
    });
    expect(outcome.status).toBe('authenticated');
    expect(apiKeys.verifyApiKey).toHaveBeenCalledWith('eng_abcdef123');
  });

  it('authenticates a JWT bearer token', async () => {
    const token = jwt.issue({ userId: 'user-2', scopes: ['memories:write'] });
    const resolver = new AuthResolver(
      makeApiKeys(() => null),
      jwt,
    );
    const outcome = await resolver.authenticate({
      authorization: `Bearer ${token}`,
    });
    expect(outcome).toMatchObject({
      status: 'authenticated',
      identity: { userId: 'user-2', method: 'jwt' },
    });
  });

  it('reports invalid (never anonymous) for a bad API key', async () => {
    const resolver = new AuthResolver(
      makeApiKeys(() => null),
      jwt,
    );
    const outcome = await resolver.authenticate({ 'x-api-key': 'eng_bad' });
    expect(outcome.status).toBe('invalid');
  });

  it('reports invalid for a malformed JWT', async () => {
    const resolver = new AuthResolver(
      makeApiKeys(() => null),
      jwt,
    );
    const outcome = await resolver.authenticate({
      authorization: 'Bearer not.a.jwt',
    });
    expect(outcome.status).toBe('invalid');
  });

  it('reports invalid for a JWT when JWT auth is not configured', async () => {
    const resolver = new AuthResolver(
      makeApiKeys(() => null),
      undefined,
    );
    const outcome = await resolver.authenticate({
      authorization: 'Bearer something',
    });
    expect(outcome).toEqual({
      status: 'invalid',
      reason: 'JWT auth is not configured',
    });
  });

  it('reports invalid when API key verification throws', async () => {
    const resolver = new AuthResolver(
      makeApiKeys(() => {
        throw new Error('db down');
      }),
      jwt,
    );
    const outcome = await resolver.authenticate({ 'x-api-key': 'eng_x' });
    expect(outcome.status).toBe('invalid');
  });

  describe('jti denylist (revocation)', () => {
    it('rejects a revoked (logged-out) JWT', async () => {
      const revocation = new JwtRevocationService(new FakeDenylistStore());
      const resolver = new AuthResolver(
        makeApiKeys(() => null),
        jwt,
        revocation,
      );
      const { token, claims } = jwt.issueWithClaims({ userId: 'user-2' });

      // Valid before revocation…
      const before = await resolver.authenticate({
        authorization: `Bearer ${token}`,
      });
      expect(before.status).toBe('authenticated');

      // …rejected after.
      await revocation.revoke(claims);
      const after = await resolver.authenticate({
        authorization: `Bearer ${token}`,
      });
      expect(after).toEqual({
        status: 'invalid',
        reason: 'Token has been revoked',
      });
    });

    it('fails closed when the denylist store errors', async () => {
      const revocation = new JwtRevocationService({
        set: () => Promise.reject(new Error('redis down')),
        get: () => Promise.reject(new Error('redis down')),
      });
      const resolver = new AuthResolver(
        makeApiKeys(() => null),
        jwt,
        revocation,
      );
      const outcome = await resolver.authenticate({
        authorization: `Bearer ${jwt.issue({ userId: 'user-2' })}`,
      });
      expect(outcome).toEqual({
        status: 'invalid',
        reason: 'Token revocation check failed',
      });
    });

    it('still authenticates without a revocation service (lite profile)', async () => {
      const resolver = new AuthResolver(
        makeApiKeys(() => null),
        jwt,
        undefined,
      );
      const outcome = await resolver.authenticate({
        authorization: `Bearer ${jwt.issue({ userId: 'user-2' })}`,
      });
      expect(outcome.status).toBe('authenticated');
    });

    it('does not consult the denylist for API keys', async () => {
      const store = new FakeDenylistStore();
      const getSpy = jest.spyOn(store, 'get');
      const revocation = new JwtRevocationService(store);
      const resolver = new AuthResolver(
        makeApiKeys(() => sampleKey()),
        jwt,
        revocation,
      );
      const outcome = await resolver.authenticate({
        'x-api-key': 'eng_abcdef',
      });
      expect(outcome.status).toBe('authenticated');
      expect(getSpy).not.toHaveBeenCalled();
    });
  });
});
