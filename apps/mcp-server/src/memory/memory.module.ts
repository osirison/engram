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

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MemoryStmModule,
    MemoryLtmModule,
    PrismaModule,
    RedisModule,
  ],
  controllers: [MemoryController],
  providers: [MemoryService, ReindexQueueService, ConsolidationService],
  exports: [MemoryService, ConsolidationService],
})
export class MemoryModule {}
