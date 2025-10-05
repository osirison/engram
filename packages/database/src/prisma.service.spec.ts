import { describe, it, expect, vi } from 'vitest';
import { PrismaService } from './prisma.service';

// Mock the PrismaClient
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    $connect = vi.fn().mockResolvedValue(undefined);
    $disconnect = vi.fn().mockResolvedValue(undefined);
  },
}));

describe('PrismaService', () => {
  it('should be defined', () => {
    const service = new PrismaService();
    expect(service).toBeDefined();
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
