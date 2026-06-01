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

  @Get()
  @HealthCheck()
  async check(): Promise<HealthCheckResult> {
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

    return this.health.check(indicators);
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  getMetrics(): string {
    if (!this.embeddingsService) {
      return '';
    }

    return this.embeddingsService.getPrometheusMetrics();
  }
}
