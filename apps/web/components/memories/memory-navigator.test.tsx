import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryNavigator } from './memory-navigator';

// Capture the `enabled` flag each data source receives so we can assert which
// tier the navigator queries for a given filter state (WP2 T3/D3 source switch).
const h = vi.hoisted(() => ({
  listEnabled: undefined as boolean | undefined,
  stmEnabled: undefined as boolean | undefined,
  searchEnabled: undefined as boolean | undefined,
  params: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/memories',
  useSearchParams: () => h.params,
}));

vi.mock('@/components/user-scope', () => ({
  useUserScope: () => ({ userId: 'qp', setUserId: vi.fn() }),
}));

// Mock the trpc-heavy children so the test targets the navigator's own routing.
vi.mock('@/components/memories/memory-detail-sheet', () => ({ MemoryDetailSheet: () => null }));
vi.mock('@/components/memories/stm-strip', () => ({ StmStrip: () => null }));
vi.mock('@/components/memories/export-dialog', () => ({ ExportDialog: () => null }));
vi.mock('@/components/memories/bulk-delete-dialog', () => ({ BulkDeleteDialog: () => null }));

vi.mock('@/trpc/react', () => {
  const emptyInfinite = {
    data: { pages: [{ items: [], totalCount: 0 }] },
    isLoading: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  };
  const emptyQuery = { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
  const noop = { invalidate: vi.fn().mockResolvedValue(undefined) };
  type Opts = { enabled?: boolean };
  return {
    trpc: {
      useUtils: () => ({
        memory: { list: noop, listStm: noop, search: noop },
        analytics: { invalidate: vi.fn().mockResolvedValue(undefined) },
      }),
      memory: {
        list: {
          useInfiniteQuery: (_input: unknown, opts?: Opts) => {
            h.listEnabled = opts?.enabled;
            return emptyInfinite;
          },
        },
        listStm: {
          useInfiniteQuery: (_input: unknown, opts?: Opts) => {
            h.stmEnabled = opts?.enabled;
            return emptyInfinite;
          },
        },
        search: {
          useQuery: (_input: unknown, opts?: Opts) => {
            h.searchEnabled = opts?.enabled;
            return emptyQuery;
          },
        },
        bulkDelete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        export: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  };
});

describe('MemoryNavigator — tier source switch (WP2 T3/D3)', () => {
  beforeEach(() => {
    h.listEnabled = undefined;
    h.stmEnabled = undefined;
    h.searchEnabled = undefined;
  });

  it('queries the persisted (Postgres) list on the default "all" view', () => {
    h.params = new URLSearchParams();
    render(<MemoryNavigator />);
    expect(h.listEnabled).toBe(true);
    expect(h.stmEnabled).toBe(false);
    expect(h.searchEnabled).toBe(false);
  });

  it('switches to the live short-term (Redis) source when type=short-term', () => {
    h.params = new URLSearchParams('type=short-term');
    render(<MemoryNavigator />);
    expect(h.stmEnabled).toBe(true);
    expect(h.listEnabled).toBe(false);
    expect(h.searchEnabled).toBe(false);
  });

  it('keeps the persisted list (not STM) for type=long-term', () => {
    h.params = new URLSearchParams('type=long-term');
    render(<MemoryNavigator />);
    expect(h.listEnabled).toBe(true);
    expect(h.stmEnabled).toBe(false);
  });

  it('routes to semantic search — never a list source — when a query is present', () => {
    // Even a short-term filter yields to search: STM is not vector-indexed (D3).
    h.params = new URLSearchParams('type=short-term&q=hello');
    render(<MemoryNavigator />);
    expect(h.searchEnabled).toBe(true);
    expect(h.listEnabled).toBe(false);
    expect(h.stmEnabled).toBe(false);
  });
});
