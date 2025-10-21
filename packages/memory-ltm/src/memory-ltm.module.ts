import { Module } from '@nestjs/common';
import { PrismaModule } from '@engram/database';
import { MemoryLtmService } from './memory-ltm.service';

@Module({
  imports: [PrismaModule],
  providers: [MemoryLtmService],
  exports: [MemoryLtmService],
})
export class MemoryLtmModule {}