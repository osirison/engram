import { Module, type DynamicModule } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { EmbeddingsModule } from '@engram/embeddings';
import { RedisModule } from '@engram/redis';
import { QdrantModule, VectorStoreModule } from '@engram/vector-store';
import {
  usesPgVector,
  usesQdrant,
  type ProfileCapabilities,
} from '@engram/config';
import { HealthController } from './health.controller';
import { MetricsTokenGuard } from './metrics-token.guard';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { QdrantHealthIndicator } from './qdrant.health';
import { PgVectorHealthIndicator } from './pgvector.health';
import { MemoryStoreHealthIndicator } from './memory-store.health';
import { MetricsModule } from '../metrics/metrics.module';

@Module({})
export class HealthModule {
  /**
   * Profile-aware health module factory.
   *
   * Indicators that depend on services unavailable in the active profile are
   * omitted from the module graph so that Nest never tries to instantiate
   * them. The process-only `MemoryStoreHealthIndicator` is always present.
   */
  static forRoot(capabilities: ProfileCapabilities): DynamicModule {
    const providers: DynamicModule['providers'] = [
      MemoryStoreHealthIndicator,
      MetricsTokenGuard,
    ];
    const imports: DynamicModule['imports'] = [
      TerminusModule,
      HttpModule,
      EmbeddingsModule,
      MetricsModule,
    ];

    if (capabilities.requiresDatabase) {
      // PrismaModule is @Global() — no re-import needed; PrismaService is
      // available from the root context already.
      providers.push(PrismaHealthIndicator);
    }
    if (capabilities.requiresRedis) {
      imports.push(RedisModule.forRoot());
      providers.push(RedisHealthIndicator);
    }
    if (usesQdrant(capabilities, process.env.VECTOR_BACKEND)) {
      // Qdrant is a remote service wired only when the profile deploys it AND
      // it is the active vector backend. A Qdrant-bearing profile running
      // VECTOR_BACKEND=pgvector must not gate readiness on Qdrant (#193).
      imports.push(QdrantModule);
      providers.push(QdrantHealthIndicator);
    }
    if (usesPgVector(capabilities, process.env.VECTOR_BACKEND)) {
      // pgvector lives in Postgres, so it is health-checkable in any profile
      // with a database (LITE and ENTERPRISE) — independent of requiresQdrant.
      // VectorStoreModule provides the active VectorStore under
      // VECTOR_STORE_TOKEN, which PgVectorHealthIndicator probes.
      imports.push(VectorStoreModule);
      providers.push(PgVectorHealthIndicator);
    }

    return {
      module: HealthModule,
      imports,
      controllers: [HealthController],
      providers,
      exports: providers,
    };
  }
}
