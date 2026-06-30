import type { Session } from 'next-auth';
import { describe, expect, it, vi } from 'vitest';

import { BackendError, type EngramBackend } from '@/server/backend';
import type { TRPCContext } from '../context';
import { createCaller } from '../root';

function makeBackend(overrides: Partial<EngramBackend> = {}): EngramBackend {
  return {
    capabilities: vi
      .fn()
      .mockReturnValue({ writes: true, semanticSearch: true, mcpConfigured: true }),
    listMemories: vi
      .fn()
      .mockResolvedValue({ items: [], totalCount: 0, nextCursor: null, hasMore: false }),
    getMemory: vi.fn().mockResolvedValue(null),
    searchMemories: vi.fn().mockResolvedValue({ items: [], count: 0, semantic: true }),
    updateMemory: vi.fn(),
    deleteMemory: vi.fn().mockResolvedValue({ deleted: true }),
    getHealth: vi.fn().mockResolvedValue({
      reachable: true,
      status: 'ok',
      services: [],
      process: null,
      error: null,
      timestamp: '',
    }),
    getMetrics: vi.fn(),
    getMemoryStats: vi.fn().mockResolvedValue({ total: 0 }),
    getActivitySeries: vi.fn().mockResolvedValue([]),
    listMemoryOwners: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as EngramBackend;
}

const session: Session = {
  user: { id: 'op', email: 'op@example.com', name: 'Operator', image: null },
  expires: '2099-01-01',
};

function caller(backend: EngramBackend, withSession = true) {
  const ctx: TRPCContext = { session: withSession ? session : null, backend };
  return createCaller(ctx);
}

describe('protectedProcedure', () => {
  it('rejects unauthenticated callers', async () => {
    const api = caller(makeBackend(), false);
    await expect(api.memory.list({ userId: 'qp' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('memory router', () => {
  it('delegates list with parsed defaults', async () => {
    const backend = makeBackend();
    const api = caller(backend);
    await api.memory.list({ userId: 'qp' });
    expect(backend.listMemories).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'qp',
        type: 'all',
        sortBy: 'createdAt',
        sortOrder: 'desc',
        limit: 25,
      })
    );
  });

  it('throws NOT_FOUND when a memory is missing', async () => {
    const api = caller(makeBackend({ getMemory: vi.fn().mockResolvedValue(null) }));
    await expect(api.memory.get({ userId: 'qp', memoryId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('maps a WRITES_DISABLED BackendError to PRECONDITION_FAILED', async () => {
    const backend = makeBackend({
      updateMemory: vi.fn().mockRejectedValue(new BackendError('no writes', 'WRITES_DISABLED')),
    });
    const api = caller(backend);
    await expect(
      api.memory.update({ userId: 'qp', memoryId: 'm1', content: 'x' })
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('validates input (empty userId rejected)', async () => {
    const api = caller(makeBackend());
    await expect(api.memory.list({ userId: '' })).rejects.toBeTruthy();
  });

  it('delegates search', async () => {
    const backend = makeBackend();
    const api = caller(backend);
    await api.memory.search({ userId: 'qp', query: 'hello' });
    expect(backend.searchMemories).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'qp', query: 'hello', limit: 20 })
    );
  });
});

describe('health + analytics + meta routers', () => {
  it('returns health status', async () => {
    const api = caller(makeBackend());
    await expect(api.health.status()).resolves.toMatchObject({ status: 'ok' });
  });

  it('returns capabilities', async () => {
    const api = caller(makeBackend());
    await expect(api.meta.capabilities()).resolves.toMatchObject({ writes: true });
  });

  it('delegates analytics activity with default window', async () => {
    const backend = makeBackend();
    const api = caller(backend);
    await api.analytics.activity({ userId: 'qp' });
    expect(backend.getActivitySeries).toHaveBeenCalledWith('qp', 30);
  });

  it('exposes the signed-in operator', async () => {
    const api = caller(makeBackend());
    await expect(api.meta.session()).resolves.toMatchObject({
      user: { email: 'op@example.com' },
    });
  });
});
