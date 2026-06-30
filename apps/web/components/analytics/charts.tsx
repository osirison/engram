'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { memoryTypeLabel, shortDate } from '@/lib/format';
import type { RouterOutputs } from '@/server/trpc/root';

type Stats = RouterOutputs['analytics']['stats'];
type Activity = RouterOutputs['analytics']['activity'];

interface TooltipPayloadEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
  payload?: Record<string, unknown>;
}

function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  labelFormatter?: (value: string | number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      {label !== undefined && (
        <p className="mb-1 font-medium">{labelFormatter ? labelFormatter(label) : label}</p>
      )}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-1.5">
          {entry.color && (
            <span className="size-2 rounded-full" style={{ background: entry.color }} />
          )}
          <span className="text-muted-foreground">{entry.name}</span>
          <span className="ml-auto font-medium tabular-nums">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

const AXIS_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' } as const;

export function ActivityChart({ data }: { data: Activity }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <defs>
          <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tickFormatter={(value: string) => shortDate(value)}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          minTickGap={28}
        />
        <YAxis
          allowDecimals={false}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={32}
        />
        <Tooltip
          content={<ChartTooltip labelFormatter={(value) => shortDate(String(value))} />}
          cursor={{ stroke: 'var(--border)' }}
        />
        <Area
          type="monotone"
          dataKey="count"
          name="Memories"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#activityFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

const TYPE_COLORS: Record<string, string> = {
  'long-term': 'var(--chart-1)',
  'short-term': 'var(--chart-4)',
};

export function TypeBreakdownChart({ data }: { data: Stats['byType'] }) {
  const chartData = data.map((d) => ({
    name: memoryTypeLabel(d.type),
    value: d.count,
    type: d.type,
  }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={2}
          strokeWidth={0}
        >
          {chartData.map((entry) => (
            <Cell key={entry.type} fill={TYPE_COLORS[entry.type] ?? 'var(--chart-2)'} />
          ))}
        </Pie>
        <Tooltip content={<ChartTooltip />} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function TopTagsChart({ data }: { data: Stats['topTags'] }) {
  const chartData = data.slice(0, 10);
  return (
    <ResponsiveContainer width="100%" height={Math.max(chartData.length * 28, 120)}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 0, right: 12, bottom: 0, left: 8 }}
      >
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="tag"
          width={110}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--muted)' }} />
        <Bar
          dataKey="count"
          name="Memories"
          fill="var(--chart-1)"
          radius={[0, 4, 4, 0]}
          barSize={14}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
