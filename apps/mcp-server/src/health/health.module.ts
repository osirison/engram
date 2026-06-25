import { Module, type DynamicModule } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '@engram/database';
import { EmbeddingsModule } from '@engram/embeddings';
import { RedisModule } from '@engram/redis';
import { QdrantModule, VectorStoreModule } from '@engram/vector-store';
import type { ProfileCapabilities } from '@engram/config';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { QdrantHealthIndicator } from './qdrant.health';
import { PgVectorHealthIndicator } from './pgvector.health';
import { MemoryStoreHealthIndicator } from './memory-store.health';

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
    const providers: DynamicModule['providers'] = [MemoryStoreHealthIndicator];
    const imports: DynamicModule['imports'] = [
      TerminusModule,
      HttpModule,
      EmbeddingsModule,
    ];

    if (capabilities.requiresDatabase) {
      imports.push(PrismaModule);
      providers.push(PrismaHealthIndicator);
    }
    if (capabilities.requiresRedis) {
      imports.push(RedisModule.forRoot());
      providers.push(RedisHealthIndicator);
    }
    if (capabilities.requiresQdrant) {
      imports.push(QdrantModule, VectorStoreModule);
      providers.push(QdrantHealthIndicator, PgVectorHealthIndicator);
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
