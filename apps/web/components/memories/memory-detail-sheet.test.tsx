import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RouterOutputs } from '@/server/trpc/root';
import { MemoryDetailSheet, evictMemoryFromCacheData } from './memory-detail-sheet';

// The component calls useQueryClient() at render (optimistic delete, WP2 T8), so
// every render needs a provider. getQueryKey works on the mocked trpc proxy.
function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// Capture the update mutation's callbacks/mutate so the test can drive them.
const h = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  reembedMutate: vi.fn(),
  promoteMutate: vi.fn(),
  onError: undefined as ((e: unknown) => void) | undefined,
  refetch: vi.fn(),
  memory: undefined as unknown,
}));

vi.mock('@/trpc/react', () => {
  const noopQuery = { invalidate: vi.fn().mockResolvedValue(undefined) };
  return {
    trpc: {
      useUtils: () => ({
        memory: { list: noopQuery, listStm: noopQuery, search: noopQuery, get: noopQuery },
        analytics: { invalidate: vi.fn().mockResolvedValue(undefined) },
      }),
      meta: { capabilities: { useQuery: () => ({ data: { writes: true } }) } },
      memory: {
        get: {
          useQuery: () => ({ data: h.memory, isLoading: false, refetch: h.refetch }),
        },
        update: {
          // Called twice per render (the primary `update` and the TTL-extend
          // mutation both use memory.update); capture only the first onError —
          // the primary update's CONFLICT handler the conflict tests drive.
          useMutation: (opts: { onError?: (e: unknown) => void }) => {
            if (h.onError === undefined) h.onError = opts.onError;
            return { mutate: h.updateMutate, isPending: false };
          },
        },
        delete: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        reembed: {
          useMutation: () => ({ mutate: h.reembedMutate, isPending: false }),
        },
        auditLog: {
          useQuery: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
        },
        restore: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        promote: {
          useMutation: () => ({ mutate: h.promoteMutate, isPending: false }),
        },
      },
    },
  };
});

type MemoryItem = RouterOutputs['memory']['get'];

const fixture = (overrides: Partial<MemoryItem> = {}): MemoryItem => ({
  id: 'm1',
  userId: 'qp',
  organizationId: null,
  scope: null,
  content: 'original content',
  type: 'long-term',
  tags: ['a'],
  metadata: null,
  importance: null,
  hasEmbedding: true,
  embeddingStale: false,
  isInsight: false,
  version: 3,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  expiresAt: null,
  ttlSeconds: null,
  accessCount: null,
  ...overrides,
});

