import { Module } from '@nestjs/common';
import { MemoryStmModule } from '@engram/memory-stm';
import { MemoryLtmModule } from '@engram/memory-ltm';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { PrismaModule } from '@engram/database';
import { RedisModule } from '@engram/redis';
import { ReindexQueueService } from './reindex-queue.service';

@Module({
  imports: [MemoryStmModule, MemoryLtmModule, PrismaModule, RedisModule],
  controllers: [MemoryController],
  providers: [MemoryService, ReindexQueueService],
  exports: [MemoryService],
})
export class MemoryModule {}
