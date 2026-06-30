'use client';

import * as React from 'react';
import { Database, Layers, Sparkles, TrendingUp } from 'lucide-react';

import { ActivityChart, TopTagsChart, TypeBreakdownChart } from '@/components/analytics/charts';
import { MemoryDetailSheet } from '@/components/memories/memory-detail-sheet';
import { PageContainer, PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { EmptyState, ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUserScope } from '@/components/user-scope';
import { formatNumber, formatPercent, relativeTime, truncate } from '@/lib/format';
import { trpc } from '@/trpc/react';

function insightMeta(metadata: Record<string, unknown> | null): {
  topic?: string;
  clusterSize?: number;
} {
  if (!metadata) return {};
  return {
    topic: typeof metadata.topic === 'string' ? metadata.topic : undefined,
    clusterSize: typeof metadata.clusterSize === 'number' ? metadata.clusterSize : undefined,
  };
}

export default function InsightsPage() {
  const { userId } = useUserScope();
  const enabled = userId.length > 0;
  const [days, setDays] = React.useState(30);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const stats = trpc.analytics.stats.useQuery({ userId }, { enabled });
  const activity = trpc.analytics.activity.useQuery({ userId, days }, { enabled });
  const insights = trpc.memory.list.useQuery(
    { userId, insightsOnly: true, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' },
    { enabled }
  );

  const byType = new Map(stats.data?.byType.map((t) => [t.type, t.count]));
  const embedCoverage =
    stats.data && stats.data.total > 0 ? stats.data.withEmbedding / stats.data.total : null;
  const hasActivity = (activity.data?.length ?? 0) > 0;

  if (!enabled) {
    return (
      <PageContainer>
        <PageHeader
          title="Insights & Analytics"
          description="Synthesised insights and usage analytics."
        />
        <EmptyState
          icon={Sparkles}
          title="Select a data owner"
          description="Choose a userId from the switcher in the header to view insights and analytics."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Insights & Analytics"
        description={`Usage patterns and synthesised insights for ${userId}.`}
      />

      <Tabs defaultValue="analytics">
        <TabsList>
          <TabsTrigger value="analytics">
            <TrendingUp className="size-3.5" /> Analytics
          </TabsTrigger>
          <TabsTrigger value="insights">
            <Sparkles className="size-3.5" /> Insights
            {insights.data && insights.data.items.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {insights.data.items.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Analytics */}
        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Total memories"
              icon={Database}
              isLoading={stats.isLoading}
              value={formatNumber(stats.data?.total)}
            />
            <StatCard
              label="Long-term"
              isLoading={stats.isLoading}
              value={formatNumber(byType.get('long-term') ?? 0)}
            />
            <StatCard
              label="Short-term"
              isLoading={stats.isLoading}
              value={formatNumber(byType.get('short-term') ?? 0)}
            />
            <StatCard
              label="Embedded"
              icon={Layers}
              isLoading={stats.isLoading}
              value={formatPercent(embedCoverage)}
              hint={stats.data ? `${formatNumber(stats.data.withEmbedding)} indexed` : undefined}
            />
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base">Memories created</CardTitle>
                  <CardDescription>New memories per day.</CardDescription>
                </div>
                <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
                  <SelectTrigger size="sm" className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {activity.isError ? (
                <ErrorState
                  message={activity.error.message}
                  onRetry={() => void activity.refetch()}
                />
              ) : activity.isLoading ? (
                <Skeleton className="h-[240px] w-full" />
              ) : hasActivity ? (
                <ActivityChart data={activity.data!} />
              ) : (
                <EmptyState icon={TrendingUp} title="No activity in this window" />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By type</CardTitle>
                <CardDescription>Distribution of memory tiers.</CardDescription>
              </CardHeader>
              <CardContent>
                {stats.isLoading ? (
                  <Skeleton className="h-[200px] w-full" />
                ) : stats.data && stats.data.total > 0 ? (
                  <div className="flex items-center gap-6">
                    <div className="flex-1">
                      <TypeBreakdownChart data={stats.data.byType} />
                    </div>
                    <ul className="space-y-2 text-sm">
                      {stats.data.byType.map((t) => (
                        <li key={t.type} className="flex items-center gap-2">
                          <span
                            className="size-2.5 rounded-full"
                            style={{
                              background:
                                t.type === 'long-term' ? 'var(--chart-1)' : 'var(--chart-4)',
                            }}
                          />
                          <span className="capitalize text-muted-foreground">
                            {t.type.replace('-', ' ')}
                          </span>
                          <span className="ml-auto font-medium tabular-nums">
                            {formatNumber(t.count)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <EmptyState title="No memories yet" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top tags</CardTitle>
                <CardDescription>Most frequently used tags.</CardDescription>
              </CardHeader>
              <CardContent>
                {stats.isLoading ? (
                  <Skeleton className="h-[200px] w-full" />
                ) : stats.data && stats.data.topTags.length > 0 ? (
                  <TopTagsChart data={stats.data.topTags} />
                ) : (
                  <EmptyState
                    title="No tags yet"
                    description="Memories for this user have no tags."
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Insights */}
        <TabsContent value="insights" className="space-y-4">
          {insights.isError ? (
            <ErrorState message={insights.error.message} onRetry={() => void insights.refetch()} />
          ) : insights.isLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-36 w-full" />
              ))}
            </div>
          ) : insights.data && insights.data.items.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {insights.data.items.map((insight) => {
                const meta = insightMeta(insight.metadata);
                return (
                  <Card
                    key={insight.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(insight.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(insight.id);
                      }
                    }}
                    className="cursor-pointer gap-3 p-5 transition-colors hover:border-ring/60 focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="size-4 text-[var(--chart-1)]" />
                      {meta.topic && (
                        <Badge variant="secondary" className="capitalize">
                          {meta.topic}
                        </Badge>
                      )}
                      {meta.clusterSize && (
                        <span className="text-xs text-muted-foreground">
                          {meta.clusterSize} sources
                        </span>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed">{truncate(insight.content, 220)}</p>
                    <p className="mt-auto text-xs text-muted-foreground">
                      {relativeTime(insight.createdAt)}
                    </p>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Sparkles}
              title="No insights yet"
              description="Insights are synthesised in the background from clusters of related memories. Once the engine generates them, they'll appear here."
            />
          )}
        </TabsContent>
      </Tabs>

      <MemoryDetailSheet
        userId={userId}
        memoryId={selectedId}
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
    </PageContainer>
  );
}
