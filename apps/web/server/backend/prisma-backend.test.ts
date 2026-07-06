import type { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeCursor, encodeCursor } from './cursor';
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
    version: 1,
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
    memoryAudit: {
      findMany: vi.fn().mockResolvedValue([]),
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
  it('maps rows to DTOs, derives importance/insight/embedding, and keyset-paginates', async () => {
    const prisma = makePrisma();
    // Over-fetch: limit+1 rows come back, so hasMore is detected without a
    // second query and the extra row is trimmed from the page (WP2 T1/D8).
    (prisma.memory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeRow({ id: 'm1', metadata: { importance: 0.8 }, tags: ['insight', 'x'] }),
      makeRow({ id: 'm2', createdAt: new Date('2026-05-30T00:00:00.000Z') }),
      makeRow({ id: 'm3' }),
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

    // Query shape: keyset ordering with an id tiebreak, over-fetch, no `skip`.
    const findArgs = (prisma.memory.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(findArgs.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(findArgs.take).toBe(3);
    expect(findArgs.skip).toBeUndefined();

    // nextCursor points at the last row OF THE PAGE (m2), not the over-fetched m3.
    expect(decodeCursor(result.nextCursor)).toEqual({
      v: new Date('2026-05-30T00:00:00.000Z').getTime(),
      id: 'm2',
    });
  });

  it('applies the decoded cursor as an AND-ed keyset predicate; no next page when short', async () => {
    const prisma = makePrisma();
    // Fewer than limit+1 rows → this is the last page.
    (prisma.memory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow({ id: 'z' })]);
    (prisma.memory.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);

    const backend = new PrismaEngramBackend({ prisma, mcpUrl: null, mcpApiKey: null });
    const cursor = encodeCursor({ v: new Date('2026-06-01T00:00:00.000Z').getTime(), id: 'm5' });
    const result = await backend.listMemories({ userId: 'qp', limit: 2, cursor });

    const findArgs = (prisma.memory.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // The base filter is preserved and the seek predicate is AND-ed on top.
    expect(findArgs.where.AND).toBeDefined();
    expect(findArgs.where.AND[1].OR).toEqual([
      { createdAt: { lt: new Date('2026-06-01T00:00:00.000Z') } },
      { createdAt: new Date('2026-06-01T00:00:00.000Z'), id: { lt: 'm5' } },
    ]);
    // totalCount counts the base filter, not the seek window.
    const countArgs = (prisma.memory.count as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(countArgs.where.AND).toBeUndefined();
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('treats a legacy numeric offset cursor as the first page (no keyset clause)', async () => {
    const prisma = makePrisma();
    (prisma.memory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.memory.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    const backend = new PrismaEngramBackend({ prisma, mcpUrl: null, mcpApiKey: null });
    await backend.listMemories({ userId: 'qp', limit: 2, cursor: '25' });

    const findArgs = (prisma.memory.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(findArgs.where.AND).toBeUndefined();
    expect(findArgs.where).toMatchObject({ userId: 'qp' });
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

  it('promotes via MCP and returns the promoted memory from the structured result (WP2 T3)', async () => {
    const mcp = {
      call: vi.fn().mockResolvedValue({
        promoted: true,
        memory: {
          id: 'ltm-new',
          userId: 'qp',
          content: 'promoted',
          tags: [],
          type: 'long-term',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
      }),
    } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });
    const promoted = await backend.promoteMemory('qp', 'stm-old', 'op@example.com');
    expect(mcp.call as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'promote_memory',
      expect.objectContaining({ userId: 'qp', memoryId: 'stm-old', actorLabel: 'op@example.com' })
    );
    // Reads the NEW long-term id from the structured result, not the old STM id.
    expect(promoted.id).toBe('ltm-new');
    expect(promoted.type).toBe('long-term');
  });

  it('bulk-deletes through one MCP call and parses the per-item report (WP2 T6)', async () => {
    const mcp = {
      call: vi.fn().mockResolvedValue({
        deleted: ['a', 'b'],
        failed: [{ id: 'c', reason: 'not-found' }],
      }),
    } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });
    const result = await backend.bulkDeleteMemories({
      userId: 'qp',
      memoryIds: ['a', 'b', 'c'],
      actorLabel: 'op@example.com',
    });
    expect(mcp.call as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'bulk_delete_memories',
      expect.objectContaining({ userId: 'qp', memoryIds: ['a', 'b', 'c'] })
    );
    expect(result.deleted).toEqual(['a', 'b']);
    expect(result.failed).toEqual([{ id: 'c', reason: 'not-found' }]);
  });

  it('reads audit history from Postgres and maps rows (WP2 T5)', async () => {
    const prisma = makePrisma();
    (prisma.memoryAudit.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'a1',
        action: 'delete',
        actorType: 'api-key',
        actorLabel: 'op@example.com',
        delegated: true,
        before: { content: 'gone' },
        after: { deleted: true },
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    const backend = new PrismaEngramBackend({ prisma, mcpUrl: null, mcpApiKey: null });
    const entries = await backend.listMemoryAudit('qp', 'm1', 50);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'delete',
      actorLabel: 'op@example.com',
      delegated: true,
      before: { content: 'gone' },
      createdAt: '2026-07-01T00:00:00.000Z',
    });
  });

  it('restores via MCP then re-reads the memory (WP2 T5)', async () => {
    const prisma = makePrisma();
    (prisma.memory.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow({ id: 'm1' }));
    const mcp = { call: vi.fn().mockResolvedValue({}) } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma,
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });
    const restored = await backend.restoreMemory('qp', 'm1', 'op@example.com');
    expect(mcp.call as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'restore_memory',
      expect.objectContaining({ userId: 'qp', memoryId: 'm1', actorLabel: 'op@example.com' })
    );
    expect(restored.id).toBe('m1');
  });

  it('pre-flight blocks a cross-tenant write under a tenant-limited key (WP2 T9)', async () => {
    // /auth/me resolves a non-admin key bound to tenant "svc"; a write for "qp"
    // must fail fast with the limitation text instead of a downstream not-found.
    const fetchImpl = mockFetch({
      '/auth/me': { ok: true, json: { user: { userId: 'svc', scopes: [] } } },
    });
    const mcp = { call: vi.fn() } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: 'svc-key',
      mcpClient: mcp,
      fetchImpl,
    });
    await expect(backend.deleteMemory({ userId: 'qp', memoryId: 'm1' })).rejects.toMatchObject({
      code: 'WRITES_DISABLED',
    });
    // The block is pre-flight: the delete tool is never called.
    expect(mcp.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('allows a same-tenant write under a tenant-limited key (WP2 T9)', async () => {
    const fetchImpl = mockFetch({
      '/auth/me': { ok: true, json: { user: { userId: 'svc', scopes: [] } } },
    });
    const mcp = {
      call: vi.fn().mockResolvedValue({ deleted: true, memoryId: 'm1' }),
    } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: 'svc-key',
      mcpClient: mcp,
      fetchImpl,
    });
    await expect(backend.deleteMemory({ userId: 'svc', memoryId: 'm1' })).resolves.toEqual({
      deleted: true,
    });
  });

  it('reports the truthful {deleted:false} the tool returns (A10)', async () => {
    // Previously deleteMemory returned {deleted:true} unconditionally; now it
    // reflects the tool's structured result so an already-gone row is truthful.
    const mcp = {
      call: vi.fn().mockResolvedValue({ deleted: false, memoryId: 'm1' }),
    } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });
    await expect(backend.deleteMemory({ userId: 'qp', memoryId: 'm1' })).resolves.toEqual({
      deleted: false,
    });
  });
});

