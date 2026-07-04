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

  async increment(
    key: string,
    windowSeconds: number,
    units = 1
  ): Promise<RateLimitIncrementResult> {
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= this.now) {
      this.counters.set(key, { count: units, expiresAt: this.now + windowSeconds });
      return { count: units, ttlSeconds: windowSeconds };
    }
    existing.count += units;
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

  describe('multi-unit charging (work-proportional metering)', () => {
    it('charges N units for a consume of N units', async () => {
      const store = new FakeStore();
      const svc = new RateLimitService(store, {
        defaultRule: { limit: 10, windowSeconds: 60 },
      });

      const r1 = await svc.consume({ key: 'u', units: 4 });
      expect(r1).toMatchObject({ allowed: true, remaining: 6 });
      const r2 = await svc.consume({ key: 'u', units: 4 });
      expect(r2).toMatchObject({ allowed: true, remaining: 2 });
      // 4 more units exceed the remaining budget of 2.
      const r3 = await svc.consume({ key: 'u', units: 4 });
      expect(r3.allowed).toBe(false);
      expect(r3.remaining).toBe(0);
      expect(r3.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('blocks a single consume larger than the whole limit', async () => {
      const store = new FakeStore();
      const svc = new RateLimitService(store, {
        defaultRule: { limit: 3, windowSeconds: 60 },
      });
      const blocked = await svc.consume({ key: 'u', units: 5 });
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
    });

    it('meters multi-unit consumes against per-tool override buckets', async () => {
      const store = new FakeStore();
      const svc = new RateLimitService(store, {
        defaultRule: { limit: 100, windowSeconds: 60 },
        toolOverrides: { ingest_conversation: { limit: 5, windowSeconds: 60 } },
      });

      const r1 = await svc.consume({ key: 'u', tool: 'ingest_conversation', units: 4 });
      expect(r1).toMatchObject({ allowed: true, remaining: 1 });
      const r2 = await svc.consume({ key: 'u', tool: 'ingest_conversation', units: 4 });
      expect(r2.allowed).toBe(false);

      // The default bucket for the same identity is untouched.
      const other = await svc.consume({ key: 'u', tool: 'recall' });
      expect(other).toMatchObject({ allowed: true, remaining: 99 });
    });

    it('resets multi-unit consumption after the window elapses', async () => {
      const store = new FakeStore();
      const svc = new RateLimitService(store, {
        defaultRule: { limit: 5, windowSeconds: 60 },
      });
      expect((await svc.consume({ key: 'u', units: 5 })).allowed).toBe(true);
      expect((await svc.consume({ key: 'u', units: 1 })).allowed).toBe(false);

      store.advance(61);
      expect((await svc.consume({ key: 'u', units: 5 })).allowed).toBe(true);
    });

    it.each([
      [0, 'zero'],
      [-3, 'negative'],
      [0.4, 'fractional below one'],
      [Number.NaN, 'NaN'],
      [Number.POSITIVE_INFINITY, 'infinite'],
    ])('normalizes unusable units (%s: %s) to a single unit', async (units) => {
      const store = new FakeStore();
      const svc = new RateLimitService(store, {
        defaultRule: { limit: 2, windowSeconds: 60 },
      });
      const r = await svc.consume({ key: 'u', units });
      expect(r).toMatchObject({ allowed: true, remaining: 1 });
    });

    it('floors fractional units above one', async () => {
      const store = new FakeStore();
      const svc = new RateLimitService(store, {
        defaultRule: { limit: 10, windowSeconds: 60 },
      });
      const r = await svc.consume({ key: 'u', units: 2.9 });
      expect(r).toMatchObject({ allowed: true, remaining: 8 });
    });
  });
});
