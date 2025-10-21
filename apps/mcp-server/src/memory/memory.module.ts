import { Module } from '@nestjs/common';
// TODO: Re-enable when packages are properly built
// import { MemoryStmModule } from '@engram/memory-stm';
// import { MemoryLtmModule } from '@engram/memory-ltm';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';

@Module({
  imports: [
    // TODO: Re-enable when packages are properly built
    // MemoryStmModule,
    // MemoryLtmModule
  ],
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
