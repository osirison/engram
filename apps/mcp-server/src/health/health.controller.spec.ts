import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthCheckService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health';
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
      pgVectorHealthMock as unknown as PgVectorHealthIndicator,
      undefined,
    );

    const metrics = await noEmbeddingsController.getMetrics();
    expect(metrics).toContain('engram_vector_backend_info');
  });

  it('readiness uses the same health indicators as the liveness endpoint', async () => {
    healthServiceMock.check.mockResolvedValue({ status: 'ok' });

    await controller.check();
    await controller.readiness();

    expect(healthServiceMock.check).toHaveBeenCalledTimes(2);
  });
});

describe('HealthController profile-aware wiring', () => {
  // Build a controller for an explicit profile (injected via ENGRAM_PROFILE)
  // whose check() actually invokes every composed indicator, so tests can
  // assert which stores were probed.
  function makeController(profile: DeploymentProfile): {
    controller: HealthController;
    probes: {
      memory: jest.Mock;
      prisma: jest.Mock;
      pgvector: jest.Mock;
    };
  } {
    const probes = {
      memory: jest.fn().mockReturnValue({ 'memory-store': { status: 'up' } }),
      prisma: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
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
      { isHealthy: probes.pgvector } as unknown as PgVectorHealthIndicator,
      undefined,
      undefined,
      profile,
    );
    return { controller, probes };
  }

  it.each([DeploymentProfile.LITE, DeploymentProfile.STANDARD])(
    'profile %s probes the DB and pgvector',
    async (profile) => {
      const { controller, probes } = makeController(profile);

      await controller.check();

      expect(probes.prisma).toHaveBeenCalledWith('database');
      expect(probes.pgvector).toHaveBeenCalledWith('pgvector');
    },
  );

  it('reports engram_pgvector_ready 1 when reachable', async () => {
    const { controller, probes } = makeController(DeploymentProfile.LITE);

    const metrics = await controller.getMetrics();

    expect(probes.pgvector).toHaveBeenCalledWith('pgvector');
    expect(metrics).toContain('engram_pgvector_ready 1');
    expect(metrics).toContain('engram_vector_backend_info{backend="pgvector"}');
    expect(metrics).toContain('engram_deployment_profile_info{profile="lite"}');
  });

  it('reports engram_pgvector_ready 0 when the probe fails', async () => {
    const { controller, probes } = makeController(DeploymentProfile.STANDARD);
    probes.pgvector.mockRejectedValueOnce(new Error('extension missing'));

    const metrics = await controller.getMetrics();

    expect(metrics).toContain('engram_pgvector_ready 0');
  });
});
