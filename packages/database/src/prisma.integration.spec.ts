import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaModule } from './prisma.module';
import { PrismaService } from './prisma.service';

/**
 * Integration tests for PrismaModule and PrismaService
 *
 * Note: These tests require a running PostgreSQL database.
 * Run with: pnpm docker:up to start the database.
 *
 * These tests are skipped by default in CI environments where the database
 * may not be available. To run them locally:
 * 1. Ensure PostgreSQL is running (pnpm docker:up)
 * 2. Run: pnpm db:generate
 * 3. Run: pnpm db:migrate dev
 * 4. Run: pnpm test
 */
describe('PrismaModule Integration', () => {
  let module: TestingModule;
  let prismaService: PrismaService;

  beforeEach(async () => {
    // Skip if DATABASE_URL is not set (CI environment)
    if (!process.env.DATABASE_URL) {
      return;
    }

    module = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();

    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  it('should be defined', () => {
    if (!process.env.DATABASE_URL) {
      console.log('Skipping: DATABASE_URL not set');
      return;
    }
    expect(prismaService).toBeDefined();
  });

  it('should connect to the database', async () => {
    if (!process.env.DATABASE_URL) {
      console.log('Skipping: DATABASE_URL not set');
      return;
    }

    // This should not throw
    await expect(prismaService.$connect()).resolves.not.toThrow();
  });

  it('should be able to query users table', async () => {
    if (!process.env.DATABASE_URL) {
      console.log('Skipping: DATABASE_URL not set');
      return;
    }

    // This should not throw even if table is empty
    const users = await prismaService.user.findMany();
    expect(Array.isArray(users)).toBe(true);
  });
});
