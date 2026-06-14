import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryLtmService } from './memory-ltm.service';
import { MemoryType } from '@engram/database';

const ORG_A = 'cm0aaaaaaaaaaaaaaaaaaaaaaaa';
const ORG_B = 'cm0bbbbbbbbbbbbbbbbbbbbbbbbb';
const USER_A = 'cldx4k8xp000108l83h4y8v2q';
const USER_B = 'cldx4k8xp000208l84b5c9w3r';

type MockMemory = {
  id: string;
  userId: string;
  organizationId: string | null;
  content: string;
  metadata: null;
  tags: string[];
  type: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: null;
  embedding: number[];
};

const makeMemory = (overrides: Partial<MockMemory>): MockMemory => ({
  id: 'mem-1',
  userId: USER_A,
  organizationId: ORG_A,
  content: 'test content',
  metadata: null,
  tags: [],
  type: MemoryType.LONG_TERM,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: null,
  embedding: [],
  ...overrides,
});

describe('MemoryLtmService — tenant isolation', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let service: MemoryLtmService;

  const memOrgA = makeMemory({ id: 'mem-a1', userId: USER_A, organizationId: ORG_A });
  const memOrgB = makeMemory({ id: 'mem-b1', userId: USER_B, organizationId: ORG_B });

  beforeEach(() => {
    const db = [memOrgA, memOrgB];

    prisma = {
      memory: {
        count: vi
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              db.filter(
                (m) =>
                  (!where.userId || m.userId === where.userId) &&
                  (!where.organizationId || m.organizationId === where.organizationId) &&
                  m.type === where.type
              ).length
            )
          ),
        create: vi
          .fn()
          .mockImplementation(({ data }: { data: Partial<MockMemory> }) =>
            Promise.resolve({ ...makeMemory({}), ...data, id: 'mem-new' })
          ),
        findFirst: vi
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              db.find(
                (m) =>
                  m.id === where.id &&
                  m.userId === where.userId &&
                  (!where.organizationId || m.organizationId === where.organizationId) &&
                  m.type === where.type
              ) ?? null
            )
          ),
        findMany: vi
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              db.filter(
                (m) =>
                  (!where.userId || m.userId === where.userId) &&
                  (!where.organizationId || m.organizationId === where.organizationId) &&
                  m.type === where.type
              )
            )
          ),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn(),
      },
      $transaction: vi.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new MemoryLtmService(prisma as any);
  });

  describe('list — org scope filter', () => {
    it('returns only org A memories when organizationId=ORG_A', async () => {
      const result = await service.list(USER_A, { organizationId: ORG_A });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.organizationId).toBe(ORG_A);
    });

    it('returns zero results for org A user querying org B', async () => {
      const result = await service.list(USER_A, { organizationId: ORG_B });
      expect(result.items).toHaveLength(0);
    });

    it('returns only org B memories when organizationId=ORG_B', async () => {
      const result = await service.list(USER_B, { organizationId: ORG_B });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.organizationId).toBe(ORG_B);
    });
  });

  describe('count — org scope filter', () => {
    it('counts only memories belonging to the specified org', async () => {
      const countA = await service.count(USER_A, { organizationId: ORG_A });
      const countB = await service.count(USER_B, { organizationId: ORG_B });
      expect(countA).toBe(1);
      expect(countB).toBe(1);
    });

    it("returns 0 when user tries to count another org's memories", async () => {
      const count = await service.count(USER_A, { organizationId: ORG_B });
      expect(count).toBe(0);
    });
  });

  describe('create — organizationId persisted', () => {
    it('stores the organizationId on the created memory', async () => {
      await service.create({ userId: USER_A, organizationId: ORG_A, content: 'new memory' });

      expect(prisma.memory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ organizationId: ORG_A }),
      });
    });

    it('stores null organizationId when no org is provided', async () => {
      await service.create({ userId: USER_A, content: 'unscoped memory' });

      expect(prisma.memory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ organizationId: null }),
      });
    });
  });

  describe('organizationId filter wired into where clause', () => {
    it('passes organizationId to prisma.memory.findMany when provided', async () => {
      await service.list(USER_A, { organizationId: ORG_A });

      expect(prisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_A }),
        })
      );
    });

    it('passes organizationId to prisma.memory.count when provided', async () => {
      await service.count(USER_A, { organizationId: ORG_A });

      expect(prisma.memory.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_A }),
        })
      );
    });

    it('omits organizationId from where clause when not provided', async () => {
      await service.list(USER_A);

      const call = prisma.memory.findMany.mock.calls[0]![0];
      expect(call.where).not.toHaveProperty('organizationId');
    });
  });

  describe('get — org scope filter', () => {
    it('returns memory when organizationId matches', async () => {
      const result = await service.get(USER_A, 'mem-a1', ORG_A);
      expect(result).not.toBeNull();
      expect(result!.organizationId).toBe(ORG_A);
    });

    it('returns null when organizationId does not match', async () => {
      const result = await service.get(USER_A, 'mem-a1', ORG_B);
      expect(result).toBeNull();
    });

    it('passes organizationId to prisma.memory.findFirst when provided', async () => {
      await service.get(USER_A, 'mem-a1', ORG_A);

      expect(prisma.memory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_A }),
        })
      );
    });

    it('omits organizationId from findFirst when not provided', async () => {
      await service.get(USER_A, 'mem-a1');

      const call = prisma.memory.findFirst.mock.calls[0]![0];
      expect(call.where).not.toHaveProperty('organizationId');
    });
  });

  describe('delete — org scope filter', () => {
    it('passes organizationId to prisma.memory.deleteMany when provided', async () => {
      prisma.memory.deleteMany.mockResolvedValueOnce({ count: 1 });
      await service.delete(USER_A, 'mem-a1', ORG_A);

      expect(prisma.memory.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_A }),
        })
      );
    });

    it('omits organizationId from deleteMany when not provided', async () => {
      prisma.memory.deleteMany.mockResolvedValueOnce({ count: 1 });
      await service.delete(USER_A, 'mem-a1');

      const call = prisma.memory.deleteMany.mock.calls[0]![0];
      expect(call.where).not.toHaveProperty('organizationId');
    });

    it('cannot delete org A memory by specifying org B', async () => {
      // findFirst with ORG_B will return null → update call will not be reached
      const deleted = await service.delete(USER_A, 'mem-a1', ORG_B);
      expect(deleted).toBe(false);
    });
  });
});
