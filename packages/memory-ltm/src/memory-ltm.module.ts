import { Module, type DynamicModule, Logger } from '@nestjs/common';
import { PrismaModule } from '@engram/database';
import { EmbeddingsModule } from '@engram/embeddings';
import { VectorStoreModule } from '@engram/vector-store';
import type { ProfileCapabilities } from '@engram/config';
import { MemoryStmModule } from '@engram/memory-stm';
import { MemoryLtmService } from './memory-ltm.service.js';
import { ImportanceScoringService } from './importance.service.js';
import { DuplicateDetectionService } from './duplicate-detection.service.js';
import { ContradictionDetectionService } from './contradiction-detection.service.js';
import { IngestPipelineService } from './ingest/ingest-pipeline.service.js';
import { PrivacyFilterStep } from './ingest/privacy-filter.step.js';
import { TopicDetectorStep } from './ingest/topic-detector.step.js';
import { InMemoryLtmAdapter } from './adapters/inmemory-ltm.adapter.js';
import { HybridTransientRetriever } from './retrieval/hybrid-transient-retriever.js';

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
    const useInProcess = capabilities.profile === 'memory';

    if (useInProcess) {
      logger.log('Profile=memory: wiring in-process LTM adapter (no Postgres required)');
    }

    return {
      module: MemoryLtmModule,
      imports: useInProcess
        ? [MemoryStmModule.forRoot(capabilities), EmbeddingsModule, VectorStoreModule]
        : [
            PrismaModule,
            EmbeddingsModule,
            VectorStoreModule,
            MemoryStmModule.forRoot(capabilities),
          ],
      providers: useInProcess
        ? [
            InMemoryLtmAdapter,
            HybridTransientRetriever,
            {
              provide: LTM_PROVIDER,
              useExisting: InMemoryLtmAdapter,
            },
            {
              provide: MemoryLtmService,
              useExisting: InMemoryLtmAdapter,
            },
          ]
        : [
            MemoryLtmService,
            ImportanceScoringService,
            DuplicateDetectionService,
            ContradictionDetectionService,
            IngestPipelineService,
            PrivacyFilterStep,
            TopicDetectorStep,
            {
              provide: LTM_PROVIDER,
              useExisting: MemoryLtmService,
            },
          ],
      exports: [LTM_PROVIDER, MemoryLtmService, InMemoryLtmAdapter, HybridTransientRetriever],
    };
  }
}