describe('PrismaEngramBackend.listStmMemories', () => {
  it('maps MCP short-term items (ttl/accessCount/expiresAt, hasEmbedding=false)', async () => {
    const mcp = {
      call: vi.fn().mockResolvedValue({
        memories: [
          {
            id: 'stm1',
            userId: 'qp',
            scope: 'agent:a',
            content: 'live note',
            metadata: null,
            tags: ['insight'],
            type: 'short-term',
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
            expiresAt: '2026-07-02T00:00:00.000Z',
            ttl: 3600,
            accessCount: 5,
          },
        ],
        pagination: { totalCount: 1, hasNextPage: true, endCursor: '42' },
      }),
    } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });

    const result = await backend.listStmMemories({ userId: 'qp', limit: 25 });

    expect(mcp.call as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'list_memories',
      expect.objectContaining({ userId: 'qp', type: 'short-term', limit: 25 })
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'stm1',
      type: 'short-term',
      ttlSeconds: 3600,
      accessCount: 5,
      hasEmbedding: false,
      isInsight: true,
      expiresAt: '2026-07-02T00:00:00.000Z',
    });
    expect(result.nextCursor).toBe('42');
    expect(result.hasMore).toBe(true);
  });

  it("treats a completed SCAN cursor ('0') as no next page", async () => {
    const mcp = {
      call: vi.fn().mockResolvedValue({
        memories: [],
        pagination: { totalCount: 0, hasNextPage: false, endCursor: '0' },
      }),
    } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });
    const result = await backend.listStmMemories({ userId: 'qp', limit: 25 });
    expect(result.nextCursor).toBeNull();
    expect(result.items).toEqual([]);
  });

  it('degrades with unavailableReason when no MCP server is configured', async () => {
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: null,
      mcpApiKey: null,
    });
    const result = await backend.listStmMemories({ userId: 'qp', limit: 25 });
    expect(result.items).toEqual([]);
    expect(result.unavailableReason).toBeTruthy();
  });
});

