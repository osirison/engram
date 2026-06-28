import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';

/**
 * Process-only health indicator.
 *
 * Always present regardless of the active deployment profile so that even
 * profile-memory can answer `/health` with a positive status without needing
 * any external dependencies. It performs an in-process memory probe and
 * reports Node process metrics useful for observability.
 */
@Injectable()
export class MemoryStoreHealthIndicator extends HealthIndicator {
  isHealthy(key: string): HealthIndicatorResult {
    const mem = process.memoryUsage();
    const heapUsedMb = Number((mem.heapUsed / (1024 * 1024)).toFixed(2));
    const rssMb = Number((mem.rss / (1024 * 1024)).toFixed(2));

    return this.getStatus(key, true, {
      process: 'engram-mcp-server',
      pid: process.pid,
      uptimeSeconds: Number(process.uptime().toFixed(2)),
      heapUsedMb,
      rssMb,
    });
  }
}
