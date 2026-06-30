'use client';

import Link from 'next/link';
import { Activity, ArrowRight, Brain, Database, Sparkles } from 'lucide-react';

import { PageContainer, PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { EmptyState, ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserScope } from '@/components/user-scope';
import { formatNumber, memoryTypeLabel, relativeTime, truncate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { trpc } from '@/trpc/react';

const STATUS_DOT: Record<string, string> = {
  up: 'bg-[var(--success)]',
  down: 'bg-destructive',
  unknown: 'bg-muted-foreground/40',
};

export default function OverviewPage() {
  const { userId } = useUserScope();
  const enabled = userId.length > 0;

  const stats = trpc.analytics.stats.useQuery({ userId }, { enabled });
  const recent = trpc.memory.list.useQuery({ userId, limit: 6 }, { enabled });
  const health = trpc.health.status.useQuery(undefined, { refetchInterval: 15_000 });

  const byType = new Map(stats.data?.byType.map((t) => [t.type, t.count]));

  return (
    <PageContainer>
      <PageHeader
        title="Overview"
        description={
          enabled ? `Memory summary for ${userId}` : 'A snapshot of memories and system health'
        }
      />

      {!enabled ? (
        <EmptyState
          icon={Database}
          title="Select a data owner"
          description="Choose a userId from the switcher in the header to view their memories and analytics."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Total memories"
              icon={Database}
              isLoading={stats.isLoading}
              value={formatNumber(stats.data?.total)}
              hint={stats.data ? `${formatNumber(stats.data.withEmbedding)} embedded` : undefined}
            />
            <StatCard
              label="Long-term"
              icon={Brain}
              isLoading={stats.isLoading}
              value={formatNumber(byType.get('long-term') ?? 0)}
            />
            <StatCard
              label="Short-term"
              icon={Activity}
              isLoading={stats.isLoading}
              value={formatNumber(byType.get('short-term') ?? 0)}
            />
            <StatCard
              label="Insights"
              icon={Sparkles}
              isLoading={stats.isLoading}
              value={formatNumber(stats.data?.insightCount)}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Recent memories</CardTitle>
                <CardDescription>The latest items stored for this user.</CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                {recent.isError ? (
                  <div className="px-6">
                    <ErrorState
                      message={recent.error.message}
                      onRetry={() => void recent.refetch()}
                    />
                  </div>
                ) : recent.isLoading ? (
                  <div className="space-y-3 px-6">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : recent.data && recent.data.items.length > 0 ? (
                  <ul className="divide-y">
                    {recent.data.items.map((m) => (
                      <li key={m.id} className="flex items-start gap-3 px-6 py-3">
                        <Badge
                          variant={m.type === 'long-term' ? 'secondary' : 'muted'}
                          className="mt-0.5"
                        >
                          {memoryTypeLabel(m.type)}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{truncate(m.content, 120)}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {relativeTime(m.createdAt)}
                            {m.scope ? ` · ${m.scope}` : ''}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="px-6">
                    <EmptyState
                      title="No memories yet"
                      description="This user has no stored memories."
                    />
                  </div>
                )}
              </CardContent>
              <Separator />
              <div className="px-6 pb-4">
                <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                  <Link href="/memories">
                    Open memory navigator <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">System health</CardTitle>
                <CardDescription>Live dependency status.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {!health.data?.reachable ? (
                  <p className="text-sm text-muted-foreground">
                    {health.data?.error ?? 'Connecting to the ENGRAM server…'}
                  </p>
                ) : (
                  health.data.services.map((s) => (
                    <div key={s.name} className="flex items-center justify-between text-sm">
                      <span className="capitalize">{s.name.replace(/-/g, ' ')}</span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span className={cn('size-2 rounded-full', STATUS_DOT[s.status])} />
                        {s.status}
                      </span>
                    </div>
                  ))
                )}
                <Separator className="my-2" />
                <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                  <Link href="/health">
                    View system health <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </PageContainer>
  );
}
