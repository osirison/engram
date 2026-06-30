/**
 * The dashboard's backend seam.
 *
 * Every tRPC procedure depends on this interface rather than on Prisma or the
 * MCP client directly, so the data layer is swappable and trivially mockable in
 * tests. The default implementation (`PrismaEngramBackend`) reads Postgres for
 * lists/analytics and proxies writes + semantic recall to the MCP server.
 */

export type MemoryType = 'short-term' | 'long-term';

/** A memory shaped for the UI — JSON-serialisable, dates as ISO strings. */
export interface MemoryDTO {
  id: string;
  userId: string;
  organizationId: string | null;
  scope: string | null;
  content: string;
  type: MemoryType;
  tags: string[];
  metadata: Record<string, unknown> | null;
  /** Derived `metadata.importance` when the engine has annotated it. */
  importance: number | null;
  hasEmbedding: boolean;
  /** True when `metadata.isInsight` — a synthesised insight memory. */
  isInsight: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  /** Relevance score in [0,1], present only on semantic-search results. */
  score?: number;
}

export type MemoryTypeFilter = MemoryType | 'all';
export type SortField = 'createdAt' | 'updatedAt';
export type SortOrder = 'asc' | 'desc';

export interface ListMemoriesParams {
  userId: string;
  type?: MemoryTypeFilter;
  tags?: string[];
  scope?: string | null;
  /** Case-insensitive keyword match against content (Postgres ILIKE). */
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  insightsOnly?: boolean;
  sortBy?: SortField;
  sortOrder?: SortOrder;
  limit: number;
  /** Opaque offset cursor produced by a previous page. */
  cursor?: string | null;
}

export interface ListMemoriesResult {
  items: MemoryDTO[];
  totalCount: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface SearchMemoriesParams {
  userId: string;
  query: string;
  limit: number;
  tags?: string[];
  scope?: string | null;
  dateFrom?: string;
  dateTo?: string;
}

export interface SearchMemoriesResult {
  items: MemoryDTO[];
  count: number;
  /** True when results came from vector recall; false for keyword fallback. */
  semantic: boolean;
}

export interface UpdateMemoryParams {
  userId: string;
  memoryId: string;
  content?: string;
  tags?: string[];
  scope?: string | null;
}

export interface DeleteMemoryParams {
  userId: string;
  memoryId: string;
  scope?: string | null;
}

export interface ServiceHealth {
  /** Stable key, e.g. `database`, `redis`, `qdrant`, `pgvector`, `memory-store`. */
  name: string;
  status: 'up' | 'down' | 'unknown';
  detail?: Record<string, unknown>;
}

export interface ProcessHealth {
  pid?: number;
  uptimeSeconds?: number;
  heapUsedMb?: number;
  rssMb?: number;
}

export interface HealthReport {
  /** Whether the dashboard could reach the MCP server at all. */
  reachable: boolean;
  status: 'ok' | 'error' | 'unknown';
  services: ServiceHealth[];
  process: ProcessHealth | null;
  /** Populated when the server is unreachable or returned an error body. */
  error: string | null;
  timestamp: string;
}

export interface MetricSnapshot {
  reachable: boolean;
  activeSessions: number | null;
  memoryOperationsTotal: number | null;
  reindexTotal: number | null;
  consolidationRuns: number | null;
  memoriesPromoted: number | null;
  embeddings: {
    requests: number | null;
    cacheHits: number | null;
    cacheHitRatio: number | null;
  };
  vectorBackend: string | null;
  deploymentProfile: string | null;
  /** Every parsed `engram_*` sample, keyed by metric+labels, for completeness. */
  raw: Record<string, number>;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface ScopeCount {
  scope: string | null;
  count: number;
}

export interface TypeCount {
  type: MemoryType;
  count: number;
}

export interface ActivityPoint {
  /** ISO date (yyyy-mm-dd) at day granularity. */
  date: string;
  count: number;
}

export interface MemoryStats {
  total: number;
  byType: TypeCount[];
  topTags: TagCount[];
  scopes: ScopeCount[];
  insightCount: number;
  withEmbedding: number;
  withoutEmbedding: number;
  newestAt: string | null;
  oldestAt: string | null;
}

export interface MemoryOwner {
  userId: string;
  count: number;
  lastActivityAt: string | null;
}

export interface BackendCapabilities {
  /** True when an MCP server is configured for writes + recall. */
  writes: boolean;
  semanticSearch: boolean;
  mcpConfigured: boolean;
}

export interface EngramBackend {
  capabilities(): BackendCapabilities;

  listMemories(params: ListMemoriesParams): Promise<ListMemoriesResult>;
  getMemory(userId: string, memoryId: string): Promise<MemoryDTO | null>;
  searchMemories(params: SearchMemoriesParams): Promise<SearchMemoriesResult>;
  updateMemory(params: UpdateMemoryParams): Promise<MemoryDTO>;
  deleteMemory(params: DeleteMemoryParams): Promise<{ deleted: boolean }>;

  getHealth(): Promise<HealthReport>;
  getMetrics(): Promise<MetricSnapshot>;

  getMemoryStats(userId: string): Promise<MemoryStats>;
  getActivitySeries(userId: string, days: number): Promise<ActivityPoint[]>;
  listMemoryOwners(limit: number): Promise<MemoryOwner[]>;
}

/** Raised by adapters for expected, user-facing failures (e.g. not found). */
export class BackendError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_FOUND'
      | 'UNAVAILABLE'
      | 'WRITES_DISABLED'
      | 'BAD_REQUEST'
      | 'INTERNAL' = 'INTERNAL'
  ) {
    super(message);
    this.name = 'BackendError';
  }
}
