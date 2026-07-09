'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, Search, UserRound } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useUserScope } from '@/components/user-scope';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { trpc } from '@/trpc/react';

/**
 * Switches the active data owner (`userId`). Lists known owners with their
 * memory counts and accepts a free-text userId for owners not yet in the list.
 */
export function ScopeSwitcher() {
  const { userId, setUserId } = useUserScope();
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const owners = trpc.meta.owners.useQuery(undefined, { staleTime: 60_000 });
  // The data owners this operator may manage (WP2 T9). `'*'` when unbound; the
  // server (`assertCanManageUser`) is the real boundary, so this only keeps the
  // free-text entry honest rather than letting it target a forbidden tenant.
  const allowedTenants = trpc.meta.allowedTenants.useQuery(undefined, { staleTime: 60_000 });
  const bound = Array.isArray(allowedTenants.data);

  // Permissive while the binding is still loading or unset — a bound operator
  // only ever gets forbidden values blocked here, never their own tenants.
  const isAllowed = React.useCallback(
    (value: string) => {
      const allowed = allowedTenants.data;
      if (allowed === undefined || allowed === '*') return true;
      return allowed.includes(value);
    },
    [allowedTenants.data]
  );

  const filtered = React.useMemo(() => {
    const list = owners.data ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((o) => o.userId.toLowerCase().includes(q));
  }, [owners.data, filter]);

  const select = (next: string) => {
    const value = next.trim();
    if (!value || !isAllowed(value)) return;
    setUserId(value);
    setOpen(false);
    setFilter('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Select data owner"
          aria-expanded={open}
          className="h-8 max-w-[220px] justify-between gap-2 font-normal"
        >
          <UserRound className="text-muted-foreground" />
          <span className="truncate">{userId || 'Select a user'}</span>
          <ChevronsUpDown className="ml-auto size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') select(filter);
              }}
              placeholder="Find or enter a userId…"
              className="h-8 pl-8"
            />
          </div>
        </div>
        <ScrollArea className="max-h-64">
          <div className="p-1">
            {owners.isLoading && (
              <p className="px-2 py-3 text-sm text-muted-foreground">Loading owners…</p>
            )}
            {!owners.isLoading && filtered.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                {filter.trim()
                  ? isAllowed(filter.trim())
                    ? `Press Enter to view "${filter.trim()}"`
                    : `You are not permitted to manage "${filter.trim()}".`
                  : 'No data owners found yet.'}
              </p>
            )}
            {filtered.map((owner) => (
              <button
                key={owner.userId}
                type="button"
                onClick={() => select(owner.userId)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                  owner.userId === userId && 'bg-accent'
                )}
              >
                <Check
                  className={cn(
                    'size-4 shrink-0',
                    owner.userId === userId ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <span className="truncate font-mono text-xs">{owner.userId}</span>
                <Badge variant="muted" className="ml-auto shrink-0">
                  {formatNumber(owner.count)}
                </Badge>
              </button>
            ))}
          </div>
        </ScrollArea>
        {bound && (
          <p className="border-t px-2 py-1.5 text-xs text-muted-foreground">
            Limited to your assigned data owner
            {(allowedTenants.data as string[]).length === 1 ? '' : 's'}.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
