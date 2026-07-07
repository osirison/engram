import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScopeSwitcher } from './scope-switcher';

const h = vi.hoisted(() => ({
  setUserId: vi.fn(),
  owners: [] as Array<{ userId: string; count: number }>,
  allowed: '*' as '*' | string[],
}));

vi.mock('@/components/user-scope', () => ({
  useUserScope: () => ({ userId: 'qp', setUserId: h.setUserId }),
}));

// Render the popover inline so the filter input is always reachable (Radix
// portals + pointer events are awkward under the test DOM).
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/trpc/react', () => ({
  trpc: {
    meta: {
      owners: { useQuery: () => ({ data: h.owners, isLoading: false }) },
      allowedTenants: { useQuery: () => ({ data: h.allowed }) },
    },
  },
}));

describe('ScopeSwitcher — tenant gate (WP2 T9)', () => {
  beforeEach(() => {
    h.setUserId.mockReset();
    h.owners = [];
    h.allowed = '*';
  });

  it('allows free-text entry of any owner when unbound (allowedTenants = *)', () => {
    h.allowed = '*';
    render(<ScopeSwitcher />);
    const input = screen.getByPlaceholderText('Find or enter a userId…');
    fireEvent.change(input, { target: { value: 'newuser' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.setUserId).toHaveBeenCalledWith('newuser');
  });

  it('blocks free-text entry of a forbidden tenant when bound', () => {
    h.allowed = ['qp'];
    render(<ScopeSwitcher />);
    const input = screen.getByPlaceholderText('Find or enter a userId…');
    fireEvent.change(input, { target: { value: 'other' } });
    expect(screen.getByText(/not permitted to manage "other"/)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.setUserId).not.toHaveBeenCalled();
  });

  it('allows entry of a bound tenant', () => {
    h.allowed = ['qp'];
    render(<ScopeSwitcher />);
    const input = screen.getByPlaceholderText('Find or enter a userId…');
    fireEvent.change(input, { target: { value: 'qp' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.setUserId).toHaveBeenCalledWith('qp');
  });
});
