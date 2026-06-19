import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MemoryStmModule } from '@engram/memory-stm';
import { MemoryLtmModule } from '@engram/memory-ltm';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { PrismaModule } from '@engram/database';
import { RedisModule } from '@engram/redis';
import { ReindexQueueService } from './reindex-queue.service';
import { ConsolidationService } from './consolidation.service';
import { DecayService } from './decay.service';
import { InsightExtractionService } from './insight-extraction.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MemoryStmModule,
    MemoryLtmModule,
    PrismaModule,
    RedisModule,
  ],
  controllers: [MemoryController],
  providers: [
    MemoryService,
    ReindexQueueService,
    ConsolidationService,
    DecayService,
    InsightExtractionService,
  ],
  exports: [
    MemoryService,
    ConsolidationService,
    DecayService,
    InsightExtractionService,
  ],
})
export class MemoryModule {}
