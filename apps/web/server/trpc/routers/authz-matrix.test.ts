import type { Session } from 'next-auth';
import { describe, expect, it, vi } from 'vitest';

// Bind the operator to data owner "qp" only: canOperatorManageUser returns true
// for qp, false for anything else. This drives assertCanManageUser's FORBIDDEN
// path without touching real env parsing.
vi.mock('@/server/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/env')>();
  return {
    ...actual,
    canOperatorManageUser: (_email: string | null | undefined, userId: string) => userId === 'qp',
  };
});

import { type EngramBackend } from '@/server/backend';
import type { TRPCContext } from '../context';
import { createCaller } from '../root';

function makeBackend(): EngramBackend {
  const ok = vi
    .fn()
    .mockResolvedValue({ items: [], totalCount: 0, nextCursor: null, hasMore: false });
  return {
    capabilities: vi.fn().mockResolvedValue({
      writes: true,
      semanticSearch: true,
      mcpConfigured: true,
      delegation: 'admin',
      keyTenant: null,
      limitation: null,
    }),
    listMemories: ok,
    listStmMemories: ok,
    getMemory: vi.fn().mockResolvedValue({ id: 'm1' }),
    searchMemories: vi.fn().mockResolvedValue({ items: [], count: 0, semantic: true }),
    updateMemory: vi.fn().mockResolvedValue({ id: 'm1' }),
    promoteMemory: vi.fn().mockResolvedValue({ id: 'm1' }),
    reembedMemory: vi.fn().mockResolvedValue({ id: 'm1' }),
    deleteMemory: vi.fn().mockResolvedValue({ deleted: true }),
    bulkDeleteMemories: vi.fn().mockResolvedValue({ deleted: ['a'], failed: [] }),
    listMemoryAudit: vi.fn().mockResolvedValue([]),
    restoreMemory: vi.fn().mockResolvedValue({ id: 'm1' }),
    getMemoryStats: vi.fn().mockResolvedValue({ total: 0 }),
    getActivitySeries: vi.fn().mockResolvedValue([]),
    getHealth: vi.fn(),
    getMetrics: vi.fn(),
    listMemoryOwners: vi.fn().mockResolvedValue([]),
  } as unknown as EngramBackend;
}

const session: Session = {
  user: { id: 'op', email: 'op@example.com', name: 'Operator', image: null },
  expires: '2099-01-01',
};

function api() {
  const ctx: TRPCContext = { session, backend: makeBackend() };
  return createCaller(ctx);
}

// Every userId-taking procedure across the memory + analytics routers (WP2 T9).
// Listed EXPLICITLY so a future-added procedure that forgets the guard shows up
// as an obvious omission here rather than silently going unguarded.
const CALLS: Array<{ name: string; run: (u: string) => Promise<unknown> }> = [
  { name: 'memory.list', run: (u) => api().memory.list({ userId: u }) },
  { name: 'memory.listStm', run: (u) => api().memory.listStm({ userId: u }) },
  { name: 'memory.get', run: (u) => api().memory.get({ userId: u, memoryId: 'm1' }) },
  { name: 'memory.search', run: (u) => api().memory.search({ userId: u, query: 'x' }) },
  {
    name: 'memory.update',
    run: (u) => api().memory.update({ userId: u, memoryId: 'm1', content: 'x' }),
  },
  { name: 'memory.delete', run: (u) => api().memory.delete({ userId: u, memoryId: 'm1' }) },
  {
    name: 'memory.bulkDelete',
    run: (u) => api().memory.bulkDelete({ userId: u, memoryIds: ['m1'] }),
  },
  { name: 'memory.promote', run: (u) => api().memory.promote({ userId: u, memoryId: 'm1' }) },
  { name: 'memory.reembed', run: (u) => api().memory.reembed({ userId: u, memoryId: 'm1' }) },
  { name: 'memory.auditLog', run: (u) => api().memory.auditLog({ userId: u, memoryId: 'm1' }) },
  { name: 'memory.restore', run: (u) => api().memory.restore({ userId: u, memoryId: 'm1' }) },
  { name: 'analytics.stats', run: (u) => api().analytics.stats({ userId: u }) },
  { name: 'analytics.activity', run: (u) => api().analytics.activity({ userId: u }) },
];

describe('per-operator tenant binding — allowed/forbidden matrix (WP2 T9)', () => {
  it.each(CALLS)('$name allows the bound tenant (qp)', async ({ run }) => {
    await expect(run('qp')).resolves.not.toThrow();
  });

  it.each(CALLS)('$name forbids an unbound tenant (other) with FORBIDDEN', async ({ run }) => {
    await expect(run('other')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('meta.owners filters the switcher list to the bound tenant (WP2 T9)', async () => {
    const backend = makeBackend();
    (backend.listMemoryOwners as ReturnType<typeof vi.fn>).mockResolvedValue([
      { userId: 'qp', count: 3, lastActivityAt: null },
      { userId: 'other', count: 1, lastActivityAt: null },
    ]);
    const ctx: TRPCContext = { session, backend };
    const owners = await createCaller(ctx).meta.owners();
    // Only the bound owner (qp) is surfaced; 'other' is filtered out.
    expect(owners.map((o) => o.userId)).toEqual(['qp']);
  });
});
