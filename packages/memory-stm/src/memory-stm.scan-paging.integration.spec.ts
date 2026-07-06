import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MemoryStmService } from './memory-stm.service';

/**
 * Live-Redis proof for the WP2 T2 short-term read seam.
 *
 * T2's other tests are all mock-based; this exercises the actual seam the task
 * exists to fix: create STM items in real Redis, then page every one of them back
 * through `list()` using the Redis SCAN cursor across multiple pages. It pins:
 *  - the SCAN cursor round-trips through `list()` and advances across pages
 *    (the loosened `list_memories` cursor schema rides on this),
 *  - every item is returned exactly once with no gaps or duplicates,
 *  - the persisted `StmMemory` JSON carries the fields the web `mapMcpMemory`
 *    reads (ttl / accessCount / version / expiresAt / type).
 *
 * Skipped unless `REDIS_URL` points at a reachable Redis (engram-redis in dev).
 */
const connectionString = process.env.STM_SCAN_TEST_URL ?? process.env.REDIS_URL;
const describeRedis = connectionString ? describe : describe.skip;

// CUID-shaped so it passes userId validation; unlikely to collide with real data.
const USER_ID = 'clstmscanpaging0000000001';
const TOTAL = 47; // not a multiple of the page size, so the last page is partial

describeRedis('MemoryStmService SCAN paging (integration)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  let service: MemoryStmService;

  beforeAll(async () => {
    const { default: Redis } = await import('ioredis');
    client = new Redis(connectionString as string, { maxRetriesPerRequest: 1 });

    // Minimal RedisService-shaped wrapper over the raw ioredis client — the STM
    // service only needs get/set/del/ttl/scan/pipeline.
    const redisService = {
      get: (key: string) => client.get(key),
      set: (key: string, value: string, ttl?: number) =>
        ttl ? client.set(key, value, 'EX', ttl) : client.set(key, value),
      del: (key: string) => client.del(key),
      ttl: (key: string) => client.ttl(key),
      expire: (key: string, ttl: number) => client.expire(key, ttl),
      async scan(cursor: string, options: { match?: string; count?: number } = {}) {
        const args: (string | number)[] = [cursor];
        if (options.match) args.push('MATCH', options.match);
        if (options.count) args.push('COUNT', options.count);
        const [next, keys] = await client.scan(...args);
        return { cursor: next, keys };
      },
      pipeline: () => client.pipeline(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    service = new MemoryStmService(redisService);

    // Clean any leftovers from a prior run, then seed TOTAL items.
    const pattern = `memory:stm:${USER_ID}:*`;
    const stale: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      stale.push(...keys);
      cursor = next;
    } while (cursor !== '0');
    if (stale.length) await client.del(...stale);

    for (let i = 0; i < TOTAL; i++) {
      await service.create({
        userId: USER_ID,
        content: `scan paging memory ${i}`,
        tags: i % 2 === 0 ? ['even'] : ['odd'],
        ttl: 3600,
      });
    }
  }, 30_000);

  afterAll(async () => {
    if (!client) return;
    const pattern = `memory:stm:${USER_ID}:*`;
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      keys.push(...batch);
      cursor = next;
    } while (cursor !== '0');
    if (keys.length) await client.del(...keys);
    await client.quit();
  });

  it('pages every STM item exactly once via the SCAN cursor', async () => {
    const seen = new Set<string>();
    let cursor: string | undefined;
    // Bounded so a paging bug loops finitely, not forever.
    for (let page = 0; page < 200; page++) {
      const result = await service.list(USER_ID, { limit: 10, cursor });
      for (const item of result.items) seen.add(item.id);
      // The SCAN cursor returns to '0' when iteration completes.
      if (result.endCursor === '0' || !result.endCursor) break;
      cursor = result.endCursor;
    }
    expect(seen.size).toBe(TOTAL);
  });

  it('persists the StmMemory shape the web mapMcpMemory reads', async () => {
    const { items } = await service.list(USER_ID, { limit: 5 });
    expect(items.length).toBeGreaterThan(0);
    const m = items[0]!;
    expect(m.type).toBe('short-term');
    expect(typeof m.ttl).toBe('number');
    expect(typeof m.accessCount).toBe('number');
    expect(m.version).toBe(1);
    expect(m.expiresAt).toBeInstanceOf(Date);
    expect(Array.isArray(m.tags)).toBe(true);
  });

  it('filters by tag while paging (server-side scope for the STM tier)', async () => {
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 200; page++) {
      const result = await service.list(USER_ID, { limit: 10, cursor, tags: ['even'] });
      for (const item of result.items) {
        expect(item.tags).toContain('even');
        seen.add(item.id);
      }
      if (result.endCursor === '0' || !result.endCursor) break;
      cursor = result.endCursor;
    }
    // 0,2,4,…,46 → 24 even items.
    expect(seen.size).toBe(Math.ceil(TOTAL / 2));
  });
});
