import { PostgresSessionStore } from './postgres-session.store';

type PrismaMock = {
  authKvEntry: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
    deleteMany: jest.Mock;
  };
  $queryRaw: jest.Mock;
};

function makePrisma(): PrismaMock {
  return {
    authKvEntry: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
}

describe('PostgresSessionStore', () => {
  let prisma: PrismaMock;
  let store: PostgresSessionStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PostgresSessionStore(prisma as never);
  });

  it('set upserts the row with the TTL-derived expiry', async () => {
    const before = Date.now();
    await store.set('session:abc', 'payload', 3600);

    expect(prisma.authKvEntry.upsert).toHaveBeenCalledTimes(1);
    const call = prisma.authKvEntry.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ key: 'session:abc' });
    expect(call.create.value).toBe('payload');
    const expiry = (call.create.expiresAt as Date).getTime();
    expect(expiry).toBeGreaterThanOrEqual(before + 3600_000 - 1000);
    expect(expiry).toBeLessThanOrEqual(before + 3600_000 + 1000);
  });

  it('get returns a live value', async () => {
    prisma.authKvEntry.findUnique.mockResolvedValue({
      value: 'payload',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(store.get('session:abc')).resolves.toBe('payload');
  });

  it('get returns null for a missing key', async () => {
    await expect(store.get('session:missing')).resolves.toBeNull();
  });

  it('get returns null for an expired-but-unswept row', async () => {
    prisma.authKvEntry.findUnique.mockResolvedValue({
      value: 'stale',
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(store.get('session:stale')).resolves.toBeNull();
  });

  it('getDelete atomically deletes and returns the prior value', async () => {
    prisma.$queryRaw.mockResolvedValue([{ value: 'one-time-state' }]);

    await expect(store.getDelete('oauth:state:xyz')).resolves.toBe(
      'one-time-state',
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('getDelete returns null when the key is absent or expired', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(store.getDelete('oauth:state:gone')).resolves.toBeNull();
  });

  it('sweepExpired deletes only expired rows', async () => {
    prisma.authKvEntry.deleteMany.mockResolvedValue({ count: 4 });

    await expect(store.sweepExpired()).resolves.toBe(4);
    const call = prisma.authKvEntry.deleteMany.mock.calls[0][0];
    expect(call.where.expiresAt.lte).toBeInstanceOf(Date);
  });
});
