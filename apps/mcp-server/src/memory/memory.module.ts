import {
  Module,
  type DynamicModule,
  type Provider,
  type Type,
} from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MemoryStmModule } from '@engram/memory-stm';
import { MemoryLtmModule } from '@engram/memory-ltm';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { MemoryAuditService } from './memory-audit.service';
import { PrismaModule } from '@engram/database';
import { RedisModule } from '@engram/redis';
import { ReindexQueueService } from './reindex-queue.service';
import { ConsolidationService } from './consolidation.service';
import { DecayService } from './decay.service';
import { InsightExtractionService } from './insight-extraction.service';
import type { ProfileCapabilities } from '@engram/config';
import { MetricsModule } from '../metrics/metrics.module';

@Module({})
export class MemoryModule {
  static forRoot(capabilities: ProfileCapabilities): DynamicModule {
    const imports: Array<Type<unknown> | DynamicModule> = [
      ScheduleModule.forRoot(),
      MemoryStmModule.forRoot(capabilities),
      MemoryLtmModule.forRoot(capabilities),
      MetricsModule,
    ];

    if (capabilities.requiresDatabase) {
      imports.push(PrismaModule);
    }
    if (capabilities.requiresRedis) {
      imports.push(RedisModule.forRoot());
    }

    const providers: Provider[] = [
      MemoryService,
      ConsolidationService,
      DecayService,
      InsightExtractionService,
    ];

    if (capabilities.requiresRedis) {
      providers.push(ReindexQueueService);
    }

    // Audit trail (WP2 T5) needs Postgres. Provided only when a DB is available;
    // the controller injects it @Optional() so memory/lite profiles still boot.
    const exports: Provider[] = [
      MemoryService,
      ConsolidationService,
      DecayService,
      InsightExtractionService,
    ];
    if (capabilities.requiresDatabase) {
      providers.push(MemoryAuditService);
      exports.push(MemoryAuditService);
    }

    return {
      module: MemoryModule,
      imports,
      controllers: [MemoryController],
      providers,
      exports,
    };
  }
}
