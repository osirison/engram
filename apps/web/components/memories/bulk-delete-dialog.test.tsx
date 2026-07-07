import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BulkDeleteDialog } from './bulk-delete-dialog';

function renderDialog(count: number, onConfirm = vi.fn()) {
  render(
    <BulkDeleteDialog
      open
      onOpenChange={vi.fn()}
      count={count}
      previews={['first memory', 'second memory']}
      isPending={false}
      onConfirm={onConfirm}
    />
  );
  return onConfirm;
}

describe('BulkDeleteDialog (WP2 T6)', () => {
  it('confirms immediately for a small selection (≤10)', () => {
    const onConfirm = renderDialog(3);
    // No type-to-confirm input for small selections.
    expect(screen.queryByLabelText('Type delete to confirm')).not.toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /Delete 3/ });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('gates a large selection (>10) behind typing "delete"', () => {
    const onConfirm = renderDialog(25);
    const confirm = screen.getByRole('button', { name: /Delete 25/ });
    // Disabled until the confirm word is typed.
    expect(confirm).toBeDisabled();

    const input = screen.getByLabelText('Type delete to confirm');
    fireEvent.change(input, { target: { value: 'nope' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: 'delete' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('shows a count and a preview list with an overflow hint', () => {
    renderDialog(7);
    expect(screen.getByText('Delete 7 memories?')).toBeInTheDocument();
    expect(screen.getByText('first memory')).toBeInTheDocument();
    // 7 selected, 2 previews shown → "and 5 more".
    expect(screen.getByText(/and 5 more/)).toBeInTheDocument();
  });

  it('switches to an outcome view with an expandable failure list on partial failure', () => {
    render(
      <BulkDeleteDialog
        open
        onOpenChange={vi.fn()}
        count={0}
        previews={[]}
        isPending={false}
        onConfirm={vi.fn()}
        result={{
          deleted: ['a', 'b'],
          failed: [
            { id: 'gone-1', reason: 'not-found' },
            { id: 'boom-1', reason: 'db exploded' },
          ],
        }}
      />
    );
    // Heading reports "Deleted X of N" (2 of 4) and the failure list is present.
    expect(screen.getByText('Deleted 2 of 4')).toBeInTheDocument();
    expect(screen.getByText('gone-1')).toBeInTheDocument();
    expect(screen.getByText('not-found')).toBeInTheDocument();
    expect(screen.getByText('boom-1')).toBeInTheDocument();
    expect(screen.getByText('db exploded')).toBeInTheDocument();
    // The confirmation footer is replaced by a Done button (no Delete action).
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
  });

  it('shows the confirmation view (not the outcome view) when a result has no failures', () => {
    render(
      <BulkDeleteDialog
        open
        onOpenChange={vi.fn()}
        count={3}
        previews={['first memory']}
        isPending={false}
        onConfirm={vi.fn()}
        result={{ deleted: ['a', 'b', 'c'], failed: [] }}
      />
    );
    expect(screen.getByText('Delete 3 memories?')).toBeInTheDocument();
  });
});
