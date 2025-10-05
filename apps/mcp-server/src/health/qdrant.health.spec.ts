import { Test, TestingModule } from '@nestjs/testing';
import { QdrantHealthIndicator } from './qdrant.health';
import { QdrantService } from '@engram/vector-store';
import { HealthCheckError } from '@nestjs/terminus';

describe('QdrantHealthIndicator', () => {
  let indicator: QdrantHealthIndicator;
  let qdrantService: QdrantService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QdrantHealthIndicator,
        {
          provide: QdrantService,
          useValue: {
            healthCheck: jest.fn(),
          } as Partial<QdrantService>,
        },
      ],
    }).compile();

    indicator = module.get<QdrantHealthIndicator>(QdrantHealthIndicator);
    qdrantService = module.get<QdrantService>(QdrantService);
  });

  it('should be defined', () => {
    expect(indicator).toBeDefined();
  });

  it('should return healthy status when Qdrant is accessible', async () => {
    jest.spyOn(qdrantService, 'healthCheck').mockResolvedValue(true);

    const result = await indicator.isHealthy('qdrant');

    expect(result).toEqual({
      qdrant: {
        status: 'up',
      },
    });
  });

  it('should throw HealthCheckError when Qdrant is not accessible', async () => {
    jest.spyOn(qdrantService, 'healthCheck').mockResolvedValue(false);

    await expect(indicator.isHealthy('qdrant')).rejects.toThrow(
      HealthCheckError,
    );
  });
});
