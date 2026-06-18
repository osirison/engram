import { Module } from '@nestjs/common';
import { PrismaModule } from '@engram/database';
import { EmbeddingsModule } from '@engram/embeddings';
import { VectorStoreModule } from '@engram/vector-store';
import { MemoryLtmService } from './memory-ltm.service.js';
import { ImportanceScoringService } from './importance.service.js';
import { DuplicateDetectionService } from './duplicate-detection.service.js';
import { ContradictionDetectionService } from './contradiction-detection.service.js';
import { IngestPipelineService } from './ingest/ingest-pipeline.service.js';
import { PrivacyFilterStep } from './ingest/privacy-filter.step.js';
import { TopicDetectorStep } from './ingest/topic-detector.step.js';

@Module({
  imports: [PrismaModule, EmbeddingsModule, VectorStoreModule],
  providers: [
    MemoryLtmService,
    ImportanceScoringService,
    DuplicateDetectionService,
    ContradictionDetectionService,
    IngestPipelineService,
    PrivacyFilterStep,
    TopicDetectorStep,
  ],
  exports: [
    MemoryLtmService,
    ImportanceScoringService,
    DuplicateDetectionService,
    ContradictionDetectionService,
    IngestPipelineService,
  ],
})
export class MemoryLtmModule {}
