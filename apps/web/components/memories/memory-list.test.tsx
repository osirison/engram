import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RouterOutputs } from '@/server/trpc/root';
import { MemoryList } from './memory-list';

type MemoryItem = RouterOutputs['memory']['list']['items'][number];

function item(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'm1',
    userId: 'qp',
    organizationId: null,
    scope: null,
    content: 'first memory',
    type: 'long-term',
    tags: ['alpha'],
    metadata: null,
    importance: null,
    hasEmbedding: true,
    isInsight: false,
    version: 1,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    expiresAt: null,
    ttlSeconds: null,
    accessCount: null,
    ...overrides,
  };
}

describe('MemoryList', () => {
  it('renders rows with content and tags', () => {
    render(
      <MemoryList
        items={[item(), item({ id: 'm2', content: 'second memory', tags: [] })]}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('first memory')).toBeInTheDocument();
    expect(screen.getByText('second memory')).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });

  it('calls onSelect when a row is activated', () => {
    const onSelect = vi.fn();
    render(<MemoryList items={[item()]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('first memory'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
  });

  it('shows a Relevance column only in score mode', () => {
    const { rerender } = render(<MemoryList items={[item()]} onSelect={vi.fn()} />);
    expect(screen.queryByText('Relevance')).not.toBeInTheDocument();
    rerender(<MemoryList items={[item({ score: 0.92 })]} showScore onSelect={vi.fn()} />);
    expect(screen.getByText('Relevance')).toBeInTheDocument();
    expect(screen.getByText('92.0%')).toBeInTheDocument();
  });

  it('renders skeleton placeholders while loading', () => {
    const { container } = render(<MemoryList items={[]} isLoading onSelect={vi.fn()} />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
