import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StmStrip } from './stm-strip';

const h = vi.hoisted(() => ({ result: undefined as unknown }));

vi.mock('@/trpc/react', () => ({
  trpc: {
    memory: {
      listStm: { useQuery: () => h.result },
    },
  },
}));

function stmItem(id: string, content: string, expiresAt: string) {
  return {
    id,
    userId: 'qp',
    organizationId: null,
    scope: null,
    content,
    type: 'short-term' as const,
    tags: [],
    metadata: null,
    importance: null,
    hasEmbedding: false,
    embeddingStale: false,
    isInsight: false,
    version: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    expiresAt,
    ttlSeconds: 3600,
    accessCount: 0,
  };
}

describe('StmStrip (WP2 T3)', () => {
  beforeEach(() => {
    h.result = undefined;
  });

  it('lists live short-term items and links out to the full tab', () => {
    h.result = {
      data: {
        items: [stmItem('s1', 'live note one', '2999-01-01T00:00:00.000Z')],
        totalCount: 1,
        nextCursor: null,
        hasMore: false,
      },
      isLoading: false,
    };
    const onOpen = vi.fn();
    const onViewAll = vi.fn();
    render(<StmStrip userId="qp" onOpen={onOpen} onViewAll={onViewAll} />);

    expect(screen.getByText('Live short-term')).toBeInTheDocument();
    fireEvent.click(screen.getByText('live note one'));
    expect(onOpen).toHaveBeenCalledWith('s1');
    fireEvent.click(screen.getByText('View all'));
    expect(onViewAll).toHaveBeenCalled();
  });

  it('renders nothing while loading or when there are no live items', () => {
    h.result = { data: { items: [] }, isLoading: false };
    const { container } = render(<StmStrip userId="qp" onOpen={vi.fn()} onViewAll={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
