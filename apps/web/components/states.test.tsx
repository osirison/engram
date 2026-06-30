import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EmptyState, ErrorState } from './states';

describe('EmptyState', () => {
  it('renders the title and description', () => {
    render(<EmptyState title="Nothing here" description="No memories yet" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('No memories yet')).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('renders the message and fires retry', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="boom" onRetry={onRetry} />);
    expect(screen.getByText('boom')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('omits the retry button when no handler is given', () => {
    render(<ErrorState message="boom" />);
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
});
