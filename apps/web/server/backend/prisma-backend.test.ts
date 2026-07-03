import type { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpToolClient } from './mcp-client';
import { parsePrometheus, PrismaEngramBackend } from './prisma-backend';

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'm1',
    userId: 'qp',
    organizationId: null,
    scope: null,
    content: 'a memory',
    metadata: null,
    tags: [],
    type: 'long-term',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    expiresAt: null,
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    memory: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi
        .fn()
        .mockResolvedValue({ _max: { createdAt: null }, _min: { createdAt: null } }),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as PrismaClient;
}

function mockFetch(responses: Record<string, { ok?: boolean; json?: unknown; text?: string }>) {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const match = responses[path];
    if (!match) return { ok: false, status: 404 } as Response;
    return {
      ok: match.ok ?? true,
      status: 200,
      json: async () => match.json,
      text: async () => match.text ?? '',
    } as Response;
  }) as unknown as typeof fetch;
}

describe('PrismaEngramBackend.capabilities', () => {
  it('reports disabled writes when no MCP client', async () => {
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: null,
      mcpApiKey: null,
    });
    await expect(backend.capabilities()).resolves.toEqual({
      writes: false,
      semanticSearch: false,
      mcpConfigured: false,
      delegation: 'unknown',
      keyTenant: null,
      limitation: null,
    });
  });

  it('reports enabled capabilities when an MCP client is present', async () => {
    const mcp = { call: vi.fn() } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });
    await expect(backend.capabilities()).resolves.toMatchObject({ writes: true });
  });

  it('reports unrestricted delegation with a precondition caveat when no API key is configured', async () => {
    const mcp = { call: vi.fn() } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });
    const caps = await backend.capabilities();
    expect(caps.delegation).toBe('unrestricted');
    expect(caps.keyTenant).toBeNull();
    // The keyless-but-configured case only works against an auth-disabled
    // server; the console cannot verify that, so it surfaces the caveat rather
    // than a bare green light.
    expect(caps.limitation).toContain('ENGRAM_API_KEY');
    expect(caps.limitation).toContain('auth disabled');
  });

  it('reports admin delegation when the key holds the admin scope', async () => {
    const fetchImpl = mockFetch({
      '/auth/me': { json: { user: { userId: 'svc', scopes: ['admin'] } } },
    });
    const mcp = { call: vi.fn() } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: 'eng_admin',
      mcpClient: mcp,
      fetchImpl,
    });
    await expect(backend.capabilities()).resolves.toMatchObject({
      delegation: 'admin',
      keyTenant: 'svc',
      limitation: null,
    });
  });

  it('reports tenant-limited delegation with a warning for a non-admin key', async () => {
    const fetchImpl = mockFetch({
      '/auth/me': {
        json: {
          user: { userId: 'svc', scopes: ['memories:read', 'memories:write', 'memories:delete'] },
        },
      },
    });
    const mcp = { call: vi.fn() } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: 'eng_service',
      mcpClient: mcp,
      fetchImpl,
    });
    const caps = await backend.capabilities();
    expect(caps.delegation).toBe('tenant-limited');
    expect(caps.keyTenant).toBe('svc');
    expect(caps.limitation).toContain('limited to the API key');
    expect(caps.limitation).toContain('"svc"');
  });

  it('reports unknown delegation with a warning when /auth/me is unreachable', async () => {
    const fetchImpl = mockFetch({}); // every path 404s
    const mcp = { call: vi.fn() } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: 'eng_service',
      mcpClient: mcp,
      fetchImpl,
    });
    const caps = await backend.capabilities();
    expect(caps.delegation).toBe('unknown');
    expect(caps.limitation).toContain('Could not verify');
  });

  it('caches a successful delegation probe but retries after unknown', async () => {
    const okFetch = mockFetch({
      '/auth/me': { json: { user: { userId: 'svc', scopes: ['admin'] } } },
    });
    const cachedBackend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: 'eng_admin',
      mcpClient: { call: vi.fn() } as unknown as McpToolClient,
      fetchImpl: okFetch,
    });
    await cachedBackend.capabilities();
    await cachedBackend.capabilities();
    expect(okFetch).toHaveBeenCalledTimes(1);

    const failFetch = mockFetch({});
    const retryBackend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: 'eng_admin',
      mcpClient: { call: vi.fn() } as unknown as McpToolClient,
      fetchImpl: failFetch,
    });
    await retryBackend.capabilities();
    await retryBackend.capabilities();
    expect(failFetch).toHaveBeenCalledTimes(2); // 'unknown' is never cached
  });

  it('re-probes once the delegation cache TTL has elapsed', async () => {
    const okFetch = mockFetch({
      '/auth/me': { json: { user: { userId: 'svc', scopes: ['admin'] } } },
    });
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: 'eng_admin',
      mcpClient: { call: vi.fn() } as unknown as McpToolClient,
      fetchImpl: okFetch,
      // TTL 0 means a cached result is always considered stale, so every
      // capabilities() call must re-probe — proving the TTL check is load-bearing
      // (a cache-that-never-expires bug would serve the first result and fail).
      delegationCacheTtlMs: 0,
    });
    await backend.capabilities();
    await backend.capabilities();
    expect(okFetch).toHaveBeenCalledTimes(2);
  });
});

