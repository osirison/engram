import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '@engram/database';
import { RedisModule } from '@engram/redis';
import { QdrantModule } from '@engram/vector-store';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { QdrantHealthIndicator } from './qdrant.health';

@Module({
  imports: [
    TerminusModule,
    HttpModule,
    PrismaModule,
    RedisModule,
    QdrantModule,
  ],
  controllers: [HealthController],
  providers: [
    PrismaHealthIndicator,
    RedisHealthIndicator,
    QdrantHealthIndicator,
  ],
})
export class HealthModule {}
