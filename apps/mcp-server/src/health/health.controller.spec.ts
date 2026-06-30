import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthCheckService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { QdrantHealthIndicator } from './qdrant.health';
import { PgVectorHealthIndicator } from './pgvector.health';
import { EmbeddingsService } from '@engram/embeddings';
import { DeploymentProfile } from '@engram/config';
import { MemoryStoreHealthIndicator } from './memory-store.health';

describe('HealthController', () => {
  let controller: HealthController;

  const healthServiceMock = {
    check: jest.fn(),
  };
  const memoryStoreHealthMock = {
    isHealthy: jest.fn(),
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
          provide: MemoryStoreHealthIndicator,
          useValue: memoryStoreHealthMock,
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

  it('returns embeddings metrics in prometheus format', async () => {
    embeddingsServiceMock.getPrometheusMetrics.mockReturnValue(
      'engram_embeddings_requests_total 5\n',
    );

    const metrics = await controller.getMetrics();

    expect(metrics).toContain('engram_vector_backend_info');
    expect(metrics).toContain('engram_pgvector_ready');
    expect(metrics).toContain('engram_embeddings_requests_total 5');
    expect(embeddingsServiceMock.getPrometheusMetrics).toHaveBeenCalledTimes(1);
  });

  it('returns base metrics when embeddings service is unavailable', async () => {
    const noEmbeddingsController = new HealthController(
      healthServiceMock as unknown as HealthCheckService,
      memoryStoreHealthMock as unknown as MemoryStoreHealthIndicator,
      prismaHealthMock as unknown as PrismaHealthIndicator,
      redisHealthMock as unknown as RedisHealthIndicator,
      qdrantHealthMock as unknown as QdrantHealthIndicator,
      pgVectorHealthMock as unknown as PgVectorHealthIndicator,
      undefined,
    );

    const metrics = await noEmbeddingsController.getMetrics();
    expect(metrics).toContain('engram_vector_backend_info');
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

  it('readiness uses the same health indicators as the liveness endpoint', async () => {
    healthServiceMock.check.mockResolvedValue({ status: 'ok' });

    await controller.check();
    await controller.readiness();

    expect(healthServiceMock.check).toHaveBeenCalledTimes(2);
  });
});

describe('HealthController profile-aware vector wiring', () => {
  const ORIGINAL_BACKEND = process.env.VECTOR_BACKEND;

  afterEach(() => {
    if (ORIGINAL_BACKEND === undefined) {
      delete process.env.VECTOR_BACKEND;
    } else {
      process.env.VECTOR_BACKEND = ORIGINAL_BACKEND;
    }
  });

  // Build a controller for an explicit profile (injected via ENGRAM_PROFILE)
  // whose check() actually invokes every composed indicator, so tests can
  // assert which backends were probed.
  function makeController(profile: DeploymentProfile): {
    controller: HealthController;
    probes: {
      memory: jest.Mock;
      prisma: jest.Mock;
      redis: jest.Mock;
      qdrant: jest.Mock;
      pgvector: jest.Mock;
    };
  } {
    const probes = {
      memory: jest.fn().mockReturnValue({ 'memory-store': { status: 'up' } }),
      prisma: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
      redis: jest.fn().mockResolvedValue({ redis: { status: 'up' } }),
      qdrant: jest.fn().mockResolvedValue({ qdrant: { status: 'up' } }),
      pgvector: jest.fn().mockResolvedValue({ pgvector: { status: 'up' } }),
    };
    const check = jest.fn(async (indicators: Array<() => Promise<unknown>>) => {
      await Promise.all(indicators.map((indicator) => indicator()));
      return { status: 'ok' };
    });
    const controller = new HealthController(
      { check } as unknown as HealthCheckService,
      { isHealthy: probes.memory } as unknown as MemoryStoreHealthIndicator,
      { isHealthy: probes.prisma } as unknown as PrismaHealthIndicator,
      { isHealthy: probes.redis } as unknown as RedisHealthIndicator,
      { isHealthy: probes.qdrant } as unknown as QdrantHealthIndicator,
      { isHealthy: probes.pgvector } as unknown as PgVectorHealthIndicator,
      undefined,
      undefined,
      profile,
    );
    return { controller, probes };
  }

  it('LITE + pgvector probes pgvector and the DB, never Qdrant or Redis', async () => {
    process.env.VECTOR_BACKEND = 'pgvector';
    const { controller, probes } = makeController(DeploymentProfile.LITE);

    await controller.check();

    expect(probes.prisma).toHaveBeenCalledWith('database');
    expect(probes.pgvector).toHaveBeenCalledWith('pgvector');
    expect(probes.qdrant).not.toHaveBeenCalled();
    expect(probes.redis).not.toHaveBeenCalled();
  });

  it('LITE + pgvector reports engram_pgvector_ready 1 when reachable', async () => {
    process.env.VECTOR_BACKEND = 'pgvector';
    const { controller, probes } = makeController(DeploymentProfile.LITE);

    const metrics = await controller.getMetrics();

    expect(probes.pgvector).toHaveBeenCalledWith('pgvector');
    expect(metrics).toContain('engram_pgvector_ready 1');
    expect(metrics).toContain('engram_vector_backend_info{backend="pgvector"}');
    expect(metrics).toContain('engram_deployment_profile_info{profile="lite"}');
  });

  it('LITE + pgvector reports engram_pgvector_ready 0 when the probe fails', async () => {
    process.env.VECTOR_BACKEND = 'pgvector';
    const { controller, probes } = makeController(DeploymentProfile.LITE);
    probes.pgvector.mockRejectedValueOnce(new Error('extension missing'));

    const metrics = await controller.getMetrics();

    expect(metrics).toContain('engram_pgvector_ready 0');
  });

  it('ENTERPRISE + qdrant probes Qdrant only and keeps the gauge at 0', async () => {
    process.env.VECTOR_BACKEND = 'qdrant';
    const { controller, probes } = makeController(DeploymentProfile.ENTERPRISE);

    await controller.check();
    const metrics = await controller.getMetrics();

    expect(probes.qdrant).toHaveBeenCalledWith('qdrant');
    expect(probes.pgvector).not.toHaveBeenCalled();
    expect(metrics).toContain('engram_pgvector_ready 0');
  });

  it('ENTERPRISE + pgvector probes both Qdrant and pgvector (no regression)', async () => {
    process.env.VECTOR_BACKEND = 'pgvector';
    const { controller, probes } = makeController(DeploymentProfile.ENTERPRISE);

    await controller.check();

    expect(probes.qdrant).toHaveBeenCalledWith('qdrant');
    expect(probes.pgvector).toHaveBeenCalledWith('pgvector');
  });

  it('MEMORY probes no external vector store', async () => {
    process.env.VECTOR_BACKEND = 'pgvector';
    const { controller, probes } = makeController(DeploymentProfile.MEMORY);

    await controller.check();
    const metrics = await controller.getMetrics();

    expect(probes.prisma).not.toHaveBeenCalled();
    expect(probes.qdrant).not.toHaveBeenCalled();
    expect(probes.pgvector).not.toHaveBeenCalled();
    expect(metrics).toContain('engram_pgvector_ready 0');
  });
});
