import { Prisma, type PrismaClient } from '@prisma/client';

import { McpToolClient } from './mcp-client';
import {
  BackendError,
  type ActivityPoint,
  type BackendCapabilities,
  type DeleteMemoryParams,
  type EngramBackend,
  type HealthReport,
  type ListMemoriesParams,
  type ListMemoriesResult,
  type MemoryDTO,
  type MemoryOwner,
  type MemoryStats,
  type MemoryType,
  type MetricSnapshot,
  type SearchMemoriesParams,
  type SearchMemoriesResult,
  type ServiceHealth,
  type UpdateMemoryParams,
} from './types';

const memorySelect = {
  id: true,
  userId: true,
  organizationId: true,
  scope: true,
  content: true,
  metadata: true,
  tags: true,
  type: true,
  createdAt: true,
  updatedAt: true,
  expiresAt: true,
} satisfies Prisma.MemorySelect;

type MemoryRow = {
  id: string;
  userId: string;
  organizationId: string | null;
  scope: string | null;
  content: string;
  metadata: Prisma.JsonValue;
  tags: string[];
  type: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
};

function asRecord(value: Prisma.JsonValue): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function mapRow(row: MemoryRow, hasEmbedding: boolean): MemoryDTO {
  const metadata = asRecord(row.metadata);
  const importance =
    metadata && typeof metadata.importance === 'number' ? metadata.importance : null;
  // Single source of truth: the `insight` tag (the insight-extraction service
  // always applies it). This keeps the badge consistent with the `insightsOnly`
  // filter and `insightCount`, which both query by tag.
  const isInsight = row.tags.includes('insight');
  return {
    id: row.id,
    userId: row.userId,
    organizationId: row.organizationId,
    scope: row.scope,
    content: row.content,
    type: (row.type === 'short-term' ? 'short-term' : 'long-term') as MemoryType,
    tags: row.tags,
    metadata,
    importance,
    hasEmbedding,
    isInsight,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

interface PrismaBackendOptions {
  prisma: PrismaClient;
  mcpUrl: string | null;
  mcpApiKey: string | null;
  /** Per-request timeout for MCP server HTTP calls (health/metrics). */
  httpTimeoutMs?: number;
  /** Injectable MCP client + fetch for testing; defaults derive from mcpUrl. */
  mcpClient?: McpToolClient | null;
  fetchImpl?: typeof fetch;
}

export class PrismaEngramBackend implements EngramBackend {
  private readonly prisma: PrismaClient;
  private readonly mcpUrl: string | null;
  private readonly mcpApiKey: string | null;
  private readonly mcp: McpToolClient | null;
  private readonly httpTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PrismaBackendOptions) {
    this.prisma = options.prisma;
    this.mcpUrl = options.mcpUrl;
    this.mcpApiKey = options.mcpApiKey;
    this.httpTimeoutMs = options.httpTimeoutMs ?? 4000;
    this.mcp =
      options.mcpClient ??
      (options.mcpUrl
        ? new McpToolClient({ baseUrl: options.mcpUrl, apiKey: options.mcpApiKey })
        : null);
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  }

  capabilities(): BackendCapabilities {
    const configured = this.mcp !== null;
    return { writes: configured, semanticSearch: configured, mcpConfigured: configured };
  }

  // ---------------------------------------------------------------------------
  // Reads (Postgres — source of truth)
  // ---------------------------------------------------------------------------

  private buildWhere(params: ListMemoriesParams): Prisma.MemoryWhereInput {
    const where: Prisma.MemoryWhereInput = { userId: params.userId };

    if (params.type && params.type !== 'all') {
      where.type = params.type;
    }
    if (params.tags && params.tags.length > 0) {
      where.tags = { hasEvery: params.tags };
    }
    if (params.insightsOnly) {
      where.tags = { ...(where.tags as object), has: 'insight' };
    }
    if (params.scope) {
      where.scope = params.scope;
    }
    if (params.search && params.search.trim()) {
      where.content = { contains: params.search.trim(), mode: 'insensitive' };
    }
    if (params.dateFrom || params.dateTo) {
      where.createdAt = {};
      if (params.dateFrom) where.createdAt.gte = new Date(params.dateFrom);
      if (params.dateTo) where.createdAt.lte = new Date(params.dateTo);
    }
    return where;
  }

  private async embeddingFlags(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM memories WHERE id IN (${Prisma.join(ids)}) AND array_length(embedding, 1) > 0`
    );
    return new Set(rows.map((r) => r.id));
  }

  async listMemories(params: ListMemoriesParams): Promise<ListMemoriesResult> {
    const where = this.buildWhere(params);
    const limit = Math.min(Math.max(params.limit, 1), 100);
    const offset = params.cursor ? Math.max(parseInt(params.cursor, 10) || 0, 0) : 0;
    const sortBy = params.sortBy ?? 'createdAt';
    const sortOrder = params.sortOrder ?? 'desc';

    const [rows, totalCount] = await Promise.all([
      this.prisma.memory.findMany({
        where,
        select: memorySelect,
        orderBy: { [sortBy]: sortOrder },
        skip: offset,
        take: limit,
      }),
      this.prisma.memory.count({ where }),
    ]);

    const withEmbedding = await this.embeddingFlags(rows.map((r) => r.id));
    const items = rows.map((row) => mapRow(row as MemoryRow, withEmbedding.has(row.id)));
    const nextOffset = offset + items.length;
    const hasMore = nextOffset < totalCount;

    return {
      items,
      totalCount,
      nextCursor: hasMore ? String(nextOffset) : null,
      hasMore,
    };
  }

  async getMemory(userId: string, memoryId: string): Promise<MemoryDTO | null> {
    const row = await this.prisma.memory.findFirst({
      where: { id: memoryId, userId },
      select: memorySelect,
    });
    if (!row) return null;
    const withEmbedding = await this.embeddingFlags([row.id]);
    return mapRow(row as MemoryRow, withEmbedding.has(row.id));
  }

  // ---------------------------------------------------------------------------
  // Semantic search (MCP recall, keyword fallback)
  // ---------------------------------------------------------------------------

  async searchMemories(params: SearchMemoriesParams): Promise<SearchMemoriesResult> {
    const limit = Math.min(Math.max(params.limit, 1), 100);

    if (this.mcp) {
      try {
        const recall = await this.mcp.call<{
          results?: { score: number; memory: { id: string } }[];
        }>('recall', {
          userId: params.userId,
          query: params.query,
          limit,
          ...(params.scope ? { scope: params.scope } : {}),
          ...(params.tags && params.tags.length ? { tags: params.tags } : {}),
          ...(params.dateFrom ? { createdFrom: params.dateFrom } : {}),
          ...(params.dateTo ? { createdTo: params.dateTo } : {}),
        });

        const hits = recall.results ?? [];
        const scoreById = new Map(hits.map((hit) => [hit.memory.id, hit.score]));
        const ids = hits.map((hit) => hit.memory.id);

        if (ids.length === 0) {
          return { items: [], count: 0, semantic: true };
        }

        const rows = await this.prisma.memory.findMany({
          where: { id: { in: ids }, userId: params.userId },
          select: memorySelect,
        });
        const withEmbedding = await this.embeddingFlags(rows.map((r) => r.id));
        const items = rows
          .map((row) => ({
            ...mapRow(row as MemoryRow, withEmbedding.has(row.id)),
            score: scoreById.get(row.id) ?? 0,
          }))
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

        return { items, count: items.length, semantic: true };
      } catch {
        // Fall through to keyword search when the engine is unreachable.
      }
    }

    const fallback = await this.listMemories({
      userId: params.userId,
      search: params.query,
      tags: params.tags,
      scope: params.scope ?? undefined,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      limit,
    });
    return { items: fallback.items, count: fallback.items.length, semantic: false };
  }

  // ---------------------------------------------------------------------------
  // Writes (MCP server — keeps the vector index in sync)
  // ---------------------------------------------------------------------------

  async updateMemory(params: UpdateMemoryParams): Promise<MemoryDTO> {
    if (!this.mcp) {
      throw new BackendError(
        'Editing memories requires a configured ENGRAM server (ENGRAM_MCP_URL).',
        'WRITES_DISABLED'
      );
    }
    await this.mcp.call('update_memory', {
      userId: params.userId,
      memoryId: params.memoryId,
      ...(params.content !== undefined ? { content: params.content } : {}),
      ...(params.tags !== undefined ? { tags: params.tags } : {}),
      ...(params.scope ? { scope: params.scope } : {}),
    });
    const updated = await this.getMemory(params.userId, params.memoryId);
    if (!updated) {
      throw new BackendError('Memory not found after update.', 'NOT_FOUND');
    }
    return updated;
  }

  async deleteMemory(params: DeleteMemoryParams): Promise<{ deleted: boolean }> {
    if (!this.mcp) {
      throw new BackendError(
        'Deleting memories requires a configured ENGRAM server (ENGRAM_MCP_URL).',
        'WRITES_DISABLED'
      );
    }
    await this.mcp.call('delete_memory', {
      userId: params.userId,
      memoryId: params.memoryId,
      ...(params.scope ? { scope: params.scope } : {}),
    });
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Health + metrics (MCP server HTTP endpoints)
  // ---------------------------------------------------------------------------

  private async fetchMcp(path: string): Promise<Response | null> {
    if (!this.mcpUrl) return null;
    try {
      return await this.fetchImpl(`${this.mcpUrl}${path}`, {
        signal: AbortSignal.timeout(this.httpTimeoutMs),
        headers: this.mcpApiKey ? { Authorization: `Bearer ${this.mcpApiKey}` } : undefined,
        cache: 'no-store',
      });
    } catch {
      return null;
    }
  }

  async getHealth(): Promise<HealthReport> {
    const now = new Date().toISOString();
    if (!this.mcpUrl) {
      return {
        reachable: false,
        status: 'unknown',
        services: [],
        process: null,
        error: 'No ENGRAM server configured (set ENGRAM_MCP_URL).',
        timestamp: now,
      };
    }

    const res = await this.fetchMcp('/health');
    if (!res) {
      return {
        reachable: false,
        status: 'error',
        services: [],
        process: null,
        error: 'ENGRAM server is unreachable.',
        timestamp: now,
      };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const data = (body ?? {}) as {
      status?: string;
      info?: Record<string, Record<string, unknown>>;
      error?: Record<string, Record<string, unknown>>;
      details?: Record<string, Record<string, unknown>>;
      timestamp?: string;
    };

    const checks = data.details ?? { ...(data.info ?? {}), ...(data.error ?? {}) };
    const services: ServiceHealth[] = [];
    let process: HealthReport['process'] = null;

    for (const [name, raw] of Object.entries(checks)) {
      const status = raw?.status === 'up' ? 'up' : raw?.status === 'down' ? 'down' : 'unknown';
      const { status: _status, ...detail } = raw ?? {};
      void _status;
      if (name === 'memory-store') {
        process = {
          pid: typeof detail.pid === 'number' ? detail.pid : undefined,
          uptimeSeconds:
            typeof detail.uptimeSeconds === 'number' ? detail.uptimeSeconds : undefined,
          heapUsedMb: typeof detail.heapUsedMb === 'number' ? detail.heapUsedMb : undefined,
          rssMb: typeof detail.rssMb === 'number' ? detail.rssMb : undefined,
        };
      }
      services.push({ name, status, detail });
    }

    return {
      reachable: true,
      status: data.status === 'ok' ? 'ok' : 'error',
      services,
      process,
      error: data.status === 'ok' ? null : 'One or more services are degraded.',
      timestamp: data.timestamp ?? now,
    };
  }

  async getMetrics(): Promise<MetricSnapshot> {
    const empty: MetricSnapshot = {
      reachable: false,
      activeSessions: null,
      memoryOperationsTotal: null,
      reindexTotal: null,
      consolidationRuns: null,
      memoriesPromoted: null,
      embeddings: { requests: null, cacheHits: null, cacheHitRatio: null },
      vectorBackend: null,
      deploymentProfile: null,
      raw: {},
    };
    const res = await this.fetchMcp('/health/metrics');
    if (!res || !res.ok) return empty;

    const text = await res.text();
    const raw = parsePrometheus(text);

    const sumByPrefix = (prefix: string): number | null => {
      const keys = Object.keys(raw).filter((k) => k.startsWith(prefix));
      if (keys.length === 0) return null;
      return keys.reduce((acc, k) => acc + raw[k]!, 0);
    };
    const labelFor = (prefix: string, label: string): string | null => {
      const key = Object.keys(raw).find((k) => k.startsWith(prefix) && raw[k] === 1);
      if (!key) return null;
      const match = key.match(new RegExp(`${label}="([^"]+)"`));
      return match ? match[1]! : null;
    };

    const requests = raw['engram_embeddings_requests_total'] ?? null;
    const cacheHits = raw['engram_embeddings_cacheHits_total'] ?? null;

    return {
      reachable: true,
      activeSessions: raw['engram_active_mcp_sessions'] ?? null,
      memoryOperationsTotal: sumByPrefix('engram_memory_operations_total'),
      reindexTotal: sumByPrefix('engram_reindex_operations_total'),
      consolidationRuns: sumByPrefix('engram_consolidation_runs_total'),
      memoriesPromoted: raw['engram_memories_promoted_total'] ?? null,
      embeddings: {
        requests,
        cacheHits,
        cacheHitRatio: requests && requests > 0 && cacheHits !== null ? cacheHits / requests : null,
      },
      vectorBackend: labelFor('engram_vector_backend_info', 'backend'),
      deploymentProfile: labelFor('engram_deployment_profile_info', 'profile'),
      raw,
    };
  }

  // ---------------------------------------------------------------------------
  // Analytics (Postgres aggregations)
  // ---------------------------------------------------------------------------

  async getMemoryStats(userId: string): Promise<MemoryStats> {
    const [total, byTypeRaw, topTags, scopeRows, insightCount, withEmbeddingRow, bounds] =
      await Promise.all([
        this.prisma.memory.count({ where: { userId } }),
        this.prisma.memory.groupBy({
          by: ['type'],
          where: { userId },
          _count: { _all: true },
        }),
        this.prisma.$queryRaw<{ tag: string; count: number }[]>(
          Prisma.sql`SELECT tag, COUNT(*)::int AS count FROM memories, unnest(tags) AS tag WHERE "userId" = ${userId} GROUP BY tag ORDER BY count DESC, tag ASC LIMIT 20`
        ),
        this.prisma.memory.groupBy({
          by: ['scope'],
          where: { userId },
          _count: { _all: true },
        }),
        this.prisma.memory.count({ where: { userId, tags: { has: 'insight' } } }),
        this.prisma.$queryRaw<{ count: number }[]>(
          Prisma.sql`SELECT COUNT(*)::int AS count FROM memories WHERE "userId" = ${userId} AND array_length(embedding, 1) > 0`
        ),
        this.prisma.memory.aggregate({
          where: { userId },
          _max: { createdAt: true },
          _min: { createdAt: true },
        }),
      ]);

    const withEmbedding = withEmbeddingRow[0]?.count ?? 0;

    return {
      total,
      byType: byTypeRaw
        .map((entry) => ({
          type: (entry.type === 'short-term' ? 'short-term' : 'long-term') as MemoryType,
          count: entry._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      topTags,
      scopes: scopeRows
        .map((entry) => ({ scope: entry.scope, count: entry._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12),
      insightCount,
      withEmbedding,
      withoutEmbedding: Math.max(total - withEmbedding, 0),
      newestAt: bounds._max.createdAt ? bounds._max.createdAt.toISOString() : null,
      oldestAt: bounds._min.createdAt ? bounds._min.createdAt.toISOString() : null,
    };
  }

  async getActivitySeries(userId: string, days: number): Promise<ActivityPoint[]> {
    const windowDays = Math.min(Math.max(days, 1), 365);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.$queryRaw<{ date: string; count: number }[]>(
      Prisma.sql`SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
                 FROM memories
                 WHERE "userId" = ${userId} AND "createdAt" >= ${since}
                 GROUP BY 1 ORDER BY 1`
    );
    return rows;
  }

  async listMemoryOwners(limit: number): Promise<MemoryOwner[]> {
    const cap = Math.min(Math.max(limit, 1), 200);
    const rows = await this.prisma.$queryRaw<
      { userId: string; count: number; lastActivityAt: Date | null }[]
    >(
      Prisma.sql`SELECT "userId" AS "userId", COUNT(*)::int AS count, MAX("createdAt") AS "lastActivityAt"
                 FROM memories
                 GROUP BY "userId" ORDER BY count DESC LIMIT ${cap}`
    );
    return rows.map((row) => ({
      userId: row.userId,
      count: row.count,
      lastActivityAt: row.lastActivityAt ? new Date(row.lastActivityAt).toISOString() : null,
    }));
  }
}

/** Minimal Prometheus exposition-format parser: `name{labels} value` per line. */
export function parsePrometheus(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // name{labels?} value [timestamp]? — value may be a signed float with a
    // negative exponent, or a Prometheus special (±Inf/NaN, which we then drop
    // via the isFinite guard below).
    const match = trimmed.match(
      /^([a-zA-Z_:][a-zA-Z0-9_:]*(?:\{[^}]*\})?)\s+(-?\d*\.?\d+(?:[eE][+-]?\d+)?|[+-]?Inf|NaN)(?:\s+\S+)?$/
    );
    if (!match) continue;
    const value = Number(match[2]);
    if (Number.isFinite(value)) {
      out[match[1]!] = value;
    }
  }
  return out;
}
