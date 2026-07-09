import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ExportDialog } from './export-dialog';

function renderDialog(isPending = false, onConfirm = vi.fn()) {
  render(<ExportDialog open onOpenChange={vi.fn()} isPending={isPending} onConfirm={onConfirm} />);
  return onConfirm;
}

describe('ExportDialog (WP3 T8)', () => {
  it('renders the title and all option toggles', () => {
    renderDialog();
    expect(screen.getByText('Export memories')).toBeInTheDocument();
    expect(screen.getByLabelText('Include short-term memories')).toBeInTheDocument();
    expect(screen.getByLabelText('Export as a single file')).toBeInTheDocument();
    expect(screen.getByLabelText('Include edit history')).toBeInTheDocument();
  });

  it('confirms with default options (LTM, multi-file, no history)', () => {
    const onConfirm = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    expect(onConfirm).toHaveBeenCalledWith({
      includeStm: false,
      singleFile: false,
      includeHistory: false,
    });
  });

  it('confirms with STM + single-file + history when all toggles are checked', () => {
    const onConfirm = renderDialog();
    fireEvent.click(screen.getByLabelText('Include short-term memories'));
    fireEvent.click(screen.getByLabelText('Export as a single file'));
    fireEvent.click(screen.getByLabelText('Include edit history'));
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    expect(onConfirm).toHaveBeenCalledWith({
      includeStm: true,
      singleFile: true,
      includeHistory: true,
    });
  });

  it('disables the Export button while a request is pending', () => {
    renderDialog(true);
    expect(screen.getByRole('button', { name: /Export/ })).toBeDisabled();
  });
});
