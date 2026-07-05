import { MemoryAuditService } from './memory-audit.service';

describe('MemoryAuditService (WP2 T5)', () => {
  const makePrisma = () => ({
    memoryAudit: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  });

  const build = (prisma: ReturnType<typeof makePrisma>) =>
    new MemoryAuditService(prisma as any);

  it('maps a delegated api-key mutation to actorType=api-key + delegation facts', async () => {
    const prisma = makePrisma();
    await build(prisma).record({
      memoryId: 'mem-1',
      userId: 'qp',
      organizationId: null,
      scope: 'agent:a',
      action: 'update',
      context: {
        actorUserId: 'qp',
        apiKeyId: 'key_123',
        scopes: ['admin'],
        delegated: true,
      },
      actorLabel: 'op@example.com',
      before: { content: 'old', version: 3 },
      after: { content: 'new', version: 4 },
    });

    expect(prisma.memoryAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memoryId: 'mem-1',
        userId: 'qp',
        scope: 'agent:a',
        action: 'update',
        actorType: 'api-key',
        actorId: 'key_123',
        actorLabel: 'op@example.com',
        delegated: true,
        before: { content: 'old', version: 3 },
        after: { content: 'new', version: 4 },
      }),
    });
  });

  it('records a direct (unauthenticated) agent call as actorType=anonymous with a null label', async () => {
    const prisma = makePrisma();
    await build(prisma).record({
      memoryId: 'mem-2',
      userId: 'qp',
      action: 'delete',
      // No context (no verified api key), no actorLabel.
      before: { content: 'gone' },
      after: { deleted: true },
    });

    expect(prisma.memoryAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: 'anonymous',
        actorId: null,
        actorLabel: null,
        delegated: false,
      }),
    });
  });

  it('never throws when the audit write fails — the mutation must not break', async () => {
    const prisma = makePrisma();
    prisma.memoryAudit.create.mockRejectedValue(new Error('db down'));

    await expect(
      build(prisma).record({
        memoryId: 'mem-3',
        userId: 'qp',
        action: 'delete',
        after: { deleted: true },
      }),
    ).resolves.toBeUndefined();
  });

  it('returns the newest delete snapshot for restore', async () => {
    const prisma = makePrisma();
    prisma.memoryAudit.findFirst.mockResolvedValue({
      before: { content: 'recover me', tags: ['x'], type: 'long-term' },
      scope: 'agent:a',
      organizationId: null,
    });

    const result = await build(prisma).findLatestDeleteSnapshot('qp', 'mem-4');

    expect(result).toEqual({
      before: { content: 'recover me', tags: ['x'], type: 'long-term' },
      scope: 'agent:a',
      organizationId: null,
    });
    expect(prisma.memoryAudit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'qp', memoryId: 'mem-4', action: 'delete' },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('returns null when there is no recoverable delete snapshot', async () => {
    const prisma = makePrisma();
    prisma.memoryAudit.findFirst.mockResolvedValue(null);
    expect(
      await build(prisma).findLatestDeleteSnapshot('qp', 'nope'),
    ).toBeNull();
  });
});
