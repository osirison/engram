import { Module } from '@nestjs/common';
import { MemoryStmModule } from '@engram/memory-stm';
import { MemoryLtmModule } from '@engram/memory-ltm';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';

@Module({
  imports: [
    MemoryStmModule,
    MemoryLtmModule,
  ],
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
