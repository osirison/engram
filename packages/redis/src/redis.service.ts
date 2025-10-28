import { Injectable, Inject, Logger } from '@nestjs/common';
import type Redis from 'ioredis';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /**
   * Get a value from Redis by key
   * @param key - The key to retrieve
   * @returns The value or null if not found
   */
  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      this.logger.error('Redis GET error:', error);
      throw error;
    }
  }

  /**
   * Set a value in Redis with optional TTL
   * @param key - The key to set
   * @param value - The value to store
   * @param ttl - Time to live in seconds (optional)
   */
  async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      if (ttl) {
        await this.redis.setex(key, ttl, value);
      } else {
        await this.redis.set(key, value);
      }
    } catch (error) {
      this.logger.error('Redis SET error:', error);
      throw error;
    }
  }

  /**
   * Delete a key from Redis
   * @param key - The key to delete
   * @returns Number of keys deleted
   */
  async del(key: string): Promise<number> {
    try {
      return await this.redis.del(key);
    } catch (error) {
      this.logger.error('Redis DEL error:', error);
      throw error;
    }
  }

  /**
   * Delete multiple keys from Redis
   * @param keys - The keys to delete
   * @returns Number of keys deleted
   */
  async delMany(keys: string[]): Promise<number> {
    try {
      if (keys.length === 0) {
        return 0;
      }
      return await this.redis.del(...keys);
    } catch (error) {
      this.logger.error('Redis DEL (multi) error:', error);
      throw error;
    }
  }

  /**
   * Check if a key exists in Redis
   * @param key - The key to check
   * @returns True if key exists, false otherwise
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error('Redis EXISTS error:', error);
      throw error;
    }
  }

  /**
   * Set expiration time for a key
   * @param key - The key to set expiration for
   * @param ttl - Time to live in seconds
   * @returns True if expiration was set, false if key doesn't exist
   */
  async expire(key: string, ttl: number): Promise<boolean> {
    try {
      const result = await this.redis.expire(key, ttl);
      return result === 1;
    } catch (error) {
      this.logger.error('Redis EXPIRE error:', error);
      throw error;
    }
  }

  /**
   * Get time to live for a key
   * @param key - The key to check TTL for
   * @returns TTL in seconds, -1 if no expiration, -2 if key doesn't exist
   */
  async ttl(key: string): Promise<number> {
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      this.logger.error('Redis TTL error:', error);
      throw error;
    }
  }

  /**
   * Increment a numeric value stored at key
   * @param key - The key to increment
   * @param value - Amount to increment by (default: 1)
   * @returns The new value after increment
   */
  async incr(key: string, value: number = 1): Promise<number> {
    try {
      if (value === 1) {
        return await this.redis.incr(key);
      } else {
        return await this.redis.incrby(key, value);
      }
    } catch (error) {
      this.logger.error('Redis INCR error:', error);
      throw error;
    }
  }

  /**
   * Get Redis client health status
   * @returns True if connected, false otherwise
   */
  async isHealthy(): Promise<boolean> {
    try {
      // Ensure connection is established
      if (this.redis.status !== 'ready') {
        try {
          await this.redis.connect();
        } catch (connError) {
          this.logger.error(
            'Redis connection error during health check:',
            connError instanceof Error ? connError.message : 'Unknown error'
          );
          return false;
        }
      }

      // Test with ping command and timeout
      let timeout: NodeJS.Timeout | undefined;
      try {
        const result = await Promise.race([
          this.redis.ping(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Health check timeout')), 3000);
          }),
        ]);
        return result === 'PONG';
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    } catch (error) {
      this.logger.error(
        'Redis health check failed:',
        error instanceof Error ? error.message : 'Unknown error'
      );
      return false;
    }
  }

  /**
   * Get Redis client connection status
   * @returns Connection status string
   */
  getStatus(): string {
    return this.redis.status;
  }

  /**
   * Disconnect from Redis (graceful shutdown)
   */
  async disconnect(): Promise<void> {
    try {
      await this.redis.disconnect();
    } catch (error) {
      this.logger.error('Redis disconnect error:', error);
      throw error;
    }
  }

  /**
   * Scan Redis keys matching a pattern
   * @param cursor - The cursor to start from (0 to start new scan)
   * @param pattern - The pattern to match keys against
   * @param count - The number of keys to scan per iteration (hint to Redis)
   * @returns Object containing next cursor and matching keys
   */
  async scan(
    cursor: string,
    options: { match?: string; count?: number } = {}
  ): Promise<{ cursor: string; keys: string[] }> {
    try {
      let result: [string, string[]];
      
      if (options.match && options.count) {
        result = await this.redis.scan(cursor, 'MATCH', options.match, 'COUNT', options.count);
      } else if (options.match) {
        result = await this.redis.scan(cursor, 'MATCH', options.match);
      } else if (options.count) {
        result = await this.redis.scan(cursor, 'COUNT', options.count);
      } else {
        result = await this.redis.scan(cursor);
      }

      return {
        cursor: result[0],
        keys: result[1],
      };
    } catch (error) {
      this.logger.error('Redis SCAN error:', error);
      throw error;
    }
  }

  /**
   * Create a Redis pipeline for batch operations
   * @returns Pipeline object that can be used to queue multiple commands
   */
  pipeline(): ReturnType<Redis['pipeline']> {
    return this.redis.pipeline();
  }

  /**
   * Get access to the underlying Redis client for advanced operations
   * @returns The ioredis client instance
   */
  getClient(): Redis {
    return this.redis;
  }
}
