import { Controller, Get, Header, Optional } from '@nestjs/common';
import { EmbeddingsService } from '@engram/embeddings';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { QdrantHealthIndicator } from './qdrant.health';
import { PgVectorHealthIndicator } from './pgvector.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly qdrantHealth: QdrantHealthIndicator,
    private readonly pgVectorHealth: PgVectorHealthIndicator,
    @Optional() private readonly embeddingsService?: EmbeddingsService,
  ) {}

  private buildIndicators(): Array<() => Promise<HealthIndicatorResult>> {
    const indicators: Array<() => Promise<HealthIndicatorResult>> = [
      (): Promise<HealthIndicatorResult> =>
        this.prismaHealth.isHealthy('database'),
      (): Promise<HealthIndicatorResult> => this.redisHealth.isHealthy('redis'),
      (): Promise<HealthIndicatorResult> =>
        this.qdrantHealth.isHealthy('qdrant'),
    ];

    if ((process.env.VECTOR_BACKEND ?? 'qdrant').toLowerCase() === 'pgvector') {
      indicators.push(
        (): Promise<HealthIndicatorResult> =>
          this.pgVectorHealth.isHealthy('pgvector'),
      );
    }

    return indicators;
  }

  @Get()
  @HealthCheck()
  async check(): Promise<HealthCheckResult> {
    return this.health.check(this.buildIndicators());
  }

  @Get('ready')
  @HealthCheck()
  async readiness(): Promise<HealthCheckResult> {
    return this.health.check(this.buildIndicators());
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    const backend = (process.env.VECTOR_BACKEND ?? 'qdrant').toLowerCase();
    const lines = [
      `engram_vector_backend_info{backend="${backend}"} 1`,
      'engram_pgvector_ready 0',
    ];

    if (backend === 'pgvector') {
      try {
        await this.pgVectorHealth.isHealthy('pgvector');
        lines[1] = 'engram_pgvector_ready 1';
      } catch {
        lines[1] = 'engram_pgvector_ready 0';
      }
    }

    if (!this.embeddingsService) {
      return `${lines.join('\n')}\n`;
    }

    const embeddingMetrics = this.embeddingsService.getPrometheusMetrics();
    return `${lines.join('\n')}\n${embeddingMetrics}`;
  }
}
