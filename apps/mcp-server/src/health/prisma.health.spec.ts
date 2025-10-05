import { Test, TestingModule } from '@nestjs/testing';
import { PrismaHealthIndicator } from './prisma.health';
import { PrismaService } from '@engram/database';
import { HealthCheckError } from '@nestjs/terminus';

describe('PrismaHealthIndicator', () => {
  let indicator: PrismaHealthIndicator;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaHealthIndicator,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn(),
          },
        },
      ],
    }).compile();

    indicator = module.get<PrismaHealthIndicator>(PrismaHealthIndicator);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(indicator).toBeDefined();
  });

  it('should return healthy status when database is accessible', async () => {
    jest.spyOn(prismaService, '$queryRaw').mockResolvedValue([{ 1: 1 }]);

    const result = await indicator.isHealthy('database');

    expect(result).toEqual({
      database: {
        status: 'up',
      },
    });
  });

  it('should throw HealthCheckError when database is not accessible', async () => {
    jest
      .spyOn(prismaService, '$queryRaw')
      .mockRejectedValue(new Error('Connection failed'));

    await expect(indicator.isHealthy('database')).rejects.toThrow(
      HealthCheckError,
    );
  });
});
