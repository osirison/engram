'use client';

import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import type { RouterOutputs } from '@/server/trpc/root';
import { formatPercent, memoryTypeLabel, relativeTime, truncate } from '@/lib/format';

type MemoryItem = RouterOutputs['memory']['list']['items'][number];

/**
 * Optional multi-select support (WP2 T6). When passed, the list renders a
 * checkbox column with a select-page header. Omitted ⇒ the list behaves exactly
 * as before (no selection column), keeping non-bulk callers unchanged.
 */
export interface MemoryListSelection {
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onTogglePage: (ids: string[], select: boolean) => void;
}

export function MemoryList({
  items,
  showScore = false,
  isLoading = false,
  onSelect,
  selection,
}: {
  items: MemoryItem[];
  showScore?: boolean;
  isLoading?: boolean;
  onSelect: (item: MemoryItem) => void;
  selection?: MemoryListSelection;
}) {
  const pageIds = items.map((i) => i.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selection?.selectedIds.has(id));
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {selection && (
              <TableHead className="w-[44px]">
                <Checkbox
                  checked={allSelected}
                  aria-label="Select all on this page"
                  onCheckedChange={(checked) => selection.onTogglePage(pageIds, checked === true)}
                />
              </TableHead>
            )}
            <TableHead className="min-w-[280px]">Memory</TableHead>
            <TableHead className="w-[110px]">Type</TableHead>
            <TableHead className="hidden w-[140px] md:table-cell">Scope</TableHead>
            {showScore && <TableHead className="w-[100px]">Relevance</TableHead>}
            <TableHead className="hidden w-[120px] text-right sm:table-cell">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={`s-${i}`}>
                  {selection && (
                    <TableCell>
                      <Skeleton className="size-4" />
                    </TableCell>
                  )}
                  <TableCell>
                    <Skeleton className="h-4 w-3/4" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-16" />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  {showScore && (
                    <TableCell>
                      <Skeleton className="h-4 w-10" />
                    </TableCell>
                  )}
                  <TableCell className="hidden sm:table-cell">
                    <Skeleton className="ml-auto h-4 w-16" />
                  </TableCell>
                </TableRow>
              ))
            : items.map((item) => (
                <TableRow
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(item);
                    }
                  }}
                  className="cursor-pointer focus:bg-muted/60 focus:outline-none"
                >
                  {selection && (
                    <TableCell
                      // Stop row-open when interacting with the checkbox cell.
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={selection.selectedIds.has(item.id)}
                        aria-label={`Select memory ${item.id}`}
                        onCheckedChange={() => selection.onToggle(item.id)}
                      />
                    </TableCell>
                  )}
                  <TableCell className="max-w-0">
                    <p className="truncate font-medium">{truncate(item.content, 140)}</p>
                    {(item.tags.length > 0 || item.isInsight) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {item.isInsight && (
                          <Badge variant="outline" className="text-[10px]">
                            insight
                          </Badge>
                        )}
                        {item.tags.slice(0, 4).map((tag) => (
                          <Badge key={tag} variant="muted" className="text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                        {item.tags.length > 4 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{item.tags.length - 4}
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.type === 'long-term' ? 'secondary' : 'muted'}>
                      {memoryTypeLabel(item.type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {item.scope ? (
                      <span className="font-mono text-xs text-muted-foreground">{item.scope}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {showScore && (
                    <TableCell>
                      <span className="tabular-nums text-sm">
                        {typeof item.score === 'number' ? formatPercent(item.score, 1) : '—'}
                      </span>
                    </TableCell>
                  )}
                  <TableCell className="hidden text-right text-sm text-muted-foreground sm:table-cell">
                    {relativeTime(item.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  );
}
