import { describe, it, expect, vi } from 'vitest';

import { createVectorStoreLatencyTarget, type VectorStoreLike } from './latency-adapters.js';
import { runLatencyBenchmark } from './latency.js';

function createMockStore(): VectorStoreLike & {
  upsert: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe('createVectorStoreLatencyTarget', () => {
  it('throws when no queries are provided', () => {
    expect(() =>
      createVectorStoreLatencyTarget({
        store: createMockStore(),
        records: [],
        queries: [],
      })
    ).toThrow(/at least one query/);
  });

  it('seeds records, cycles queries on search, and cleans up on teardown', async () => {
    const store = createMockStore();
    const records = [
      { id: 'a', vector: [0.1, 0.2], metadata: { scope: 'x' } },
      { id: 'b', vector: [0.3, 0.4] },
    ];
    const queries = [{ vector: [0.1, 0.2], limit: 3 }, { vector: [0.9, 0.8] }];

    const target = createVectorStoreLatencyTarget({
      store,
      records,
      queries,
      defaultLimit: 7,
    });

    await target.seed?.();
    expect(store.upsert).toHaveBeenCalledTimes(1);
    expect(store.upsert).toHaveBeenCalledWith([
      { id: 'a', vector: [0.1, 0.2], metadata: { scope: 'x' } },
      { id: 'b', vector: [0.3, 0.4], metadata: undefined },
    ]);

    await target.search(0);
    expect(store.search).toHaveBeenLastCalledWith([0.1, 0.2], 3, undefined);

    // Second query omits a limit, so the default is used; index wraps around.
    await target.search(1);
    expect(store.search).toHaveBeenLastCalledWith([0.9, 0.8], 7, undefined);

    await target.search(2);
    expect(store.search).toHaveBeenLastCalledWith([0.1, 0.2], 3, undefined);

    await target.teardown?.();
    expect(store.delete).toHaveBeenCalledWith(['a', 'b']);
  });

  it('does not seed when there are no records', async () => {
    const store = createMockStore();
    const target = createVectorStoreLatencyTarget({
      store,
      records: [],
      queries: [{ vector: [1] }],
    });

    await target.seed?.();
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('skips cleanup when cleanup is disabled', async () => {
    const store = createMockStore();
    const target = createVectorStoreLatencyTarget({
      store,
      records: [{ id: 'a', vector: [1] }],
      queries: [{ vector: [1] }],
      cleanup: false,
    });

    await target.teardown?.();
    expect(store.delete).not.toHaveBeenCalled();
  });

  it('skips cleanup when the store has no delete method', async () => {
    const store: VectorStoreLike = {
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
    };
    const target = createVectorStoreLatencyTarget({
      store,
      records: [{ id: 'a', vector: [1] }],
      queries: [{ vector: [1] }],
    });

    // Should not throw despite no delete method.
    await expect(target.teardown?.()).resolves.toBeUndefined();
  });

  it('drives a full benchmark against the adapter', async () => {
    const store = createMockStore();
    const target = createVectorStoreLatencyTarget({
      store,
      records: [{ id: 'a', vector: [1, 0] }],
      queries: [{ vector: [1, 0] }],
    });

    let clock = 0;
    const result = await runLatencyBenchmark({
      target,
      iterations: 4,
      warmup: 1,
      now: () => (clock += 2),
    });

    expect(result.summary.count).toBe(4);
    expect(store.upsert).toHaveBeenCalledTimes(1);
    // 1 warmup + 4 measured search calls.
    expect(store.search).toHaveBeenCalledTimes(5);
    expect(store.delete).toHaveBeenCalledTimes(1);
  });

  it('passes query filter and default filter to the backend search', async () => {
    const store = createMockStore();
    const target = createVectorStoreLatencyTarget({
      store,
      records: [{ id: 'a', vector: [1, 0] }],
      queries: [{ vector: [1, 0], filter: { userId: 'u1' } }, { vector: [0, 1] }],
      defaultFilter: { userId: 'default-user' },
    });

    await target.search(0);
    expect(store.search).toHaveBeenLastCalledWith([1, 0], 10, { userId: 'u1' });

    await target.search(1);
    expect(store.search).toHaveBeenLastCalledWith([0, 1], 10, { userId: 'default-user' });
  });
});
