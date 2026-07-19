import { PostgresRateLimitStore } from './postgres-rate-limit.store';

type PrismaMock = {
  $queryRaw: jest.Mock;
  rateLimitCounter: { deleteMany: jest.Mock };
};

function makePrisma(): PrismaMock {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ count: 1, ttlSeconds: 60 }]),
    rateLimitCounter: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

/** The raw tagged-template call: [strings, ...params]. */
function rawParams(mock: jest.Mock): unknown[] {
  return mock.mock.calls[0].slice(1);
}

describe('PostgresRateLimitStore', () => {
  let prisma: PrismaMock;
  let store: PostgresRateLimitStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PostgresRateLimitStore(prisma as never);
  });

  it('performs a single atomic upsert and returns count + ttl', async () => {
    prisma.$queryRaw.mockResolvedValue([{ count: 3, ttlSeconds: 42 }]);

    const result = await store.increment('rl:user:qp', 60);

    expect(result).toEqual({ count: 3, ttlSeconds: 42 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(rawParams(prisma.$queryRaw)).toEqual(['rl:user:qp', 1, 60]);
  });

  it('passes multi-unit increments through as one atomic step', async () => {
    await store.increment('rl:user:qp', 60, 5);

    expect(rawParams(prisma.$queryRaw)).toEqual(['rl:user:qp', 5, 60]);
  });

  it('sanitizes non-positive units to a single unit', async () => {
    await store.increment('rl:user:qp', 60, 0);
    expect(rawParams(prisma.$queryRaw)[1]).toBe(1);

    prisma.$queryRaw.mockClear();
    prisma.$queryRaw.mockResolvedValue([{ count: 1, ttlSeconds: 60 }]);
    await store.increment('rl:user:qp', 60, Number.NaN);
    expect(rawParams(prisma.$queryRaw)[1]).toBe(1);
  });

  it('coerces driver decimals to numbers', async () => {
    prisma.$queryRaw.mockResolvedValue([{ count: '7', ttlSeconds: '13' }]);

    await expect(store.increment('rl:user:qp', 60)).resolves.toEqual({
      count: 7,
      ttlSeconds: 13,
    });
  });

  it('fails loudly when the upsert returns no row', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(store.increment('rl:user:qp', 60)).rejects.toThrow(
      'returned no row',
    );
  });

  it('sweepExpired deletes lapsed counters', async () => {
    prisma.rateLimitCounter.deleteMany.mockResolvedValue({ count: 2 });

    await expect(store.sweepExpired()).resolves.toBe(2);
  });
});
