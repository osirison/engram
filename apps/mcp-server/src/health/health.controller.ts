import { Controller, Get, Header, Inject, Optional } from '@nestjs/common';
import { EmbeddingsService } from '@engram/embeddings';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import {
  resolveCapabilities,
  coerceDeploymentProfile,
  type ProfileCapabilities,
  DeploymentProfile,
} from '@engram/config';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { QdrantHealthIndicator } from './qdrant.health';
import { PgVectorHealthIndicator } from './pgvector.health';
import { MemoryStoreHealthIndicator } from './memory-store.health';
import { MetricsService } from '../metrics/metrics.service';

/**
 * Controller for `/health`, `/health/ready`, and `/health/metrics`.
 *
 * Every dependency indicator is {@link Optional} so the controller can be
 * instantiated in any profile without forcing the underlying service modules
 * to be present. Indicators that are not registered for the active profile
 * are simply skipped during check composition.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memoryStoreHealth: MemoryStoreHealthIndicator,
    @Optional() private readonly prismaHealth?: PrismaHealthIndicator,
    @Optional() private readonly redisHealth?: RedisHealthIndicator,
    @Optional() private readonly qdrantHealth?: QdrantHealthIndicator,
    @Optional() private readonly pgVectorHealth?: PgVectorHealthIndicator,
    @Optional() private readonly embeddingsService?: EmbeddingsService,
    @Optional() private readonly metricsService?: MetricsService,
    @Optional()
    @Inject('ENGRAM_PROFILE')
    private readonly injectedProfile?: DeploymentProfile,
  ) {}

  private activeCapabilities(): ProfileCapabilities {
    const profile = this.injectedProfile ?? this.resolveProfileFromEnv();
    return resolveCapabilities(profile);
  }

  private resolveProfileFromEnv(): DeploymentProfile {
    return coerceDeploymentProfile(process.env.DEPLOYMENT_PROFILE);
  }

  private buildIndicators(): Array<() => Promise<HealthIndicatorResult>> {
    const capabilities = this.activeCapabilities();
    const indicators: Array<() => Promise<HealthIndicatorResult>> = [
      async (): Promise<HealthIndicatorResult> =>
        Promise.resolve(this.memoryStoreHealth.isHealthy('memory-store')),
    ];

    if (capabilities.requiresDatabase) {
      const prisma = this.prismaHealth;
      if (prisma) {
        indicators.push(
          (): Promise<HealthIndicatorResult> => prisma.isHealthy('database'),
        );
      }
    }
    if (capabilities.requiresRedis) {
      const redis = this.redisHealth;
      if (redis) {
        indicators.push(
          (): Promise<HealthIndicatorResult> => redis.isHealthy('redis'),
        );
      }
    }
    if (capabilities.requiresQdrant) {
      const qdrant = this.qdrantHealth;
      if (qdrant) {
        indicators.push(
          (): Promise<HealthIndicatorResult> => qdrant.isHealthy('qdrant'),
        );
        const pg = this.pgVectorHealth;
        if (
          pg &&
          (process.env.VECTOR_BACKEND ?? 'qdrant').toLowerCase() === 'pgvector'
        ) {
          indicators.push(
            (): Promise<HealthIndicatorResult> => pg.isHealthy('pgvector'),
          );
        }
      }
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
    const capabilities = this.activeCapabilities();

    const parts: string[] = [];

    if (this.metricsService) {
      parts.push(await this.metricsService.getMetrics());
    }

    // Static info gauges (profile + vector backend).
    parts.push(
      `# HELP engram_vector_backend_info Active vector backend`,
      `# TYPE engram_vector_backend_info gauge`,
      `engram_vector_backend_info{backend="${backend}"} 1`,
      `# HELP engram_deployment_profile_info Active deployment profile`,
      `# TYPE engram_deployment_profile_info gauge`,
      `engram_deployment_profile_info{profile="${capabilities.profile}"} 1`,
    );

    // pgvector readiness (async health probe).
    let pgvectorReady = 0;
    if (
      backend === 'pgvector' &&
      capabilities.requiresQdrant &&
      this.pgVectorHealth
    ) {
      try {
        await this.pgVectorHealth.isHealthy('pgvector');
        pgvectorReady = 1;
      } catch {
        pgvectorReady = 0;
      }
    }
    parts.push(
      `# HELP engram_pgvector_ready Whether the pgvector extension is reachable`,
      `# TYPE engram_pgvector_ready gauge`,
      `engram_pgvector_ready ${pgvectorReady}`,
    );

    if (this.embeddingsService) {
      parts.push(this.embeddingsService.getPrometheusMetrics());
    }

    return parts.join('\n') + '\n';
  }
}
