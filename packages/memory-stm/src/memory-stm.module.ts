import { Module } from '@nestjs/common';
import { RedisModule } from '@engram/redis';
import { MemoryStmService } from './memory-stm.service';

@Module({
  imports: [RedisModule],
  providers: [MemoryStmService],
  exports: [MemoryStmService],
})
export class MemoryStmModule {}