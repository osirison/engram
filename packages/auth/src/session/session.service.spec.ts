import { describe, it, expect } from 'vitest';
import type { SessionStore } from './session-store.js';
import { SessionService } from './session.service.js';

/** In-memory SessionStore with no TTL expiry (sufficient for lifecycle tests). */
class FakeStore implements SessionStore {
  public map = new Map<string, string>();
  public ttls = new Map<string, number>();

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.map.set(key, value);
    this.ttls.set(key, ttlSeconds);
  }
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async getDelete(key: string): Promise<string | null> {
    const v = this.map.get(key) ?? null;
    this.map.delete(key);
    return v;
  }
}

describe('SessionService', () => {
  it('creates, reads, and destroys a session', async () => {
    const store = new FakeStore();
    const svc = new SessionService(store);
    const sessionId = await svc.createSession({
      userId: 'user-1',
      organizationId: 'org-1',
      email: 'a@b.com',
      scopes: ['memories:read'],
    });
    expect(sessionId).toMatch(/^[A-Za-z0-9_-]+$/);

    const data = await svc.getSession(sessionId);
    expect(data?.userId).toBe('user-1');
    expect(data?.organizationId).toBe('org-1');
    expect(data?.scopes).toEqual(['memories:read']);
    expect(typeof data?.createdAt).toBe('number');

    await svc.destroySession(sessionId);
    expect(await svc.getSession(sessionId)).toBeNull();
  });

  it('applies the configured session TTL', async () => {
    const store = new FakeStore();
    const svc = new SessionService(store, { sessionTtlSeconds: 42 });
    const id = await svc.createSession({
      userId: 'u',
      organizationId: null,
      email: null,
      scopes: [],
    });
    const key = [...store.ttls.keys()].find((k) => k.includes(id));
    expect(store.ttls.get(key!)).toBe(42);
  });

  it('returns null for unknown or malformed sessions', async () => {
    const store = new FakeStore();
    const svc = new SessionService(store);
    expect(await svc.getSession('nope')).toBeNull();
    expect(await svc.getSession('')).toBeNull();
    await store.set('auth:session:bad', 'not-json', 60);
    expect(await svc.getSession('bad')).toBeNull();
  });

  it('issues one-time OAuth state that cannot be replayed', async () => {
    const store = new FakeStore();
    const svc = new SessionService(store);
    const state = await svc.createOAuthState('github');

    const first = await svc.consumeOAuthState(state);
    expect(first?.provider).toBe('github');

    // Replaying the same state returns null (already consumed).
    const second = await svc.consumeOAuthState(state);
    expect(second).toBeNull();
  });

  it('returns null when consuming unknown state', async () => {
    const svc = new SessionService(new FakeStore());
    expect(await svc.consumeOAuthState('unknown')).toBeNull();
    expect(await svc.consumeOAuthState('')).toBeNull();
  });
});
