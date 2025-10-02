import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '@engram/config';
import { LoggingModule } from '@engram/core';
import { RedisModule } from '@engram/redis';
import { QdrantModule } from '@engram/vector-store';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      validate: validateEnv,
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    LoggingModule,
    RedisModule,
    QdrantModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
