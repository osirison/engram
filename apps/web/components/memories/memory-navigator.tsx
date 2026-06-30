'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Database, Loader2, Search, Sparkles, X } from 'lucide-react';

import { MemoryDetailSheet } from '@/components/memories/memory-detail-sheet';
import { MemoryFiltersBar } from '@/components/memories/memory-filters';
import { MemoryList } from '@/components/memories/memory-list';
import { PageContainer, PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUserScope } from '@/components/user-scope';
import { formatNumber } from '@/lib/format';
import {
  rangeToDateFrom,
  type MemoryFilters,
  type OrderKey,
  type RangeKey,
  type SortKey,
  type MemoryTypeFilter,
} from '@/lib/memory-filters';
import { trpc } from '@/trpc/react';

function parseFilters(params: URLSearchParams): MemoryFilters {
  const type = params.get('type');
  const range = params.get('range');
  const sort: SortKey = params.get('sort') === 'updatedAt' ? 'updatedAt' : 'createdAt';
  // The only offered sorts are createdAt asc/desc and updatedAt desc, so force
  // desc for updatedAt to keep the Select bound to a real option.
  const order: OrderKey =
    sort === 'updatedAt' ? 'desc' : params.get('order') === 'asc' ? 'asc' : 'desc';
  return {
    q: params.get('q') ?? '',
    type: (['short-term', 'long-term'].includes(type ?? '') ? type : 'all') as MemoryTypeFilter,
    scope: params.get('scope') ?? '',
    range: (['24h', '7d', '30d', '90d'].includes(range ?? '') ? range : 'all') as RangeKey,
    tags: params.getAll('tag'),
    sort,
    order,
  };
}

export function MemoryNavigator() {
  const { userId } = useUserScope();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = React.useMemo(() => parseFilters(searchParams), [searchParams]);
  const [searchInput, setSearchInput] = React.useState(filters.q);

  // Keep the search box in sync when the URL changes (e.g. back/forward).
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchInput(filters.q);
  }, [filters.q]);

  const writeFilters = React.useCallback(
    (patch: Partial<MemoryFilters>) => {
      const next = { ...filters, ...patch };
      const sp = new URLSearchParams();
      if (next.q) sp.set('q', next.q);
      if (next.type !== 'all') sp.set('type', next.type);
      if (next.scope) sp.set('scope', next.scope);
      if (next.range !== 'all') sp.set('range', next.range);
      next.tags.forEach((tag) => sp.append('tag', tag));
      if (next.sort !== 'createdAt') sp.set('sort', next.sort);
      if (next.order !== 'desc') sp.set('order', next.order);
      const query = sp.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [filters, pathname, router]
  );

  // Stable per range so the query key doesn't churn every render.
  const dateFrom = React.useMemo(() => rangeToDateFrom(filters.range), [filters.range]);
  const enabled = userId.length > 0;
  const isSearch = filters.q.trim().length > 0;

  const list = trpc.memory.list.useInfiniteQuery(
    {
      userId,
      type: filters.type,
      tags: filters.tags.length ? filters.tags : undefined,
      scope: filters.scope || undefined,
      dateFrom,
      sortBy: filters.sort,
      sortOrder: filters.order,
      limit: 25,
    },
    {
      enabled: enabled && !isSearch,
      getNextPageParam: (last) => last.nextCursor,
    }
  );

  const search = trpc.memory.search.useQuery(
    {
      userId,
      query: filters.q,
      tags: filters.tags.length ? filters.tags : undefined,
      scope: filters.scope || undefined,
      dateFrom,
      limit: 30,
    },
    { enabled: enabled && isSearch }
  );

  const items = isSearch
    ? (search.data?.items ?? [])
    : (list.data?.pages.flatMap((p) => p.items) ?? []);
  const total = isSearch ? search.data?.count : list.data?.pages[0]?.totalCount;
  const isLoading = isSearch ? search.isLoading : list.isLoading;
  const queryError = isSearch ? search.error : list.error;

  const [selected, setSelected] = React.useState<{ id: string; score?: number | null } | null>(
    null
  );

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    writeFilters({ q: searchInput.trim() });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Memories"
        description={
          enabled ? `Browsing memories for ${userId}` : 'Browse, search, and manage memories'
        }
      />

      {!enabled ? (
        <EmptyState
          icon={Database}
          title="Select a data owner"
          description="Choose a userId from the switcher in the header to browse memories."
        />
      ) : (
        <div className="space-y-4">
          <form onSubmit={submitSearch} className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search memories semantically… (press Enter)"
              className="h-10 pl-9 pr-24"
              aria-label="Search memories"
            />
            {isSearch && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchInput('');
                  writeFilters({ q: '' });
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                <X className="size-3.5" /> Clear
              </Button>
            )}
          </form>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <MemoryFiltersBar filters={filters} onChange={writeFilters} searching={isSearch} />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {isSearch && search.data && (
                <Badge variant={search.data.semantic ? 'success' : 'muted'}>
                  <Sparkles className="size-3" />
                  {search.data.semantic ? 'Semantic' : 'Keyword'}
                </Badge>
              )}
              {total !== undefined && (
                <span>
                  {formatNumber(total)} result{total === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </div>

          {queryError ? (
            <ErrorState
              message={queryError.message}
              onRetry={() => (isSearch ? void search.refetch() : void list.refetch())}
            />
          ) : !isLoading && items.length === 0 ? (
            <EmptyState
              icon={isSearch ? Search : Database}
              title={isSearch ? 'No matching memories' : 'No memories found'}
              description={
                isSearch
                  ? 'Try a different query or relax your filters.'
                  : 'No memories match the current filters for this user.'
              }
            />
          ) : (
            <>
              <MemoryList
                items={items}
                showScore={isSearch}
                isLoading={isLoading}
                onSelect={(item) => setSelected({ id: item.id, score: item.score ?? null })}
              />

              {!isSearch && list.hasNextPage && (
                <div className="flex justify-center pt-1">
                  <Button
                    variant="outline"
                    onClick={() => void list.fetchNextPage()}
                    disabled={list.isFetchingNextPage}
                  >
                    {list.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />}
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <MemoryDetailSheet
        userId={userId}
        memoryId={selected?.id ?? null}
        score={selected?.score}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </PageContainer>
  );
}