describe('MemoryDetailSheet — version conflict (WP2 T4)', () => {
  beforeEach(() => {
    h.updateMutate.mockReset();
    h.reembedMutate.mockReset();
    h.promoteMutate.mockReset();
    h.refetch.mockReset();
    h.onError = undefined;
    h.memory = fixture();
  });

  it('offers Promote + TTL affordances for a short-term memory (WP2 T3)', () => {
    h.memory = fixture({
      type: 'short-term',
      ttlSeconds: 3600,
      expiresAt: '2999-01-01T00:00:00.000Z',
    });
    renderWithClient(<MemoryDetailSheet userId="qp" memoryId="m1" open onOpenChange={vi.fn()} />);
    expect(screen.getByText('Promote to long-term')).toBeInTheDocument();

    fireEvent.click(screen.getByText('+1h TTL'));
    // Extend resets the window to remaining + 1h (3600 + 3600).
    expect(h.updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ memoryId: 'm1', ttl: 7200 })
    );

    fireEvent.click(screen.getByText('Promote to long-term'));
    expect(h.promoteMutate).toHaveBeenCalledWith({ userId: 'qp', memoryId: 'm1' });
  });

  it('does not offer Promote/TTL for a long-term memory (WP2 T3)', () => {
    h.memory = fixture({ type: 'long-term' });
    renderWithClient(<MemoryDetailSheet userId="qp" memoryId="m1" open onOpenChange={vi.fn()} />);
    expect(screen.queryByText('Promote to long-term')).not.toBeInTheDocument();
    expect(screen.queryByText('+1h TTL')).not.toBeInTheDocument();
  });

  it('preserves the remaining TTL window on an STM save, not the full stored window (WP2 T3/D4)', () => {
    // The stored window is 3600s but only ~1800s remain. A plain console save
    // must send the REMAINING window so the store keeps the current expiry —
    // sending 3600 would reset the expiry to a full window (the D4 regression).
    const expiresAt = new Date(Date.now() + 1800_000).toISOString();
    h.memory = fixture({ type: 'short-term', ttlSeconds: 3600, expiresAt });
    renderWithClient(<MemoryDetailSheet userId="qp" memoryId="m1" open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByText('Edit'));
    // The TTL input is prefilled with the remaining seconds (~1800), not 3600.
    const ttlInput = screen.getByLabelText('TTL in seconds') as HTMLInputElement;
    expect(Number(ttlInput.value)).toBeGreaterThanOrEqual(1795);
    expect(Number(ttlInput.value)).toBeLessThanOrEqual(1800);

    fireEvent.click(screen.getByText('Save changes'));
    const arg = h.updateMutate.mock.calls.at(-1)?.[0] as { ttl?: number };
    expect(arg.ttl).toBeGreaterThanOrEqual(1795);
    expect(arg.ttl).toBeLessThanOrEqual(1800);
    expect(arg.ttl).not.toBe(3600);
  });

  it('honors an operator-overridden TTL on an STM save (WP2 T3/D4)', () => {
    h.memory = fixture({
      type: 'short-term',
      ttlSeconds: 3600,
      expiresAt: new Date(Date.now() + 1800_000).toISOString(),
    });
    renderWithClient(<MemoryDetailSheet userId="qp" memoryId="m1" open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.change(screen.getByLabelText('TTL in seconds'), { target: { value: '120' } });
    fireEvent.click(screen.getByText('Save changes'));
    expect(h.updateMutate).toHaveBeenLastCalledWith(expect.objectContaining({ ttl: 120 }));
  });

  it('renders no TTL input and threads no ttl for a long-term memory (WP2 T3)', () => {
    h.memory = fixture({ type: 'long-term' });
    renderWithClient(<MemoryDetailSheet userId="qp" memoryId="m1" open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.queryByLabelText('TTL in seconds')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Save changes'));
    const arg = h.updateMutate.mock.calls.at(-1)?.[0] as { ttl?: number };
    expect(arg.ttl).toBeUndefined();
  });

  it('shows a stale-vector badge and a Re-embed action that calls the mutation', () => {
    h.memory = fixture({ embeddingStale: true });
    renderWithClient(<MemoryDetailSheet userId="qp" memoryId="m1" open onOpenChange={vi.fn()} />);
    expect(screen.getByText(/Stale — content changed but the vector/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Re-embed'));
    expect(h.reembedMutate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'qp', memoryId: 'm1' })
    );
  });

  it('does not offer Re-embed when the vector is healthy', () => {
    h.memory = fixture({ embeddingStale: false, hasEmbedding: true });
    renderWithClient(<MemoryDetailSheet userId="qp" memoryId="m1" open onOpenChange={vi.fn()} />);
    expect(screen.queryByText('Re-embed')).not.toBeInTheDocument();
  });

  it('sends expectedVersion from the loaded memory on save', async () => {
    renderWithClient(<MemoryDetailSheet userId="qp" memoryId="m1" open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save changes'));
    expect(h.updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ memoryId: 'm1', expectedVersion: 3 })
    );
  });

  it('shows the conflict panel with a Reload button when the save returns CONFLICT', async () => {
    renderWithClient(<MemoryDetailSheet userId="qp" memoryId="m1" open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save changes'));

    // Simulate the tRPC mutation rejecting with a CONFLICT code.
    act(() => {
      h.onError?.({ data: { code: 'CONFLICT' } });
    });

    expect(screen.getByText(/This memory changed since you opened it/)).toBeInTheDocument();
    expect(screen.getByText('Reload latest')).toBeInTheDocument();
  });

  it('preserves the operator’s unsaved text after reloading the latest version', async () => {
    h.refetch.mockResolvedValue({ data: fixture({ content: 'server content', version: 4 }) });
    renderWithClient(<MemoryDetailSheet userId="qp" memoryId="m1" open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));
    const textarea = screen.getByLabelText('Memory content');
    fireEvent.change(textarea, { target: { value: 'my unsaved edit' } });
    fireEvent.click(screen.getByText('Save changes'));
    act(() => {
      h.onError?.({ data: { code: 'CONFLICT' } });
    });

    fireEvent.click(screen.getByText('Reload latest'));

    await waitFor(() => expect(screen.getByText('Your previous unsaved edit')).toBeInTheDocument());
    // The stashed draft is shown; the editor now holds the server's latest text.
    expect(screen.getByText('my unsaved edit')).toBeInTheDocument();
    expect(screen.getByLabelText('Memory content')).toHaveValue('server content');
  });
});

describe('evictMemoryFromCacheData — optimistic-delete surgery (WP2 T8)', () => {
  it('removes the id from every page of an infinite-list cache', () => {
    const infinite = {
      pageParams: [undefined, 'c1'],
      pages: [
        { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'c1' },
        { items: [{ id: 'b' }, { id: 'c' }], nextCursor: null },
      ],
    };
    const next = evictMemoryFromCacheData(infinite, 'b') as typeof infinite;
    expect(next.pages[0]!.items).toEqual([{ id: 'a' }]);
    expect(next.pages[1]!.items).toEqual([{ id: 'c' }]);
    // pageParams and other fields are preserved.
    expect(next.pageParams).toEqual([undefined, 'c1']);
  });

  it('removes the id from a single-shot search cache', () => {
    const search = { count: 2, semantic: true, items: [{ id: 'x' }, { id: 'y' }] };
    const next = evictMemoryFromCacheData(search, 'x') as typeof search;
    expect(next.items).toEqual([{ id: 'y' }]);
    expect(next.semantic).toBe(true);
  });

  it('leaves unrelated / empty cache data untouched', () => {
    expect(evictMemoryFromCacheData(undefined, 'x')).toBeUndefined();
    expect(evictMemoryFromCacheData({ foo: 1 }, 'x')).toEqual({ foo: 1 });
  });
});
