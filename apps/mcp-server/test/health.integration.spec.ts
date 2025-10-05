import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from '../src/health/health.controller';
import { PrismaHealthIndicator } from '../src/health/prisma.health';
import { RedisHealthIndicator } from '../src/health/redis.health';
import { QdrantHealthIndicator } from '../src/health/qdrant.health';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';

describe('Health Integration Tests', () => {
  let controller: HealthController;
  let prismaHealthMock: jest.Mock;
  let redisHealthMock: jest.Mock;
  let qdrantHealthMock: jest.Mock;

  beforeEach(async () => {
    prismaHealthMock = jest.fn().mockResolvedValue({
      database: { status: 'up' },
    });
    redisHealthMock = jest.fn().mockResolvedValue({
      redis: { status: 'up' },
    });
    qdrantHealthMock = jest.fn().mockResolvedValue({
      qdrant: { status: 'up' },
    });

    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule, HttpModule],
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaHealthIndicator,
          useValue: {
            isHealthy: prismaHealthMock,
          },
        },
        {
          provide: RedisHealthIndicator,
          useValue: {
            isHealthy: redisHealthMock,
          },
        },
        {
          provide: QdrantHealthIndicator,
          useValue: {
            isHealthy: qdrantHealthMock,
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('Health Controller Integration', () => {
    it('should call all health indicators and return combined status', async () => {
      const result = await controller.check();

      expect(result).toBeDefined();
      expect(prismaHealthMock).toHaveBeenCalledWith('database');
      expect(redisHealthMock).toHaveBeenCalledWith('redis');
      expect(qdrantHealthMock).toHaveBeenCalledWith('qdrant');
    });

    it('should handle health indicator failures', async () => {
      // Make Prisma health check fail
      prismaHealthMock.mockRejectedValueOnce(
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