describe('PrismaEngramBackend.listMemories', () => {
  it('maps rows to DTOs, derives importance/insight/embedding, and paginates', async () => {
    const prisma = makePrisma();
    (prisma.memory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeRow({ id: 'm1', metadata: { importance: 0.8 }, tags: ['insight', 'x'] }),
      makeRow({ id: 'm2' }),
    ]);
    (prisma.memory.count as ReturnType<typeof vi.fn>).mockResolvedValue(5);
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'm1' }]);

    const backend = new PrismaEngramBackend({ prisma, mcpUrl: null, mcpApiKey: null });
    const result = await backend.listMemories({ userId: 'qp', limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      id: 'm1',
      importance: 0.8,
      isInsight: true,
      hasEmbedding: true,
      createdAt: '2026-06-01T00:00:00.000Z',
    });
    expect(result.items[1]).toMatchObject({ id: 'm2', hasEmbedding: false, importance: null });
    expect(result.totalCount).toBe(5);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('2');
  });

  it('uses the insight tag (not metadata) as the source of truth for isInsight', async () => {
    const prisma = makePrisma();
    (prisma.memory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeRow({ id: 'a', tags: ['insight'] }),
      makeRow({ id: 'b', metadata: { isInsight: true }, tags: [] }),
    ]);
    (prisma.memory.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const backend = new PrismaEngramBackend({ prisma, mcpUrl: null, mcpApiKey: null });
    const { items } = await backend.listMemories({ userId: 'qp', limit: 10 });
    expect(items.find((i) => i.id === 'a')!.isInsight).toBe(true);
    expect(items.find((i) => i.id === 'b')!.isInsight).toBe(false);
  });
});

describe('PrismaEngramBackend.searchMemories', () => {
  it('uses MCP recall and returns semantic=true, scored and sorted', async () => {
    const prisma = makePrisma();
    (prisma.memory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeRow({ id: 'm1' }),
      makeRow({ id: 'm2' }),
    ]);
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const mcp = {
      call: vi.fn().mockResolvedValue({
        results: [
          { score: 0.4, memory: { id: 'm1' } },
          { score: 0.9, memory: { id: 'm2' } },
        ],
      }),
    } as unknown as McpToolClient;

    const backend = new PrismaEngramBackend({
      prisma,
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });

    const result = await backend.searchMemories({ userId: 'qp', query: 'cats', limit: 10 });
    expect(result.semantic).toBe(true);
    expect(mcp.call as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'recall',
      expect.objectContaining({ userId: 'qp', query: 'cats' })
    );
    expect(result.items.map((i) => i.id)).toEqual(['m2', 'm1']); // sorted by score desc
    expect(result.items[0]!.score).toBe(0.9);
  });

  it('falls back to keyword search (semantic=false) when MCP is absent', async () => {
    const prisma = makePrisma();
    (prisma.memory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow({ id: 'm1' })]);
    (prisma.memory.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    const backend = new PrismaEngramBackend({ prisma, mcpUrl: null, mcpApiKey: null });
    const result = await backend.searchMemories({ userId: 'qp', query: 'cats', limit: 10 });

    expect(result.semantic).toBe(false);
    expect(result.items).toHaveLength(1);
  });

  it('falls back to keyword search when MCP recall throws', async () => {
    const prisma = makePrisma();
    (prisma.memory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow({ id: 'm1' })]);
    (prisma.memory.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    const mcp = { call: vi.fn().mockRejectedValue(new Error('down')) } as unknown as McpToolClient;

    const backend = new PrismaEngramBackend({
      prisma,
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });
    const result = await backend.searchMemories({ userId: 'qp', query: 'cats', limit: 10 });
    expect(result.semantic).toBe(false);
  });
});

