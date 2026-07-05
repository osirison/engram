import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RouterOutputs } from '@/server/trpc/root';
import { MemoryDetailSheet } from './memory-detail-sheet';

// Capture the update mutation's callbacks/mutate so the test can drive them.
const h = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  reembedMutate: vi.fn(),
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
          useMutation: (opts: { onError?: (e: unknown) => void }) => {
            h.onError = opts.onError;
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
    h.refetch.mockReset();
    h.onError = undefined;
    h.memory = fixture();
  });

  it('shows a stale-vector badge and a Re-embed action that calls the mutation', () => {
    h.memory = fixture({ embeddingStale: true });
    render(<MemoryDetailSheet userId="qp" memoryId="m1" open onOpenChange={vi.fn()} />);
    expect(screen.getByText(/Stale — content changed but the vector/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Re-embed'));
    expect(h.reembedMutate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'qp', memoryId: 'm1' })
    );
  });

  it('does not offer Re-embed when the vector is healthy', () => {
    h.memory = fixture({ embeddingStale: false, hasEmbedding: true });
    render(<MemoryDetailSheet userId="qp" memoryId="m1" open onOpenChange={vi.fn()} />);
    expect(screen.queryByText('Re-embed')).not.toBeInTheDocument();
  });

  it('sends expectedVersion from the loaded memory on save', async () => {
    render(<MemoryDetailSheet userId="qp" memoryId="m1" open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save changes'));
    expect(h.updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ memoryId: 'm1', expectedVersion: 3 })
    );
  });

  it('shows the conflict panel with a Reload button when the save returns CONFLICT', async () => {
    render(<MemoryDetailSheet userId="qp" memoryId="m1" open onOpenChange={vi.fn()} />);
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
    render(<MemoryDetailSheet userId="qp" memoryId="m1" open onOpenChange={vi.fn()} />);
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
