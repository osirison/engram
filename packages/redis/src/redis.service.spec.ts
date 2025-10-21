import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from './redis.service.js';
import type Redis from 'ioredis';

// Mock Redis client
const mockRedisClient = {
  get: vi.fn(),
  set: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  exists: vi.fn(),
  expire: vi.fn(),
  ttl: vi.fn(),
  incr: vi.fn(),
  incrby: vi.fn(),
  ping: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  status: 'ready',
} as unknown as Redis;

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(async () => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: 'REDIS_CLIENT',
          useValue: mockRedisClient,
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
  });

  describe('get', () => {
    it('should retrieve a value from Redis', async () => {
      const key = 'test-key';
      const value = 'test-value';
      mockRedisClient.get = vi.fn().mockResolvedValue(value);

      const result = await service.get(key);

      expect(mockRedisClient.get).toHaveBeenCalledWith(key);
      expect(result).toBe(value);
    });

    it('should return null when key does not exist', async () => {
      const key = 'non-existent-key';
      mockRedisClient.get = vi.fn().mockResolvedValue(null);

      const result = await service.get(key);

      expect(mockRedisClient.get).toHaveBeenCalledWith(key);
      expect(result).toBeNull();
    });

    it('should throw error when Redis operation fails', async () => {
      const key = 'test-key';
      const error = new Error('Redis connection failed');
      mockRedisClient.get = vi.fn().mockRejectedValue(error);

      await expect(service.get(key)).rejects.toThrow('Redis connection failed');
    });
  });

  describe('set', () => {
    it('should set a value without TTL', async () => {
      const key = 'test-key';
      const value = 'test-value';
      mockRedisClient.set = vi.fn().mockResolvedValue('OK');

      await service.set(key, value);

      expect(mockRedisClient.set).toHaveBeenCalledWith(key, value);
      expect(mockRedisClient.setex).not.toHaveBeenCalled();
    });

    it('should set a value with TTL', async () => {
      const key = 'test-key';
      const value = 'test-value';
      const ttl = 300;
      mockRedisClient.setex = vi.fn().mockResolvedValue('OK');

      await service.set(key, value, ttl);

      expect(mockRedisClient.setex).toHaveBeenCalledWith(key, ttl, value);
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('should throw error when Redis operation fails', async () => {
      const key = 'test-key';
      const value = 'test-value';
      const error = new Error('Redis connection failed');
      mockRedisClient.set = vi.fn().mockRejectedValue(error);

      await expect(service.set(key, value)).rejects.toThrow('Redis connection failed');
    });
  });

  describe('del', () => {
    it('should delete a key and return count', async () => {
      const key = 'test-key';
      const deletedCount = 1;
      mockRedisClient.del = vi.fn().mockResolvedValue(deletedCount);

      const result = await service.del(key);

      expect(mockRedisClient.del).toHaveBeenCalledWith(key);
      expect(result).toBe(deletedCount);
    });

    it('should return 0 when key does not exist', async () => {
      const key = 'non-existent-key';
      mockRedisClient.del = vi.fn().mockResolvedValue(0);

      const result = await service.del(key);

      expect(mockRedisClient.del).toHaveBeenCalledWith(key);
      expect(result).toBe(0);
    });

    it('should throw error when Redis operation fails', async () => {
      const key = 'test-key';
      const error = new Error('Redis connection failed');
      mockRedisClient.del = vi.fn().mockRejectedValue(error);

      await expect(service.del(key)).rejects.toThrow('Redis connection failed');
    });
  });

  describe('exists', () => {
    it('should return true when key exists', async () => {
      const key = 'test-key';
      mockRedisClient.exists = vi.fn().mockResolvedValue(1);

      const result = await service.exists(key);

      expect(mockRedisClient.exists).toHaveBeenCalledWith(key);
      expect(result).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      const key = 'non-existent-key';
      mockRedisClient.exists = vi.fn().mockResolvedValue(0);

      const result = await service.exists(key);

      expect(mockRedisClient.exists).toHaveBeenCalledWith(key);
      expect(result).toBe(false);
    });

    it('should throw error when Redis operation fails', async () => {
      const key = 'test-key';
      const error = new Error('Redis connection failed');
      mockRedisClient.exists = vi.fn().mockRejectedValue(error);

      await expect(service.exists(key)).rejects.toThrow('Redis connection failed');
    });
  });

  describe('expire', () => {
    it('should set expiration and return true when key exists', async () => {
      const key = 'test-key';
      const ttl = 300;
      mockRedisClient.expire = vi.fn().mockResolvedValue(1);

      const result = await service.expire(key, ttl);

      expect(mockRedisClient.expire).toHaveBeenCalledWith(key, ttl);
      expect(result).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      const key = 'non-existent-key';
      const ttl = 300;
      mockRedisClient.expire = vi.fn().mockResolvedValue(0);

      const result = await service.expire(key, ttl);

      expect(mockRedisClient.expire).toHaveBeenCalledWith(key, ttl);
      expect(result).toBe(false);
    });

    it('should throw error when Redis operation fails', async () => {
      const key = 'test-key';
      const ttl = 300;
      const error = new Error('Redis connection failed');
      mockRedisClient.expire = vi.fn().mockRejectedValue(error);

      await expect(service.expire(key, ttl)).rejects.toThrow('Redis connection failed');
    });
  });

  describe('ttl', () => {
    it('should return TTL in seconds', async () => {
      const key = 'test-key';
      const ttl = 300;
      mockRedisClient.ttl = vi.fn().mockResolvedValue(ttl);

      const result = await service.ttl(key);

      expect(mockRedisClient.ttl).toHaveBeenCalledWith(key);
      expect(result).toBe(ttl);
    });

    it('should return -1 when key has no expiration', async () => {
      const key = 'test-key';
      mockRedisClient.ttl = vi.fn().mockResolvedValue(-1);

      const result = await service.ttl(key);

      expect(mockRedisClient.ttl).toHaveBeenCalledWith(key);
      expect(result).toBe(-1);
    });

    it('should return -2 when key does not exist', async () => {
      const key = 'non-existent-key';
      mockRedisClient.ttl = vi.fn().mockResolvedValue(-2);

      const result = await service.ttl(key);

      expect(mockRedisClient.ttl).toHaveBeenCalledWith(key);
      expect(result).toBe(-2);
    });

    it('should throw error when Redis operation fails', async () => {
      const key = 'test-key';
      const error = new Error('Redis connection failed');
      mockRedisClient.ttl = vi.fn().mockRejectedValue(error);

      await expect(service.ttl(key)).rejects.toThrow('Redis connection failed');
    });
  });

  describe('incr', () => {
    it('should increment by 1 when no value provided', async () => {
      const key = 'counter-key';
      const newValue = 5;
      mockRedisClient.incr = vi.fn().mockResolvedValue(newValue);

      const result = await service.incr(key);

      expect(mockRedisClient.incr).toHaveBeenCalledWith(key);
      expect(mockRedisClient.incrby).not.toHaveBeenCalled();
      expect(result).toBe(newValue);
    });

    it('should increment by specified value', async () => {
      const key = 'counter-key';
      const increment = 5;
      const newValue = 10;
      mockRedisClient.incrby = vi.fn().mockResolvedValue(newValue);

      const result = await service.incr(key, increment);

      expect(mockRedisClient.incrby).toHaveBeenCalledWith(key, increment);
      expect(mockRedisClient.incr).not.toHaveBeenCalled();
      expect(result).toBe(newValue);
    });

    it('should throw error when Redis operation fails', async () => {
      const key = 'counter-key';
      const error = new Error('Redis connection failed');
      mockRedisClient.incr = vi.fn().mockRejectedValue(error);

      await expect(service.incr(key)).rejects.toThrow('Redis connection failed');
    });
  });

  describe('isHealthy', () => {
    it('should return true when Redis responds with PONG and is ready', async () => {
      mockRedisClient.status = 'ready';
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');

      const result = await service.isHealthy();

      expect(mockRedisClient.ping).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should connect and return true when Redis is not ready initially', async () => {
      mockRedisClient.status = 'connecting';
      mockRedisClient.connect = vi.fn().mockResolvedValue(undefined);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');

      const result = await service.isHealthy();

      expect(mockRedisClient.connect).toHaveBeenCalled();
      expect(mockRedisClient.ping).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when Redis responds with unexpected value', async () => {
      mockRedisClient.status = 'ready';
      mockRedisClient.ping = vi.fn().mockResolvedValue('UNEXPECTED');

      const result = await service.isHealthy();

      expect(mockRedisClient.ping).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('should return false when Redis operation fails', async () => {
      mockRedisClient.status = 'ready';
      const error = new Error('Redis connection failed');
      mockRedisClient.ping = vi.fn().mockRejectedValue(error);

      const result = await service.isHealthy();

      expect(mockRedisClient.ping).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('should return false when health check times out', async () => {
      mockRedisClient.status = 'ready';
      // Mock a slow ping that would timeout
      mockRedisClient.ping = vi.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve('PONG'), 5000))
      );

      const result = await service.isHealthy();

      expect(mockRedisClient.ping).toHaveBeenCalled();
      expect(result).toBe(false);
    }, 10000); // Extend test timeout
  });

  describe('getStatus', () => {
    it('should return Redis client status', () => {
      const result = service.getStatus();

      expect(result).toBe('ready');
    });
  });

  describe('disconnect', () => {
    it('should disconnect from Redis', async () => {
      mockRedisClient.disconnect = vi.fn().mockResolvedValue(undefined);

      await service.disconnect();

      expect(mockRedisClient.disconnect).toHaveBeenCalled();
    });

    it('should throw error when disconnect fails', async () => {
      const error = new Error('Disconnect failed');
      mockRedisClient.disconnect = vi.fn().mockRejectedValue(error);

      await expect(service.disconnect()).rejects.toThrow('Disconnect failed');
    });
  });
});
