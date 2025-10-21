import { Module, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisService } from './redis.service.js';

@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (): Redis => {
        const logger = new Logger('RedisModule');
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

        const redis = new Redis(redisUrl, {
          retryStrategy: (times): number => {
            return Math.min(times * 50, 2000);
          },
          maxRetriesPerRequest: 3,
          lazyConnect: false, // ✅ Enable immediate connection
          enableOfflineQueue: true, // ✅ Enable command queuing
          connectTimeout: 10000, // ✅ Add connection timeout
          commandTimeout: 5000, // ✅ Add command timeout
          enableReadyCheck: true, // ✅ Enable ready state check
          reconnectOnError: (err): boolean => {
            const targetError = 'READONLY';
            return err.message.includes(targetError);
          },
        });

        // Handle connection events
        redis.on('connect', () => {
          logger.log('Redis client connected');
        });

        redis.on('ready', () => {
          logger.log('Redis client ready');
        });

        redis.on('error', (err) => {
          logger.error('Redis client error:', err);
        });

        redis.on('close', () => {
          logger.log('Redis client connection closed');
        });

        return redis;
      },
    },
    RedisService,
  ],
  exports: ['REDIS_CLIENT', RedisService],
})
export class RedisModule {}
