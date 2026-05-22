import { Test, TestingModule } from '@nestjs/testing';
import { QdrantHealthIndicator } from './qdrant.health';
import { QdrantService } from '@engram/vector-store';
import { HealthCheckError } from '@nestjs/terminus';

describe('QdrantHealthIndicator', () => {
  let indicator: QdrantHealthIndicator;
  let qdrantService: { healthCheck: jest.Mock<Promise<boolean>, []> };

  beforeEach(async () => {
    const qdrantServiceMock = {
      healthCheck: jest.fn<Promise<boolean>, []>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QdrantHealthIndicator,
        {
          provide: QdrantService,
          useValue: qdrantServiceMock as Partial<QdrantService>,
        },
      ],
    }).compile();

    indicator = module.get<QdrantHealthIndicator>(QdrantHealthIndicator);
    qdrantService = qdrantServiceMock;
  });

  it('should be defined', () => {
    expect(indicator).toBeDefined();
  });

  it('should return healthy status when Qdrant is accessible', async () => {
    qdrantService.healthCheck.mockResolvedValue(true);

    const result = await indicator.isHealthy('qdrant');

    expect(result).toEqual({
      qdrant: {
        status: 'up',
      },
    });
  });

  it('should throw HealthCheckError when Qdrant is not accessible', async () => {
    qdrantService.healthCheck.mockResolvedValue(false);

    await expect(indicator.isHealthy('qdrant')).rejects.toThrow(
      HealthCheckError,
    );
  });
});
