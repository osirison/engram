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
});
