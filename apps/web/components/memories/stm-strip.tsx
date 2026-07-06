'use client';

import * as React from 'react';
import { Clock } from 'lucide-react';

import { ExpiryBadge } from '@/components/memories/expiry-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { truncate } from '@/lib/format';
import { trpc } from '@/trpc/react';

/**
 * A compact "Live short-term" strip shown above the persisted list on the `all`
 * view (WP2 T3/D3), so the Redis-backed STM tier is visible by default. It polls
 * the STM source on an interval to keep countdowns honest, and links out to the
 * full short-term tab. Degrades to nothing when STM is unavailable.
 */
export function StmStrip({
  userId,
  onOpen,
  onViewAll,
}: {
  userId: string;
  onOpen: (memoryId: string) => void;
  onViewAll: () => void;
}) {
  const stm = trpc.memory.listStm.useQuery(
    { userId, limit: 10 },
    { enabled: userId.length > 0, refetchInterval: 30_000 }
  );

  // Nothing to show (no items, or STM unavailable) → render nothing so the strip
  // never adds noise to the persisted list.
  const items = stm.data?.items ?? [];
  if (stm.isLoading || items.length === 0) return null;

  return (
    <section className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock className="size-4 text-muted-foreground" />
          Live short-term
          <Badge variant="muted">{stm.data?.totalCount ?? items.length}</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onViewAll}>
          View all
        </Button>
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
            >
              <span className="truncate">{truncate(item.content, 90)}</span>
              <ExpiryBadge expiresAt={item.expiresAt} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