describe('PrismaEngramBackend.getMemory (STM fallback)', () => {
  it('returns the Postgres row without hitting MCP when present', async () => {
    const prisma = makePrisma();
    (prisma.memory.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
    const mcp = { call: vi.fn() } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma,
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });
    const memory = await backend.getMemory('qp', 'm1');
    expect(memory?.id).toBe('m1');
    expect(mcp.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('falls back to MCP get_memory on a Postgres miss and maps the STM item', async () => {
    const mcp = {
      call: vi.fn().mockResolvedValue({
        id: 'stm1',
        userId: 'qp',
        content: 'live',
        tags: [],
        type: 'short-term',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        expiresAt: '2026-07-02T00:00:00.000Z',
        ttl: 1200,
        accessCount: 2,
      }),
    } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });
    const memory = await backend.getMemory('qp', 'stm1');
    expect(memory).toMatchObject({ id: 'stm1', ttlSeconds: 1200, accessCount: 2 });
  });

  it('returns null for the structured {found:false} sentinel', async () => {
    const mcp = {
      call: vi.fn().mockResolvedValue({ found: false, memoryId: 'gone' }),
    } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });
    expect(await backend.getMemory('qp', 'gone')).toBeNull();
  });

  it('returns null for legacy prose (unparseable → string) not-found', async () => {
    const mcp = {
      call: vi.fn().mockResolvedValue('Memory gone not found'),
    } as unknown as McpToolClient;
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: 'http://localhost:3000',
      mcpApiKey: null,
      mcpClient: mcp,
    });
    expect(await backend.getMemory('qp', 'gone')).toBeNull();
  });

  it('stays Postgres-only (returns null, no throw) when MCP is unconfigured', async () => {
    const backend = new PrismaEngramBackend({
      prisma: makePrisma(),
      mcpUrl: null,
      mcpApiKey: null,
    });
    expect(await backend.getMemory('qp', 'missing')).toBeNull();
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
