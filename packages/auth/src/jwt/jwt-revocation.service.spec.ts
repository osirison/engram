import { describe, it, expect } from 'vitest';
import { JwtService, JwtError } from './jwt.service.js';
import { JwtRevocationService, type JwtDenylistStore } from './jwt-revocation.service.js';

const SECRET = 'test-secret-must-be-at-least-32-characters-long';

/** In-memory denylist store recording values and TTLs (no expiry simulation). */
class FakeStore implements JwtDenylistStore {
  public map = new Map<string, string>();
  public ttls = new Map<string, number>();

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.map.set(key, value);
    this.ttls.set(key, ttlSeconds);
  }
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
}

class BrokenStore implements JwtDenylistStore {
  set(): Promise<void> {
    return Promise.reject(new Error('redis down'));
  }
  get(): Promise<string | null> {
    return Promise.reject(new Error('redis down'));
  }
}

describe('JwtRevocationService', () => {
  it('denylists a jti with TTL equal to the remaining token lifetime', async () => {
    const store = new FakeStore();
    const svc = new JwtRevocationService(store);
    const revoked = await svc.revoke({ jti: 'tok-1', exp: 1_000_000 }, 999_400);
    expect(revoked).toBe(true);

    const key = [...store.map.keys()][0]!;
    expect(key).toContain('tok-1');
    // exp - at = 1_000_000 - 999_400
    expect(store.ttls.get(key)).toBe(600);
    expect(await svc.isRevoked('tok-1')).toBe(true);
  });

  it('reports non-revoked jtis as valid', async () => {
    const svc = new JwtRevocationService(new FakeStore());
    expect(await svc.isRevoked('never-revoked')).toBe(false);
    await expect(svc.assertNotRevoked('never-revoked')).resolves.toBeUndefined();
  });

  it('skips the write for an already-expired token', async () => {
    const store = new FakeStore();
    const svc = new JwtRevocationService(store);
    // exp == at (expired this second) and exp < at both skip.
    expect(await svc.revoke({ jti: 'old', exp: 500 }, 500)).toBe(false);
    expect(await svc.revoke({ jti: 'older', exp: 400 }, 500)).toBe(false);
    expect(store.map.size).toBe(0);
  });

  it('skips the write for an empty jti and fails closed when checking one', async () => {
    const store = new FakeStore();
    const svc = new JwtRevocationService(store);
    expect(await svc.revoke({ jti: '', exp: 10_000 }, 1)).toBe(false);
    expect(store.map.size).toBe(0);
    expect(await svc.isRevoked('')).toBe(true);
  });

  it('assertNotRevoked throws a typed JwtError for a denylisted jti', async () => {
    const svc = new JwtRevocationService(new FakeStore());
    await svc.revoke({ jti: 'gone', exp: Math.floor(Date.now() / 1000) + 3600 });
    await expect(svc.assertNotRevoked('gone')).rejects.toThrowError(
      expect.objectContaining({ code: 'revoked' })
    );
    await expect(svc.assertNotRevoked('gone')).rejects.toBeInstanceOf(JwtError);
  });

  it('propagates store errors so auth callers can fail closed', async () => {
    const svc = new JwtRevocationService(new BrokenStore());
    await expect(svc.isRevoked('any')).rejects.toThrow('redis down');
    await expect(svc.assertNotRevoked('any')).rejects.toThrow('redis down');
    await expect(svc.revoke({ jti: 'any', exp: 9_999_999_999 })).rejects.toThrow('redis down');
  });

  it('revokes real issued tokens end-to-end with JwtService claims', async () => {
    const jwt = new JwtService({ secret: SECRET, expiresInSeconds: 100 });
    const svc = new JwtRevocationService(new FakeStore());

    const issuedAt = 2_000_000;
    const { token, claims } = jwt.issueWithClaims({ userId: 'user-1' }, issuedAt);
    expect(await svc.isRevoked(claims.jti)).toBe(false);

    expect(await svc.revoke(claims, issuedAt + 40)).toBe(true);
    expect(await svc.isRevoked(claims.jti)).toBe(true);

    // The token still *verifies* (signature/exp are intact) — revocation is a
    // separate check layered on top by the auth path.
    expect(jwt.verify(token, issuedAt + 50).jti).toBe(claims.jti);
  });
});
