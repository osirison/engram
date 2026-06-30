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
  ): Promise<RateLimitIncrementResult> {
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= this.now) {
      this.counters.set(key, { count: 1, expiresAt: this.now + windowSeconds });
      return Promise.resolve({ count: 1, ttlSeconds: windowSeconds });
    }
    existing.count += 1;
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
});
