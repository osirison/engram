import { describe, it, expect } from 'vitest';
import type { RateLimitStore, RateLimitIncrementResult } from './rate-limit-store.js';
import { RateLimitService } from './rate-limit.service.js';

/**
 * In-memory fixed-window store with a manual clock so we can advance time and
 * observe window resets deterministically.
 */
class FakeStore implements RateLimitStore {
  private counters = new Map<string, { count: number; expiresAt: number }>();
  constructor(public now = 0) {}

  advance(seconds: number): void {
    this.now += seconds;
  }

  async increment(key: string, windowSeconds: number): Promise<RateLimitIncrementResult> {
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= this.now) {
      this.counters.set(key, { count: 1, expiresAt: this.now + windowSeconds });
      return { count: 1, ttlSeconds: windowSeconds };
    }
    existing.count += 1;
    return { count: existing.count, ttlSeconds: existing.expiresAt - this.now };
  }
}

describe('RateLimitService', () => {
  it('allows requests up to the limit, then blocks', async () => {
    const store = new FakeStore();
    const svc = new RateLimitService(store, {
      defaultRule: { limit: 3, windowSeconds: 60 },
    });

    const r1 = await svc.consume({ key: 'user-1' });
    expect(r1).toMatchObject({ allowed: true, limit: 3, remaining: 2 });
    const r2 = await svc.consume({ key: 'user-1' });
    expect(r2).toMatchObject({ allowed: true, remaining: 1 });
    const r3 = await svc.consume({ key: 'user-1' });
    expect(r3).toMatchObject({ allowed: true, remaining: 0 });

    const r4 = await svc.consume({ key: 'user-1' });
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfterSeconds).toBeGreaterThan(0);
    expect(r4.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('resets after the window elapses', async () => {
    const store = new FakeStore();
    const svc = new RateLimitService(store, {
      defaultRule: { limit: 1, windowSeconds: 60 },
    });
    expect((await svc.consume({ key: 'u' })).allowed).toBe(true);
    expect((await svc.consume({ key: 'u' })).allowed).toBe(false);

    store.advance(61);
    const afterReset = await svc.consume({ key: 'u' });
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(0);
  });

  it('keeps separate buckets per identity', async () => {
    const store = new FakeStore();
    const svc = new RateLimitService(store, {
      defaultRule: { limit: 1, windowSeconds: 60 },
    });
    expect((await svc.consume({ key: 'a' })).allowed).toBe(true);
    // Different identity is unaffected.
    expect((await svc.consume({ key: 'b' })).allowed).toBe(true);
    // First identity is now blocked.
    expect((await svc.consume({ key: 'a' })).allowed).toBe(false);
  });

  it('meters overridden tools against a separate, stricter bucket', async () => {
    const store = new FakeStore();
    const svc = new RateLimitService(store, {
      defaultRule: { limit: 100, windowSeconds: 60 },
      toolOverrides: { reindex_memories: { limit: 1, windowSeconds: 60 } },
    });

    // The override bucket is independent of the default bucket.
    expect((await svc.consume({ key: 'u', tool: 'reindex_memories' })).allowed).toBe(true);
    expect((await svc.consume({ key: 'u', tool: 'reindex_memories' })).allowed).toBe(false);

    // A non-overridden tool for the same identity still uses the generous default.
    expect((await svc.consume({ key: 'u', tool: 'recall' })).allowed).toBe(true);
  });

  it('never reports negative remaining', async () => {
    const store = new FakeStore();
    const svc = new RateLimitService(store, {
      defaultRule: { limit: 1, windowSeconds: 30 },
    });
    await svc.consume({ key: 'u' });
    await svc.consume({ key: 'u' });
    const blocked = await svc.consume({ key: 'u' });
    expect(blocked.remaining).toBe(0);
  });
});
