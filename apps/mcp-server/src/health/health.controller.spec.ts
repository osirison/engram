import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthCheckService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { QdrantHealthIndicator } from './qdrant.health';
import { EmbeddingsService } from '@engram/embeddings';

describe('HealthController', () => {
  let controller: HealthController;

  const healthServiceMock = {
    check: jest.fn(),
  };
  const prismaHealthMock = {
    isHealthy: jest.fn(),
  };
  const redisHealthMock = {
    isHealthy: jest.fn(),
  };
  const qdrantHealthMock = {
    isHealthy: jest.fn(),
  };
  const embeddingsServiceMock = {
    getPrometheusMetrics: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: healthServiceMock,
        },
        {
          provide: PrismaHealthIndicator,
          useValue: prismaHealthMock,
        },
        {
          provide: RedisHealthIndicator,
          useValue: redisHealthMock,
        },
        {
          provide: QdrantHealthIndicator,
          useValue: qdrantHealthMock,
        },
        {
          provide: EmbeddingsService,
          useValue: embeddingsServiceMock,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns embeddings metrics in prometheus format', () => {
    embeddingsServiceMock.getPrometheusMetrics.mockReturnValue(
      'engram_embeddings_requests_total 5\n',
    );

    const metrics = controller.getMetrics();

    expect(metrics).toContain('engram_embeddings_requests_total 5');
    expect(embeddingsServiceMock.getPrometheusMetrics).toHaveBeenCalledTimes(1);
  });

  it('returns empty metrics when embeddings service is unavailable', () => {
    const noEmbeddingsController = new HealthController(
      healthServiceMock as unknown as HealthCheckService,
      prismaHealthMock as unknown as PrismaHealthIndicator,
      redisHealthMock as unknown as RedisHealthIndicator,
      qdrantHealthMock as unknown as QdrantHealthIndicator,
      undefined,
    );

    expect(noEmbeddingsController.getMetrics()).toBe('');
  });
});
