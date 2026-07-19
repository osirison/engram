import { Module, type DynamicModule } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { EmbeddingsModule } from '@engram/embeddings';
import { VectorStoreModule } from '@engram/vector-store';
import { usesPgVector, type ProfileCapabilities } from '@engram/config';
import { HealthController } from './health.controller';
import { MetricsTokenGuard } from './metrics-token.guard';
import { PrismaHealthIndicator } from './prisma.health';
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
    if (usesPgVector(capabilities)) {
      // pgvector lives in Postgres, so it is health-checkable in any profile
      // with a database (LITE and ENTERPRISE). VectorStoreModule provides the
      // VectorStore under VECTOR_STORE_TOKEN, which PgVectorHealthIndicator
      // probes.
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
