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

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly qdrantHealth: QdrantHealthIndicator,
    @Optional() private readonly embeddingsService?: EmbeddingsService,
  ) {}

  @Get()
  @HealthCheck()
  async check(): Promise<HealthCheckResult> {
    return this.health.check([
      (): Promise<HealthIndicatorResult> =>
        this.prismaHealth.isHealthy('database'),
      (): Promise<HealthIndicatorResult> => this.redisHealth.isHealthy('redis'),
      (): Promise<HealthIndicatorResult> =>
        this.qdrantHealth.isHealthy('qdrant'),
    ]);
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
