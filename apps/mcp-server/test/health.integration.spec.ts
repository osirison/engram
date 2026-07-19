import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from '../src/health/health.controller';
import { PrismaHealthIndicator } from '../src/health/prisma.health';
import { RedisHealthIndicator } from '../src/health/redis.health';
import { PgVectorHealthIndicator } from '../src/health/pgvector.health';
import { MemoryStoreHealthIndicator } from '../src/health/memory-store.health';
import { DeploymentProfile } from '@engram/config';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';

describe('Health Integration Tests', () => {
  let controller: HealthController;
  let prismaHealthMock: jest.Mock;
  let redisHealthMock: jest.Mock;
  let pgVectorHealthMock: jest.Mock;
  let memoryStoreHealthMock: jest.Mock;

  beforeEach(async () => {
    prismaHealthMock = jest.fn().mockResolvedValue({
      database: { status: 'up' },
    });
    redisHealthMock = jest.fn().mockResolvedValue({
      redis: { status: 'up' },
    });
    pgVectorHealthMock = jest.fn().mockResolvedValue({
      pgvector: { status: 'up' },
    });
    memoryStoreHealthMock = jest.fn().mockReturnValue({
      'memory-store': { status: 'up' },
    });

    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule, HttpModule],
      controllers: [HealthController],
      providers: [
        {
          provide: MemoryStoreHealthIndicator,
          useValue: {
            isHealthy: memoryStoreHealthMock,
          },
        },
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
          provide: PgVectorHealthIndicator,
          useValue: {
            isHealthy: pgVectorHealthMock,
          },
        },
        {
          provide: 'ENGRAM_PROFILE',
          useValue: DeploymentProfile.ENTERPRISE,
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
      expect(pgVectorHealthMock).toHaveBeenCalledWith('pgvector');
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

describe('Health Integration Tests (LITE)', () => {
  let controller: HealthController;
  let pgVectorHealthMock: jest.Mock;

  beforeEach(async () => {
    pgVectorHealthMock = jest
      .fn()
      .mockResolvedValue({ pgvector: { status: 'up' } });

    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule, HttpModule],
      controllers: [HealthController],
      providers: [
        {
          provide: MemoryStoreHealthIndicator,
          useValue: {
            isHealthy: jest
              .fn()
              .mockReturnValue({ 'memory-store': { status: 'up' } }),
          },
        },
        {
          provide: PrismaHealthIndicator,
          useValue: {
            isHealthy: jest
              .fn()
              .mockResolvedValue({ database: { status: 'up' } }),
          },
        },
        {
          provide: PgVectorHealthIndicator,
          useValue: { isHealthy: pgVectorHealthMock },
        },
        {
          provide: 'ENGRAM_PROFILE',
          useValue: DeploymentProfile.LITE,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('probes pgvector through the real Terminus pipeline', async () => {
    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(pgVectorHealthMock).toHaveBeenCalledWith('pgvector');
  });

  it('exposes engram_pgvector_ready 1 in the metrics endpoint', async () => {
    const metrics = await controller.getMetrics();

    expect(metrics).toContain('engram_pgvector_ready 1');
    expect(pgVectorHealthMock).toHaveBeenCalledWith('pgvector');
  });
});
