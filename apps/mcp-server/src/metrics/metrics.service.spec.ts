import { Test, TestingModule } from '@nestjs/testing';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsService],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('exposes prometheus metrics text', async () => {
    const text = await service.getMetrics();
    expect(text).toContain('engram_memory_operations_total');
    expect(text).toContain('engram_memory_operation_duration_seconds');
    expect(text).toContain('engram_memories_promoted_total');
    expect(text).toContain('engram_reindex_operations_total');
    expect(text).toContain('engram_consolidation_runs_total');
    expect(text).toContain('engram_active_mcp_sessions');
  });

  it('records op increments counter and histogram', async () => {
    service.recordOp('create', 'ltm', 'success', 42);
    service.recordOp('create', 'ltm', 'error', 10);

    const text = await service.getMetrics();
    expect(text).toContain(
      'engram_memory_operations_total{op="create",tier="ltm",status="success"} 1',
    );
    expect(text).toContain(
      'engram_memory_operations_total{op="create",tier="ltm",status="error"} 1',
    );
    expect(text).toContain('engram_memory_operation_duration_seconds');
  });

  it('tracks consolidation runs', async () => {
    service.consolidationOpsTotal.inc({ status: 'success' });
    service.memoriesPromotedTotal.inc(3);

    const text = await service.getMetrics();
    expect(text).toContain(
      'engram_consolidation_runs_total{status="success"} 1',
    );
    expect(text).toContain('engram_memories_promoted_total 3');
  });

  it('tracks active sessions gauge', async () => {
    service.activeMcpSessions.inc();
    service.activeMcpSessions.inc();
    service.activeMcpSessions.dec();

    const text = await service.getMetrics();
    expect(text).toContain('engram_active_mcp_sessions 1');
  });

  it('returns prometheus content type', () => {
    expect(service.getContentType()).toContain('text/plain');
  });
});
