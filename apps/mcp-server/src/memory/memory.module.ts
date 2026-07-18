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
import { StmSweepService } from './stm-sweep.service';
import { CorpusConsolidationSchedulerService } from './corpus-consolidation-scheduler.service';
import { InsightExtractionService } from './insight-extraction.service';
import { MemoryExportService } from './export/memory-export.service';
import {
  MemoryImportService,
  ImportLedgerService,
  LinkResolver,
  SecretScanner,
  ADAPTER_REGISTRY,
  buildAdapterRegistry,
} from '@engram/memory-import';
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
      // Corpus-consolidation scheduler (G3-T2): registered unconditionally
      // like DecayService, but doubly gated — MEMORY_CONSOLIDATION_INTERVAL_MS
      // defaults to 0 (OFF, review gate) and the underlying Postgres-only
      // CorpusConsolidationService is injected @Optional().
      CorpusConsolidationSchedulerService,
      InsightExtractionService,
      // Expired-STM sweep: no-ops unless the active STM provider exposes
      // sweepExpired (i.e. the Postgres adapter on DB-bearing profiles).
      StmSweepService,
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
      CorpusConsolidationSchedulerService,
      InsightExtractionService,
    ];
    if (capabilities.requiresDatabase) {
      providers.push(MemoryAuditService);
      exports.push(MemoryAuditService);
      // Markdown export (WP3 T5) reads LTM (+ optional STM) via Postgres.
      providers.push(MemoryExportService);
      exports.push(MemoryExportService);
      // Agentic memory import (WP4 T3/T12/T13) — provided directly here so it
      // reuses this module's single MemoryLtmService (like MemoryExportService)
      // rather than nesting MemoryImportModule (which would duplicate it).
      providers.push(
        ImportLedgerService,
        LinkResolver,
        SecretScanner,
        { provide: ADAPTER_REGISTRY, useFactory: buildAdapterRegistry },
        MemoryImportService,
      );
      exports.push(MemoryImportService);
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