describe('PrismaEngramBackend writes', () => {
  it('rejects updates when writes are disabled', async () => {
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: null,
      mcpApiKey: null,
    });
    await expect(
      backend.updateMemory({ userId: 'qp', memoryId: 'm1', content: 'new' })
    ).rejects.toMatchObject({ code: 'WRITES_DISABLED' });
  });

  it('rejects deletes when writes are disabled', async () => {
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: null,
      mcpApiKey: null,
    });
    await expect(backend.deleteMemory({ userId: 'qp', memoryId: 'm1' })).rejects.toMatchObject({
      code: 'WRITES_DISABLED',
    });
  });

  it('routes updates through MCP then re-reads the memory', async () => {
    const prisma = makePrisma();
    (prisma.memory.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeRow({ id: 'm1', content: 'new' })
    );
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const mcp = { call: vi.fn().mockResolvedValue({}) } as unknown as McpToolClient;

    const backend = new PrismaEngramBackend({
      prisma,
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });
    const updated = await backend.updateMemory({ userId: 'qp', memoryId: 'm1', content: 'new' });
    expect(mcp.call as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'update_memory',
      expect.objectContaining({ userId: 'qp', memoryId: 'm1', content: 'new' })
    );
    expect(updated.content).toBe('new');
  });

  it('deletes through MCP', async () => {
    const mcp = { call: vi.fn().mockResolvedValue({}) } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });
    await expect(backend.deleteMemory({ userId: 'qp', memoryId: 'm1' })).resolves.toEqual({
      deleted: true,
    });
    expect(mcp.call as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'delete_memory',
      expect.objectContaining({ memoryId: 'm1' })
    );
  });
});

describe('PrismaEngramBackend.getHealth', () => {
  it('returns unreachable when no MCP url is configured', async () => {
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: null,
      mcpApiKey: null,
    });
    const report = await backend.getHealth();
    expect(report.reachable).toBe(false);
    expect(report.status).toBe('unknown');
  });

  it('parses Terminus health into services + process', async () => {
    const fetchImpl = mockFetch({
      '/health': {
        json: {
          status: 'ok',
          info: {
            database: { status: 'up' },
            'memory-store': {
              status: 'up',
              pid: 42,
              uptimeSeconds: 100,
              heapUsedMb: 12,
              rssMb: 30,
            },
          },
        },
      },
    });
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      fetchImpl,
    });
    const report = await backend.getHealth();
    expect(report.reachable).toBe(true);
    expect(report.status).toBe('ok');
    expect(report.services.find((s) => s.name === 'database')?.status).toBe('up');
    expect(report.process).toMatchObject({ pid: 42, uptimeSeconds: 100 });
  });
});

describe('PrismaEngramBackend.getMetrics', () => {
  it('parses curated metrics from the Prometheus endpoint', async () => {
    const text = [
      'engram_active_mcp_sessions 3',
      'engram_memory_operations_total{op="create",tier="ltm",status="success"} 10',
      'engram_memory_operations_total{op="recall",tier="ltm",status="success"} 5',
      'engram_embeddings_requests_total 100',
      'engram_embeddings_cacheHits_total 40',
      // multi-label info gauge: labelFor must pick the named label, not the last
      'engram_vector_backend_info{backend="qdrant",region="eu"} 1',
    ].join('\n');
    const fetchImpl = mockFetch({ '/health/metrics': { text } });
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      fetchImpl,
    });
    const metrics = await backend.getMetrics();
    expect(metrics.reachable).toBe(true);
    expect(metrics.activeSessions).toBe(3);
    expect(metrics.memoryOperationsTotal).toBe(15);
    expect(metrics.embeddings.cacheHitRatio).toBeCloseTo(0.4);
    expect(metrics.vectorBackend).toBe('qdrant');
  });
});

describe('parsePrometheus', () => {
  let parsed: Record<string, number>;
  beforeEach(() => {
    parsed = parsePrometheus(
      [
        '# HELP foo bar',
        '# TYPE foo gauge',
        'foo 1',
        'baz{a="b"} 2.5',
        'tiny 1.5e-9', // negative exponent
        'stamped 7 1718000000', // trailing timestamp
        'inf_metric +Inf', // special — captured then dropped by isFinite
        'malformed line',
      ].join('\n')
    );
  });
  it('parses comments, floats, exponents, timestamps; drops specials and junk', () => {
    expect(parsed.foo).toBe(1);
    expect(parsed['baz{a="b"}']).toBe(2.5);
    expect(parsed.tiny).toBeCloseTo(1.5e-9);
    expect(parsed.stamped).toBe(7);
    expect(parsed.inf_metric).toBeUndefined();
    expect(Object.keys(parsed)).toHaveLength(4);
  });
});
