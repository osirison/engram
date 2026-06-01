import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrismaService } from './prisma.service';

const prismaClientConstructor = vi.hoisted(() => vi.fn());
const prismaPgConstructor = vi.hoisted(() => vi.fn());

const originalDatabaseUrl = process.env['DATABASE_URL'];
const testDatabaseUrl = 'postgresql://engram:dev_password@localhost:5432/engram_test';

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(options?: unknown) {
      prismaPgConstructor(options);
    }
  },
}));

// Mock the PrismaClient
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor(options?: unknown) {
      prismaClientConstructor(options);
    }

    $connect = vi.fn().mockResolvedValue(undefined);
    $disconnect = vi.fn().mockResolvedValue(undefined);
  },
}));

describe('PrismaService', () => {
  beforeEach(() => {
    prismaClientConstructor.mockClear();
    prismaPgConstructor.mockClear();
    process.env['DATABASE_URL'] = testDatabaseUrl;
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env['DATABASE_URL'];
    } else {
      process.env['DATABASE_URL'] = originalDatabaseUrl;
    }
  });

  it('should be defined', () => {
    const service = new PrismaService();
    expect(service).toBeDefined();
  });

  it('should pass the database url to PrismaClient', () => {
    new PrismaService();

    expect(prismaPgConstructor).toHaveBeenCalledWith({
      connectionString: testDatabaseUrl,
    });
    expect(prismaClientConstructor).toHaveBeenCalledWith({
      adapter: expect.any(Object),
    });
  });

  it('should have onModuleInit method', () => {
    const service = new PrismaService();
    expect(service.onModuleInit).toBeDefined();
    expect(typeof service.onModuleInit).toBe('function');
  });

  it('should have onModuleDestroy method', () => {
    const service = new PrismaService();
    expect(service.onModuleDestroy).toBeDefined();
    expect(typeof service.onModuleDestroy).toBe('function');
  });

  it('should call $connect on module init', async () => {
    const service = new PrismaService();
    await service.onModuleInit();
    expect(service.$connect).toHaveBeenCalledTimes(1);
  });

  it('should call $disconnect on module destroy', async () => {
    const service = new PrismaService();
    await service.onModuleDestroy();
    expect(service.$disconnect).toHaveBeenCalledTimes(1);
  });
});
