export type MemoryTypeFilter = 'all' | 'short-term' | 'long-term';
export type RangeKey = 'all' | '24h' | '7d' | '30d' | '90d';
export type SortKey = 'createdAt' | 'updatedAt';
export type OrderKey = 'asc' | 'desc';

export interface MemoryFilters {
  q: string;
  type: MemoryTypeFilter;
  scope: string;
  range: RangeKey;
  tags: string[];
  sort: SortKey;
  order: OrderKey;
}

export const DEFAULT_FILTERS: MemoryFilters = {
  q: '',
  type: 'all',
  scope: '',
  range: 'all',
  tags: [],
  sort: 'createdAt',
  order: 'desc',
};

export const TYPE_OPTIONS: { value: MemoryTypeFilter; label: string }[] = [
  // 'all' shows the persisted (Postgres) list plus a live short-term strip above
  // it — the STM tier is a separate live source (WP2 T3/D3).
  { value: 'all', label: 'All (persisted)' },
  { value: 'long-term', label: 'Long-term' },
  { value: 'short-term', label: 'Short-term (live)' },
];

export const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

export const SORT_OPTIONS: { value: `${SortKey}:${OrderKey}`; label: string }[] = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
  { value: 'updatedAt:desc', label: 'Recently updated' },
];

const RANGE_DAYS: Record<Exclude<RangeKey, 'all'>, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** Convert a range preset into an ISO `dateFrom`, anchored to now. */
export function rangeToDateFrom(range: RangeKey, now: number = Date.now()): string | undefined {
  if (range === 'all') return undefined;
  return new Date(now - RANGE_DAYS[range] * 86_400_000).toISOString();
}

/** Number of filters (beyond the search query) currently narrowing the view. */
export function activeFilterCount(filters: MemoryFilters): number {
  let count = 0;
  if (filters.type !== 'all') count += 1;
  if (filters.scope.trim()) count += 1;
  if (filters.range !== 'all') count += 1;
  count += filters.tags.length;
  return count;
}
