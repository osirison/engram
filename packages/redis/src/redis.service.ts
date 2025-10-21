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
          this.logger.error('Redis connection error during health check:', connError instanceof Error ? connError.message : 'Unknown error');
          return false;
        }
      }
      
      // Test with ping command and timeout
      const result = await Promise.race([
        this.redis.ping(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 3000)
        )
      ]);
      
      return result === 'PONG';
    } catch (error) {
      this.logger.error('Redis health check failed:', error instanceof Error ? error.message : 'Unknown error');
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
}
