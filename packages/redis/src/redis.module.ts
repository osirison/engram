import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisService } from './redis.service.js';

@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        
        const redis = new Redis(redisUrl, {
          retryStrategy: (times) => {
            return Math.min(times * 50, 2000);
          },
          maxRetriesPerRequest: 3,
          lazyConnect: true,
          enableOfflineQueue: false,
          reconnectOnError: (err) => {
            const targetError = 'READONLY';
            return err.message.includes(targetError);
          },
        });

        // Handle connection events
        redis.on('connect', () => {
          console.log('Redis client connected');
        });

        redis.on('error', (err) => {
          console.error('Redis client error:', err);
        });

        redis.on('close', () => {
          console.log('Redis client connection closed');
        });

        return redis;
      },
    },
    RedisService,
  ],
  exports: ['REDIS_CLIENT', RedisService],
})
export class RedisModule {}