import type { Request, Response } from 'express';
import type { RateLimitStore, RateLimitIncrementResult } from '@engram/auth';
import { McpRateLimitMiddleware } from './mcp-rate-limit.middleware';
import type { RateLimitConfig } from './auth.config';
import type { AuthedRequest, McpAuthInfo } from './mcp-auth.middleware';

class FakeStore implements RateLimitStore {
  private counters = new Map<string, { count: number; expiresAt: number }>();
  now = 0;
  increment(
    key: string,
    windowSeconds: number,
    units = 1,
  ): Promise<RateLimitIncrementResult> {
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= this.now) {
      this.counters.set(key, {
        count: units,
        expiresAt: this.now + windowSeconds,
      });
      return Promise.resolve({ count: units, ttlSeconds: windowSeconds });
    }
    existing.count += units;
    return Promise.resolve({
      count: existing.count,
      ttlSeconds: existing.expiresAt - this.now,
    });
  }
}

function mockRes(): Response & {
  statusCode: number;
  headers: Record<string, string>;
} {
  const res = { statusCode: 200, headers: {} as Record<string, string> };
  const r = res as unknown as Response & typeof res;
  r.status = jest.fn((c: number) => {
    res.statusCode = c;
    return r;
  }) as never;
  r.json = jest.fn(() => r) as never;
  r.set = jest.fn((k: string, v: string) => {
    res.headers[k] = v;
    return r;
  }) as never;
  return r as never;
}

const config = (over: Partial<RateLimitConfig> = {}): RateLimitConfig => ({
  enabled: true,
  windowSeconds: 60,
  userRpm: 2,
  orgRpm: 100,
  ipRpm: 1,
  toolOverrides: {},
  ...over,
});

const authInfo = (over: Partial<McpAuthInfo['extra']> = {}): McpAuthInfo => ({
  token: 'jwt',
  clientId: 'user-1',
  scopes: [],
  extra: {
    userId: 'user-1',
    organizationId: null,
    email: null,
    method: 'jwt',
    apiKeyId: null,
    ...over,
  },
});

