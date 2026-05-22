import { Module } from '@nestjs/common';
import { PrismaModule } from '@engram/database';
import { EmbeddingsModule } from '@engram/embeddings';
import { MemoryLtmService } from './memory-ltm.service.js';

@Module({
  imports: [PrismaModule, EmbeddingsModule],
  providers: [MemoryLtmService],
  exports: [MemoryLtmService],
})
export class MemoryLtmModule {}
