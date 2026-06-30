'use client';

import { Boxes, Database, HardDrive, Layers, Server, type LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui/card';
import type { RouterOutputs } from '@/server/trpc/root';
import { cn } from '@/lib/utils';

type ServiceHealth = RouterOutputs['health']['status']['services'][number];

const SERVICE_ICONS: Record<string, LucideIcon> = {
  database: Database,
  redis: Server,
  qdrant: Boxes,
  pgvector: Layers,
  'memory-store': HardDrive,
};

const STATUS_STYLES: Record<string, { dot: string; label: string; text: string }> = {
  up: { dot: 'bg-[var(--success)]', label: 'Operational', text: 'text-[var(--success)]' },
  down: { dot: 'bg-destructive', label: 'Down', text: 'text-destructive' },
  unknown: { dot: 'bg-muted-foreground/50', label: 'Unknown', text: 'text-muted-foreground' },
};

function renderDetailValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return '';
  return String(value);
}

export function ServiceCard({ service }: { service: ServiceHealth }) {
  const Icon = SERVICE_ICONS[service.name] ?? Server;
  const style = STATUS_STYLES[service.status] ?? STATUS_STYLES.unknown!;
  const detailEntries = Object.entries(service.detail ?? {}).filter(
    ([, value]) => typeof value !== 'object' || value === null
  );

  return (
    <Card className="gap-3 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </div>
          <span className="font-medium capitalize">{service.name.replace(/-/g, ' ')}</span>
        </div>
        <span className={cn('flex items-center gap-1.5 text-xs font-medium', style.text)}>
          <span className={cn('size-2 rounded-full', style.dot)} />
          {style.label}
        </span>
      </div>
      {detailEntries.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {detailEntries.slice(0, 6).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <dt className="capitalize text-muted-foreground">{key.replace(/([A-Z])/g, ' $1')}</dt>
              <dd className="truncate font-medium tabular-nums">{renderDetailValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
