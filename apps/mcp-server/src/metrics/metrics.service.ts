import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly registry: Registry;

  readonly memoryOpsTotal: Counter<'op' | 'tier' | 'status'>;
  readonly memoryOpDurationSeconds: Histogram<'op' | 'tier'>;
  readonly memoriesPromotedTotal: Counter;
  readonly reindexOpsTotal: Counter<'status'>;
  readonly consolidationOpsTotal: Counter<'status'>;
  /** Per-agent store/recall counter so we can tell whether each agent actually uses ENGRAM (WP5 T13). */
  readonly agentMemoryOpsTotal: Counter<'agent' | 'op' | 'status'>;
  readonly activeMcpSessions: Gauge;

  constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry });

    this.memoryOpsTotal = new Counter({
      name: 'engram_memory_operations_total',
      help: 'Total memory operations by type, tier, and outcome',
      labelNames: ['op', 'tier', 'status'],
      registers: [this.registry],
    });

    this.memoryOpDurationSeconds = new Histogram({
      name: 'engram_memory_operation_duration_seconds',
      help: 'Latency of memory operations in seconds',
      labelNames: ['op', 'tier'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.memoriesPromotedTotal = new Counter({
      name: 'engram_memories_promoted_total',
      help: 'STM memories promoted to LTM by the consolidation scheduler',
      registers: [this.registry],
    });

    this.reindexOpsTotal = new Counter({
      name: 'engram_reindex_operations_total',
      help: 'Vector-store reindex operations by outcome',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.consolidationOpsTotal = new Counter({
      name: 'engram_consolidation_runs_total',
      help: 'STM→LTM consolidation scheduler runs by outcome',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.agentMemoryOpsTotal = new Counter({
      name: 'engram_agent_memory_operations_total',
      help: 'Store/recall operations by agent (API key) and outcome',
      labelNames: ['agent', 'op', 'status'],
      registers: [this.registry],
    });

    this.activeMcpSessions = new Gauge({
      name: 'engram_active_mcp_sessions',
      help: 'Number of active Streamable HTTP MCP sessions',
      registers: [this.registry],
    });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }

  /** Record a completed memory operation. */
  recordOp(
    op: string,
    tier: string,
    status: 'success' | 'error',
    durationMs: number,
  ): void {
    this.memoryOpsTotal.inc({ op, tier, status });
    this.memoryOpDurationSeconds.observe({ op, tier }, durationMs / 1000);
  }

  /**
   * Record a store/recall operation attributed to an agent (WP5 T13). `agent`
   * is the authenticated API-key id (or a coarse label like `local` for stdio).
   */
  recordAgentMemoryOp(
    agent: string,
    op: 'store' | 'recall',
    status: 'success' | 'error',
  ): void {
    this.agentMemoryOpsTotal.inc({ agent, op, status });
  }

  onModuleDestroy(): void {
    this.registry.clear();
  }
}
