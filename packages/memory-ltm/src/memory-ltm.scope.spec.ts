import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryLtmService } from './memory-ltm.service';
import { MemoryType } from '@engram/database';

const SCOPE_A = 'agent:agent-alpha';
const SCOPE_B = 'session:session-beta';
const USER_A = 'cldx4k8xp000108l83h4y8v2q';

type MockMemory = {
  id: string;
  userId: string;
  organizationId: string | null;
  scope: string | null;
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
  organizationId: null,
  scope: null,
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

describe('MemoryLtmService — scope isolation', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let service: MemoryLtmService;

  const memScopeA = makeMemory({ id: 'mem-a1', scope: SCOPE_A, content: 'agent A fact' });
  const memScopeB = makeMemory({ id: 'mem-b1', scope: SCOPE_B, content: 'session B fact' });
  const memUnscoped = makeMemory({ id: 'mem-u1', scope: null, content: 'global fact' });

  beforeEach(() => {
    const db = [memScopeA, memScopeB, memUnscoped];

    prisma = {
      memory: {
        count: vi
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              db.filter(
                (m) =>
                  (!where.userId || m.userId === where.userId) &&
                  (!where.scope || m.scope === where.scope) &&
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
                  (!where.id || m.id === where.id) &&
                  (!where.userId || m.userId === where.userId) &&
                  (!where.scope || m.scope === where.scope) &&
                  m.type === where.type &&
                  (!where.content || m.content === where.content)
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
                  (!where.scope || m.scope === where.scope) &&
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

  describe('create — scope persisted', () => {
    it('stores the scope on the created memory', async () => {
      await service.create({ userId: USER_A, scope: SCOPE_A, content: 'new scoped memory' });

      expect(prisma.memory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ scope: SCOPE_A }),
      });
    });

    it('stores null scope when no scope is provided', async () => {
      await service.create({ userId: USER_A, content: 'unscoped memory' });

      expect(prisma.memory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ scope: null }),
      });
    });
  });

  describe('list — scope filter', () => {
    it('returns only scope A memories when scope=SCOPE_A', async () => {
      const result = await service.list(USER_A, { scope: SCOPE_A });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.scope).toBe(SCOPE_A);
    });

    it('returns only scope B memories when scope=SCOPE_B', async () => {
      const result = await service.list(USER_A, { scope: SCOPE_B });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.scope).toBe(SCOPE_B);
    });

    it('returns all memories when no scope is provided', async () => {
      const result = await service.list(USER_A);
      expect(result.items).toHaveLength(3);
    });

    it('passes scope to prisma.memory.findMany when provided', async () => {
      await service.list(USER_A, { scope: SCOPE_A });

      expect(prisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ scope: SCOPE_A }),
        })
      );
    });

    it('omits scope from findMany when not provided', async () => {
      await service.list(USER_A);

      const call = prisma.memory.findMany.mock.calls[0]![0];
      expect(call.where).not.toHaveProperty('scope');
    });
  });

  describe('count — scope filter', () => {
    it('counts only memories in scope A', async () => {
      const count = await service.count(USER_A, { scope: SCOPE_A });
      expect(count).toBe(1);
    });

    it('counts only memories in scope B', async () => {
      const count = await service.count(USER_A, { scope: SCOPE_B });
      expect(count).toBe(1);
    });

    it('passes scope to prisma.memory.count when provided', async () => {
      await service.count(USER_A, { scope: SCOPE_A });

      expect(prisma.memory.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ scope: SCOPE_A }),
        })
      );
    });
  });

  describe('get — scope filter', () => {
    it('returns memory when scope matches', async () => {
      const result = await service.get(USER_A, 'mem-a1', undefined, SCOPE_A);
      expect(result).not.toBeNull();
      expect(result!.scope).toBe(SCOPE_A);
    });

    it('returns null when scope does not match', async () => {
      const result = await service.get(USER_A, 'mem-a1', undefined, SCOPE_B);
      expect(result).toBeNull();
    });

    it('passes scope to prisma.memory.findFirst when provided', async () => {
      await service.get(USER_A, 'mem-a1', undefined, SCOPE_A);

      expect(prisma.memory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ scope: SCOPE_A }),
        })
      );
    });

    it('omits scope from findFirst when not provided', async () => {
      await service.get(USER_A, 'mem-a1');

      const call = prisma.memory.findFirst.mock.calls[0]![0];
      expect(call.where).not.toHaveProperty('scope');
    });
  });

  describe('scope returned on mapped memory', () => {
    it('scope field is present on retrieved memory', async () => {
      const result = await service.get(USER_A, 'mem-a1', undefined, SCOPE_A);
      expect(result?.scope).toBe(SCOPE_A);
    });

    it('scope is undefined (not null) when memory has no scope', async () => {
      const result = await service.get(USER_A, 'mem-u1');
      expect(result?.scope).toBeUndefined();
    });
  });
});
