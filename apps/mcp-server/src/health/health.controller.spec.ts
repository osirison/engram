import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthCheckService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { QdrantHealthIndicator } from './qdrant.health';
import { PgVectorHealthIndicator } from './pgvector.health';
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
  const pgVectorHealthMock = {
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
          provide: PgVectorHealthIndicator,
          useValue: pgVectorHealthMock,
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
      pgVectorHealthMock as unknown as PgVectorHealthIndicator,
      undefined,
    );

    expect(noEmbeddingsController.getMetrics()).toBe('');
  });

  it('includes the pgvector check only when VECTOR_BACKEND is pgvector', async () => {
    healthServiceMock.check.mockImplementation(
      async (indicators: Array<() => Promise<unknown>>) => {
        await Promise.all(indicators.map((indicator) => indicator()));
        return { status: 'ok' };
      },
    );
    prismaHealthMock.isHealthy.mockResolvedValue({
      database: { status: 'up' },
    });
    redisHealthMock.isHealthy.mockResolvedValue({ redis: { status: 'up' } });
    qdrantHealthMock.isHealthy.mockResolvedValue({ qdrant: { status: 'up' } });
    pgVectorHealthMock.isHealthy.mockResolvedValue({
      pgvector: { status: 'up' },
    });

    const previous = process.env.VECTOR_BACKEND;

    process.env.VECTOR_BACKEND = 'qdrant';
    await controller.check();
    expect(pgVectorHealthMock.isHealthy).not.toHaveBeenCalled();

    process.env.VECTOR_BACKEND = 'pgvector';
    await controller.check();
    expect(pgVectorHealthMock.isHealthy).toHaveBeenCalledWith('pgvector');

    if (previous === undefined) {
      delete process.env.VECTOR_BACKEND;
    } else {
      process.env.VECTOR_BACKEND = previous;
    }
  });
});
