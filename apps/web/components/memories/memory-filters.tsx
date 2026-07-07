'use client';

import * as React from 'react';
import { Tag, X } from 'lucide-react';

import { TagInput } from '@/components/memories/tag-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  RANGE_OPTIONS,
  SORT_OPTIONS,
  TYPE_OPTIONS,
  type MemoryFilters,
  type OrderKey,
  type RangeKey,
  type SortKey,
  type MemoryTypeFilter,
} from '@/lib/memory-filters';

export function MemoryFiltersBar({
  filters,
  onChange,
  searching = false,
  stmView = false,
}: {
  filters: MemoryFilters;
  onChange: (patch: Partial<MemoryFilters>) => void;
  /** In semantic-search mode, type and sort don't apply, so they're disabled. */
  searching?: boolean;
  /** On the live short-term tier, SCAN order is undefined and rows are sorted
   *  client-side by expiry — so sort + date-range don't apply (WP2 T3/D3). */
  stmView?: boolean;
}) {
  const active = activeFilterCount(filters);

  // Scope types into local state and commits on blur/Enter, so each keystroke
  // doesn't rewrite the URL and refetch.
  const [scopeDraft, setScopeDraft] = React.useState(filters.scope);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScopeDraft(filters.scope);
  }, [filters.scope]);
  const commitScope = () => {
    if (scopeDraft !== filters.scope) onChange({ scope: scopeDraft });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={filters.type}
        disabled={searching}
        onValueChange={(value) => onChange({ type: value as MemoryTypeFilter })}
      >
        <SelectTrigger
          size="sm"
          className="w-[140px]"
          title={searching ? 'Type filter does not apply to semantic search' : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TYPE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.range}
        disabled={stmView}
        onValueChange={(value) => onChange({ range: value as RangeKey })}
      >
        <SelectTrigger
          size="sm"
          className="w-[150px]"
          title={stmView ? 'Date range does not apply to the live short-term tier' : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={`${filters.sort}:${filters.order}`}
        disabled={searching || stmView}
        onValueChange={(value) => {
          const [sort, order] = value.split(':') as [SortKey, OrderKey];
          onChange({ sort, order });
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-[160px]"
          title={
            searching
              ? 'Sort does not apply to semantic search (ranked by relevance)'
              : stmView
                ? 'Short-term items are ordered by time to expiry'
                : undefined
          }
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        value={scopeDraft}
        onChange={(e) => setScopeDraft(e.target.value)}
        onBlur={commitScope}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitScope();
          }
        }}
        placeholder="Scope…"
        aria-label="Filter by scope"
        className="h-8 w-[140px]"
      />

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Tag className="size-3.5" />
            Tags
            {filters.tags.length > 0 && (
              <Badge variant="secondary" className="ml-0.5">
                {filters.tags.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <p className="mb-2 text-xs text-muted-foreground">Show memories tagged with all of:</p>
          <TagInput value={filters.tags} onChange={(tags) => onChange({ tags })} />
        </PopoverContent>
      </Popover>

      {active > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() =>
            onChange({
              type: DEFAULT_FILTERS.type,
              scope: DEFAULT_FILTERS.scope,
              range: DEFAULT_FILTERS.range,
              tags: DEFAULT_FILTERS.tags,
            })
          }
        >
          <X className="size-3.5" /> Clear
        </Button>
      )}
    </div>
  );
}
