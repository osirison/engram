import { Module, type DynamicModule, Logger } from '@nestjs/common';
import { PrismaModule } from '@engram/database';
import { EmbeddingsModule } from '@engram/embeddings';
import { VectorStoreModule } from '@engram/vector-store';
import type { ProfileCapabilities } from '@engram/config';
import { MemoryStmModule } from '@engram/memory-stm';
import { MemoryLtmService } from './memory-ltm.service.js';
import { CorpusConsolidationService } from './corpus-consolidation.service.js';
import { ImportanceScoringService } from './importance.service.js';
import { DuplicateDetectionService } from './duplicate-detection.service.js';
import { ContradictionDetectionService } from './contradiction-detection.service.js';
import { IngestPipelineService } from './ingest/ingest-pipeline.service.js';
import { PrivacyFilterStep } from './ingest/privacy-filter.step.js';
import { TopicDetectorStep } from './ingest/topic-detector.step.js';

/**
 * Token that resolves to whichever LTM implementation is active for the
 * current deployment profile. The Postgres-backed `MemoryLtmService` is
 * used for profile-enterprise / profile-lite; `InMemoryLtmAdapter` is
 * used for profile-memory so the process can boot with no external
 * services.
 */
export const LTM_PROVIDER = Symbol.for('engram.memory-ltm.provider');

const logger = new Logger('MemoryLtmModule');

/**
 * Profile-aware LTM module factory.
 *
 * The selected implementation is bound to the {@link LTM_PROVIDER} symbol
 * so consumers can inject a single type-agnostic handle. The legacy
 * `MemoryLtmModule` (default export) is still usable for tests and
 * non-profile consumers.
 */
@Module({})
export class MemoryLtmModule {
  static forRoot(capabilities: ProfileCapabilities): DynamicModule {
    logger.log(`Profile=${capabilities.profile}: wiring Postgres LTM service`);

    return {
      module: MemoryLtmModule,
      imports: [
        PrismaModule,
        EmbeddingsModule,
        VectorStoreModule,
        MemoryStmModule.forRoot(capabilities),
      ],
      providers: [
        MemoryLtmService,
        ImportanceScoringService,
        DuplicateDetectionService,
        ContradictionDetectionService,
        IngestPipelineService,
        PrivacyFilterStep,
        TopicDetectorStep,
        CorpusConsolidationService,
        {
          provide: LTM_PROVIDER,
          useExisting: MemoryLtmService,
        },
      ],
      exports: [LTM_PROVIDER, MemoryLtmService, CorpusConsolidationService],
    };
  }
}
