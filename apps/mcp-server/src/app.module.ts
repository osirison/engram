import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '@engram/config';
import { LoggingModule } from '@engram/core';
import { RedisModule } from '@engram/redis';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      validate: validateEnv,
      isGlobal: true,
    }),
    LoggingModule,
    RedisModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