describe('McpRateLimitMiddleware', () => {
  it('meters authenticated users and 429s past the limit', async () => {
    const mw = new McpRateLimitMiddleware(new FakeStore(), config());
    const makeReq = (): AuthedRequest =>
      ({ headers: {}, body: {}, auth: authInfo() }) as unknown as AuthedRequest;

    const next = jest.fn();
    const res1 = mockRes();
    await mw.handle(makeReq() as Request, res1, next);
    expect(res1.statusCode).toBe(200);
    expect(res1.headers['X-RateLimit-Limit']).toBe('2');

    await mw.handle(makeReq() as Request, mockRes(), next); // 2nd allowed

    const blockedRes = mockRes();
    await mw.handle(makeReq() as Request, blockedRes, jest.fn());
    expect(blockedRes.statusCode).toBe(429);
    expect(blockedRes.headers['Retry-After']).toBeDefined();
  });

  it('meters unauthenticated requests by IP', async () => {
    const mw = new McpRateLimitMiddleware(new FakeStore(), config());
    const req = (): Request =>
      ({ headers: {}, body: {}, ip: '9.9.9.9' }) as unknown as Request;

    const allowed = mockRes();
    await mw.handle(req(), allowed, jest.fn());
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['X-RateLimit-Limit']).toBe('1');

    const blocked = mockRes();
    await mw.handle(req(), blocked, jest.fn());
    expect(blocked.statusCode).toBe(429);
  });

  it('applies stricter per-tool overrides on a separate bucket', async () => {
    const mw = new McpRateLimitMiddleware(
      new FakeStore(),
      config({
        userRpm: 100,
        toolOverrides: { reindex_memories: { limit: 1, windowSeconds: 60 } },
      }),
    );
    const reindexReq = (): Request =>
      ({
        headers: {},
        body: { method: 'tools/call', params: { name: 'reindex_memories' } },
        auth: authInfo(),
      }) as unknown as Request;

    await mw.handle(reindexReq(), mockRes(), jest.fn());
    const blocked = mockRes();
    await mw.handle(reindexReq(), blocked, jest.fn());
    expect(blocked.statusCode).toBe(429);
  });

  it('meters per API key — two keys of one user have independent budgets', async () => {
    const mw = new McpRateLimitMiddleware(
      new FakeStore(),
      config({ userRpm: 1 }),
    );
    const reqWithKey = (apiKeyId: string): Request =>
      ({
        headers: {},
        body: {},
        auth: authInfo({ apiKeyId }),
      }) as unknown as Request;

    // key-A exhausts its own budget...
    await mw.handle(reqWithKey('key-A'), mockRes(), jest.fn());
    const blockedA = mockRes();
    await mw.handle(reqWithKey('key-A'), blockedA, jest.fn());
    expect(blockedA.statusCode).toBe(429);

    // ...but key-B (same user) is unaffected.
    const allowedB = mockRes();
    await mw.handle(reqWithKey('key-B'), allowedB, jest.fn());
    expect(allowedB.statusCode).toBe(200);
  });

  it('meters every tool call in a JSON-RPC batch (no batch bypass)', async () => {
    const mw = new McpRateLimitMiddleware(
      new FakeStore(),
      config({ userRpm: 2 }),
    );
    // A single request carrying 3 tools/call entries must exceed a limit of 2.
    const batchReq = (): Request =>
      ({
        headers: {},
        body: [
          { method: 'tools/call', params: { name: 'recall' } },
          { method: 'tools/call', params: { name: 'recall' } },
          { method: 'tools/call', params: { name: 'recall' } },
        ],
        auth: authInfo(),
      }) as unknown as Request;
    const res = mockRes();
    await mw.handle(batchReq(), res, jest.fn());
    expect(res.statusCode).toBe(429);
  });

  describe('work-proportional metering for ingest_conversation (#204)', () => {
    const ingestReq = (
      turns: Array<{ role: string; content: string }>,
    ): Request =>
      ({
        headers: {},
        body: {
          method: 'tools/call',
          params: {
            name: 'ingest_conversation',
            arguments: { userId: 'cjld2cyuq0000t3rmniod1foy', turns },
          },
        },
        auth: authInfo(),
      }) as unknown as Request;

    const shortTurns = (n: number): Array<{ role: string; content: string }> =>
      Array.from({ length: n }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${i}`,
      }));

    it('charges one unit per chunk instead of one per request', async () => {
      const mw = new McpRateLimitMiddleware(
        new FakeStore(),
        config({ userRpm: 10 }),
      );

      // 3 short turns → 3 chunks → 3 units of the 10-unit budget.
      const res = mockRes();
      await mw.handle(ingestReq(shortTurns(3)), res, jest.fn());
      expect(res.statusCode).toBe(200);
      expect(res.headers['X-RateLimit-Remaining']).toBe('7');
    });

    it('blocks an ingest whose chunk cost exceeds the remaining budget', async () => {
      const mw = new McpRateLimitMiddleware(
        new FakeStore(),
        config({ userRpm: 10 }),
      );

      // 3 units consumed...
      await mw.handle(ingestReq(shortTurns(3)), mockRes(), jest.fn());
      // ...then 8 more units exceed the 10-unit budget → 429.
      const blocked = mockRes();
      await mw.handle(ingestReq(shortTurns(8)), blocked, jest.fn());
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers['Retry-After']).toBeDefined();
    });

    it('charges oversized turns per 10 KB chunk, not per turn', async () => {
      const mw = new McpRateLimitMiddleware(
        new FakeStore(),
        config({ userRpm: 2 }),
      );

      // One turn of ~30 KB splits into ≥3 chunks → exceeds a 2-unit budget in
      // a single request even though it is only one turn.
      const oneBigTurn = [{ role: 'user', content: 'X'.repeat(30_720) }];
      const res = mockRes();
      await mw.handle(ingestReq(oneBigTurn), res, jest.fn());
      expect(res.statusCode).toBe(429);
    });

    it('drains the organization budget proportionally as well', async () => {
      const mw = new McpRateLimitMiddleware(
        new FakeStore(),
        config({ userRpm: 100, orgRpm: 5 }),
      );
      const req = (): Request =>
        ({
          ...(ingestReq(shortTurns(6)) as object),
          auth: authInfo({ organizationId: 'org-1' }),
        }) as unknown as Request;

      const res = mockRes();
      await mw.handle(req(), res, jest.fn());
      // 6 chunks > 5-unit org budget → blocked by the org bucket.
      expect(res.statusCode).toBe(429);
    });

    it('still charges a single unit when ingest arguments are malformed', async () => {
      const mw = new McpRateLimitMiddleware(
        new FakeStore(),
        config({ userRpm: 10 }),
      );
      const malformed = {
        headers: {},
        body: {
          method: 'tools/call',
          params: { name: 'ingest_conversation', arguments: { turns: 'nope' } },
        },
        auth: authInfo(),
      } as unknown as Request;

      const res = mockRes();
      await mw.handle(malformed, res, jest.fn());
      expect(res.statusCode).toBe(200);
      expect(res.headers['X-RateLimit-Remaining']).toBe('9');
    });

    it('meters ingest chunks in unauthenticated (per-IP) buckets too', async () => {
      const mw = new McpRateLimitMiddleware(
        new FakeStore(),
        config({ ipRpm: 4 }),
      );
      const anonReq = {
        headers: {},
        ip: '9.9.9.9',
        body: {
          method: 'tools/call',
          params: {
            name: 'ingest_conversation',
            arguments: {
              userId: 'cjld2cyuq0000t3rmniod1foy',
              turns: shortTurns(5),
            },
          },
        },
      } as unknown as Request;

      const res = mockRes();
      await mw.handle(anonReq, res, jest.fn());
      // 5 chunks > 4-unit IP budget → blocked in one request.
      expect(res.statusCode).toBe(429);
    });
  });
});
