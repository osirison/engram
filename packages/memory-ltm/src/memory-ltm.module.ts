import { Module } from '@nestjs/common';
import { PrismaModule } from '@engram/database';
import { EmbeddingsModule } from '@engram/embeddings';
import { VectorStoreModule } from '@engram/vector-store';
import { MemoryLtmService } from './memory-ltm.service.js';
import { ImportanceScoringService } from './importance.service.js';
import { DuplicateDetectionService } from './duplicate-detection.service.js';

@Module({
  imports: [PrismaModule, EmbeddingsModule, VectorStoreModule],
  providers: [MemoryLtmService, ImportanceScoringService, DuplicateDetectionService],
  exports: [MemoryLtmService, ImportanceScoringService, DuplicateDetectionService],
})
export class MemoryLtmModule {}
