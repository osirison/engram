'use client';

import * as React from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Gauge,
  Layers,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Zap,
} from 'lucide-react';

import { ServiceCard } from '@/components/health/service-card';
import { PageContainer, PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatNumber, formatPercent, formatUptime, relativeTime } from '@/lib/format';
import { trpc } from '@/trpc/react';

export default function HealthPage() {
  const [autoRefresh, setAutoRefresh] = React.useState(true);

  const health = trpc.health.status.useQuery(undefined, {
    refetchInterval: autoRefresh ? 10_000 : false,
  });
  const metrics = trpc.health.metrics.useQuery(undefined, {
    refetchInterval: autoRefresh ? 15_000 : false,
  });

  const report = health.data;
  const services = report?.services.filter((s) => s.name !== 'memory-store') ?? [];
  const lastUpdated = health.dataUpdatedAt
    ? relativeTime(new Date(health.dataUpdatedAt).toISOString())
    : '—';

  const refreshAll = () => {
    void health.refetch();
    void metrics.refetch();
  };

  return (
    <PageContainer>
      <PageHeader
        title="System Health"
        description="Live status of the ENGRAM server and its dependencies."
      >
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Updated {lastUpdated}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh((v) => !v)}
            aria-pressed={autoRefresh}
          >
            {autoRefresh ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {autoRefresh ? 'Live' : 'Paused'}
            {autoRefresh && report?.reachable && (
              <span className="relative ml-0.5 flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--success)] opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-[var(--success)]" />
              </span>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={health.isFetching}>
            <RefreshCw className={cn('size-3.5', health.isFetching && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </PageHeader>

      {/* Overall status */}
      {health.isLoading && !report ? (
        <Skeleton className="h-16 w-full" />
      ) : !report?.reachable ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>ENGRAM server unreachable</AlertTitle>
          <AlertDescription>
            {report?.error ?? 'Could not connect to the server.'} Set{' '}
            <code className="font-mono text-xs">ENGRAM_MCP_URL</code> to point the console at a
            running server.
          </AlertDescription>
        </Alert>
      ) : report.status === 'ok' ? (
        <Alert>
          <CheckCircle2 className="text-[var(--success)]" />
          <AlertTitle>All systems operational</AlertTitle>
          <AlertDescription>
            {services.length} dependenc{services.length === 1 ? 'y' : 'ies'} reporting healthy.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Degraded</AlertTitle>
          <AlertDescription>
            {report.error ?? 'One or more services are degraded.'}
          </AlertDescription>
        </Alert>
      )}

      {/* Service cards */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Dependencies</h2>
        {health.isLoading && !report ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : services.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <ServiceCard key={service.name} service={service} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No dependency checks reported by this deployment profile.
          </p>
        )}
      </section>

      {/* Process + key metrics */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Runtime</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Active sessions"
            icon={Activity}
            isLoading={metrics.isLoading}
            value={formatNumber(metrics.data?.activeSessions)}
          />
          <StatCard
            label="Memory operations"
            icon={Database}
            isLoading={metrics.isLoading}
            value={formatNumber(metrics.data?.memoryOperationsTotal)}
            hint="since start"
          />
          <StatCard
            label="Memories promoted"
            icon={Sparkles}
            isLoading={metrics.isLoading}
            value={formatNumber(metrics.data?.memoriesPromoted)}
            hint="STM → LTM"
          />
          <StatCard
            label="Embedding cache"
            icon={Zap}
            isLoading={metrics.isLoading}
            value={formatPercent(metrics.data?.embeddings.cacheHitRatio)}
            hint="hit ratio"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="gap-3 p-5 lg:col-span-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Cpu className="size-4 text-muted-foreground" /> Process
            </div>
            {report?.process ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                <Metric
                  icon={Clock}
                  label="Uptime"
                  value={formatUptime(report.process.uptimeSeconds)}
                />
                <Metric
                  label="Heap used"
                  value={
                    report.process.heapUsedMb != null ? `${report.process.heapUsedMb} MB` : '—'
                  }
                />
                <Metric
                  label="RSS"
                  value={report.process.rssMb != null ? `${report.process.rssMb} MB` : '—'}
                />
                <Metric
                  label="PID"
                  value={report.process.pid != null ? String(report.process.pid) : '—'}
                />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No process metrics available.</p>
            )}
          </Card>

          <Card className="gap-3 p-5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Gauge className="size-4 text-muted-foreground" /> Configuration
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Layers className="size-3.5" /> Vector backend
                </span>
                <Badge variant="outline">{metrics.data?.vectorBackend ?? '—'}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Deployment profile</span>
                <Badge variant="outline">{metrics.data?.deploymentProfile ?? '—'}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Reindex ops</span>
                <span className="tabular-nums">{formatNumber(metrics.data?.reindexTotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Consolidation runs</span>
                <span className="tabular-nums">
                  {formatNumber(metrics.data?.consolidationRuns)}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </section>
    </PageContainer>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {Icon && <Icon className="size-3" />}
        {label}
      </dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
