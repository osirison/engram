import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '@engram/config';
import { LoggingModule, McpModule } from '@engram/core';
import { PrismaModule } from '@engram/database';
import { RedisModule } from '@engram/redis';
import { QdrantModule } from '@engram/vector-store';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      validate: (config: Record<string, unknown>) => validateEnv(config),
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    LoggingModule,
    McpModule,
    PrismaModule,
    RedisModule,
    QdrantModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
