import { Test, TestingModule } from '@nestjs/testing';
import { RedisHealthIndicator } from './redis.health';
import { RedisService } from '@engram/redis';
import { HealthCheckError } from '@nestjs/terminus';

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let redisService: RedisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisHealthIndicator,
        {
          provide: RedisService,
          useValue: {
            isHealthy: jest.fn(),
          } as Partial<RedisService>,
        },
      ],
    }).compile();

    indicator = module.get<RedisHealthIndicator>(RedisHealthIndicator);
    redisService = module.get<RedisService>(RedisService);
  });

  it('should be defined', () => {
    expect(indicator).toBeDefined();
  });

  it('should return healthy status when Redis is accessible', async () => {
    jest.spyOn(redisService, 'isHealthy').mockResolvedValue(true);

    const result = await indicator.isHealthy('redis');

    expect(result).toEqual({
      redis: {
        status: 'up',
      },
    });
  });

  it('should throw HealthCheckError when Redis is not accessible', async () => {
    jest.spyOn(redisService, 'isHealthy').mockResolvedValue(false);

    await expect(indicator.isHealthy('redis')).rejects.toThrow(
      HealthCheckError,
    );
  });
});
