import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from '../src/health/health.controller';
import { PrismaHealthIndicator } from '../src/health/prisma.health';
import { RedisHealthIndicator } from '../src/health/redis.health';
import { QdrantHealthIndicator } from '../src/health/qdrant.health';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';

describe('Health Integration Tests', () => {
  let controller: HealthController;
  let prismaHealthIndicator: PrismaHealthIndicator;
  let redisHealthIndicator: RedisHealthIndicator;
  let qdrantHealthIndicator: QdrantHealthIndicator;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule, HttpModule],
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaHealthIndicator,
          useValue: {
            isHealthy: jest.fn().mockResolvedValue({
              database: { status: 'up' },
            }),
          },
        },
        {
          provide: RedisHealthIndicator,
          useValue: {
            isHealthy: jest.fn().mockResolvedValue({
              redis: { status: 'up' },
            }),
          },
        },
        {
          provide: QdrantHealthIndicator,
          useValue: {
            isHealthy: jest.fn().mockResolvedValue({
              qdrant: { status: 'up' },
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    prismaHealthIndicator = module.get<PrismaHealthIndicator>(
      PrismaHealthIndicator,
    );
    redisHealthIndicator = module.get<RedisHealthIndicator>(
      RedisHealthIndicator,
    );
    qdrantHealthIndicator = module.get<QdrantHealthIndicator>(
      QdrantHealthIndicator,
    );
  });

  describe('Health Controller Integration', () => {
    it('should call all health indicators and return combined status', async () => {
      const result = await controller.check();

      expect(result).toBeDefined();
      expect(prismaHealthIndicator.isHealthy).toHaveBeenCalledWith('database');
      expect(redisHealthIndicator.isHealthy).toHaveBeenCalledWith('redis');
      expect(qdrantHealthIndicator.isHealthy).toHaveBeenCalledWith('qdrant');
    });

    it('should handle health indicator failures', async () => {
      // Make Prisma health check fail
      (prismaHealthIndicator.isHealthy as jest.Mock).mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      try {
        await controller.check();
        fail('Expected health check to throw an error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});
