import { Module } from '@nestjs/common';
import { RedisModule, RedisService } from '@engram/redis';
import { EmbeddingsModule } from '@engram/embeddings';
import { MemoryStmService } from './memory-stm.service.js';

@Module({
  imports: [RedisModule, EmbeddingsModule],
  providers: [RedisService, MemoryStmService],
  exports: [MemoryStmService],
})
export class MemoryStmModule {}
