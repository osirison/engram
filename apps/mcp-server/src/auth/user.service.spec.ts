import { UserService } from './user.service';
import type { PrismaService } from '@engram/database';

interface PrismaStub {
  user: { upsert: jest.Mock };
  membership: { findMany: jest.Mock };
}

function makePrisma(over?: {
  user?: { id: string; email: string };
  memberships?: Array<{ organizationId: string }>;
}): { prisma: PrismaService; stub: PrismaStub } {
  const stub: PrismaStub = {
    user: {
      upsert: jest
        .fn()
        .mockResolvedValue(over?.user ?? { id: 'u1', email: 'a@b.test' }),
    },
    membership: {
      findMany: jest.fn().mockResolvedValue(over?.memberships ?? []),
    },
  };
  return { prisma: stub as unknown as PrismaService, stub };
}

describe('UserService', () => {
  it('upserts by email and selects the single org as the default tenant', async () => {
    const { prisma, stub } = makePrisma({
      user: { id: 'u1', email: 'a@b.test' },
      memberships: [{ organizationId: 'org-1' }],
    });
    const service = new UserService(prisma);

    const result = await service.upsertByEmail('a@b.test');

    expect(result).toEqual({
      id: 'u1',
      email: 'a@b.test',
      organizationId: 'org-1',
    });
    expect(stub.user.upsert).toHaveBeenCalledWith({
      where: { email: 'a@b.test' },
      create: { email: 'a@b.test' },
      update: {},
      select: { id: true, email: true },
    });
  });

  it('leaves the org unset when the user has no memberships', async () => {
    const { prisma } = makePrisma({ memberships: [] });
    const service = new UserService(prisma);

    expect((await service.upsertByEmail('a@b.test')).organizationId).toBeNull();
  });

  it('leaves the org unset when the user has multiple memberships', async () => {
    const { prisma } = makePrisma({
      memberships: [{ organizationId: 'org-1' }, { organizationId: 'org-2' }],
    });
    const service = new UserService(prisma);

    expect((await service.upsertByEmail('a@b.test')).organizationId).toBeNull();
  });
});
