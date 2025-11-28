import { Test, TestingModule } from '@nestjs/testing';
import { PrismaHealthIndicator } from './prisma.health';
import { PrismaService } from '@engram/database';
import { HealthCheckError } from '@nestjs/terminus';

type PrismaServiceMock = PrismaService & { memory: { count: jest.Mock } };

describe('PrismaHealthIndicator', () => {
  let indicator: PrismaHealthIndicator;
  let prismaService: PrismaServiceMock;

  beforeEach(async () => {
    const mockPrismaService = {
      $connect: jest.fn(),
      $disconnect: jest.fn(),
      memory: {
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaHealthIndicator,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    indicator = module.get<PrismaHealthIndicator>(PrismaHealthIndicator);
    prismaService = module.get<PrismaService>(
      PrismaService,
    ) as PrismaServiceMock;
  });

  it('should be defined', () => {
    expect(indicator).toBeDefined();
  });

  it('should return healthy status when database is accessible', async () => {
    prismaService.memory.count.mockResolvedValue(1);

    const result = await indicator.isHealthy('database');

    expect(result).toEqual({
      database: {
        status: 'up',
      },
    });
  });

  it('should throw HealthCheckError when database is not accessible', async () => {
    prismaService.memory.count.mockRejectedValue(
      new Error('Connection failed'),
    );

    await expect(indicator.isHealthy('database')).rejects.toThrow(
      HealthCheckError,
    );
  });
});
