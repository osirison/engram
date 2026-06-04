import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateEnv } from '@engram/config';
import { LoggingModule, McpModule } from '@engram/core';
import { PrismaModule } from '@engram/database';
import { RedisModule } from '@engram/redis';
import { QdrantModule } from '@engram/vector-store';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { MemoryModule } from './memory/memory.module';

const runValidateEnv = validateEnv as (
  config: Record<string, unknown>,
) => Record<string, unknown>;

const envFileCandidates = [
  resolve(__dirname, '../../../.env'),
  resolve(process.cwd(), '.env'),
];

@Module({
  imports: [
    ConfigModule.forRoot({
      validate: (config: Record<string, unknown>): Record<string, unknown> =>
        runValidateEnv(config),
      isGlobal: true,
      envFilePath: envFileCandidates,
    }),
    LoggingModule,
    McpModule,
    PrismaModule,
    RedisModule,
    QdrantModule,
    HealthModule,
    MemoryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
