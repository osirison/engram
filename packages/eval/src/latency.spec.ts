import { describe, it, expect, vi } from 'vitest';

import { percentile, summarize, runLatencyBenchmark, type LatencyTarget } from './latency.js';

describe('percentile', () => {
  it('returns 0 for an empty input', () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it('returns the single value regardless of p', () => {
    expect(percentile([42], 0.99)).toBe(42);
  });

  it('computes the median via interpolation', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it('clamps p to [0, 1]', () => {
    expect(percentile([10, 20, 30], -1)).toBe(10);
    expect(percentile([10, 20, 30], 2)).toBe(30);
  });

  it('is order-independent', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBeCloseTo(percentile([1, 2, 3, 4, 5], 0.95));
  });
});

describe('summarize', () => {
  it('returns zeros for an empty sample set', () => {
    expect(summarize([])).toEqual({ count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 });
  });

  it('summarizes min, max, mean, and percentiles', () => {
    const summary = summarize([10, 20, 30, 40, 50]);
    expect(summary.count).toBe(5);
    expect(summary.min).toBe(10);
    expect(summary.max).toBe(50);
    expect(summary.mean).toBe(30);
    expect(summary.p50).toBe(30);
  });
});

describe('runLatencyBenchmark', () => {
  function fakeClock(steps: number[]): () => number {
    let index = 0;
    return () => {
      const value = steps[index] ?? steps[steps.length - 1] ?? 0;
      index += 1;
      return value;
    };
  }

  it('rejects non-positive iteration counts', async () => {
    const target: LatencyTarget = { search: vi.fn() };
    await expect(runLatencyBenchmark({ target, iterations: 0 })).rejects.toThrow(
      'iterations must be a positive integer'
    );
  });

  it('measures each search call using the injected clock', async () => {
    const search = vi.fn().mockResolvedValue(undefined);
    // Pairs of (start, end): latencies 5, 10, 15.
    const now = fakeClock([0, 5, 100, 110, 200, 215]);

    const result = await runLatencyBenchmark({
      target: { search },
      iterations: 3,
      now,
    });

    expect(search).toHaveBeenCalledTimes(3);
    expect(result.samples).toEqual([5, 10, 15]);
    expect(result.summary.count).toBe(3);
    expect(result.summary.min).toBe(5);
    expect(result.summary.max).toBe(15);
    expect(result.passed).toBe(true);
  });

  it('runs seed and teardown around measurement', async () => {
    const calls: string[] = [];
    const target: LatencyTarget = {
      seed: vi.fn(async () => {
        calls.push('seed');
      }),
      search: vi.fn(async () => {
        calls.push('search');
      }),
      teardown: vi.fn(async () => {
        calls.push('teardown');
      }),
    };

    await runLatencyBenchmark({ target, iterations: 2, now: fakeClock([0, 1, 2, 3]) });

    expect(calls).toEqual(['seed', 'search', 'search', 'teardown']);
  });

  it('excludes warmup calls from samples', async () => {
    const search = vi.fn().mockResolvedValue(undefined);
    const result = await runLatencyBenchmark({
      target: { search },
      iterations: 2,
      warmup: 1,
      now: fakeClock([0, 0, 0, 1, 0, 2]),
    });

    expect(search).toHaveBeenCalledTimes(3); // 1 warmup + 2 measured
    expect(result.samples).toHaveLength(2);
  });

  it('reports threshold breaches', async () => {
    const result = await runLatencyBenchmark({
      target: { search: vi.fn().mockResolvedValue(undefined) },
      iterations: 2,
      thresholds: { p95: 5, max: 5 },
      now: fakeClock([0, 10, 100, 120]),
    });

    expect(result.passed).toBe(false);
    expect(result.breaches.map((b) => b.metric)).toEqual(expect.arrayContaining(['p95', 'max']));
  });

  it('still tears down when a search rejects', async () => {
    const teardown = vi.fn().mockResolvedValue(undefined);
    const target: LatencyTarget = {
      search: vi.fn().mockRejectedValue(new Error('boom')),
      teardown,
    };

    await expect(
      runLatencyBenchmark({ target, iterations: 1, now: fakeClock([0, 1]) })
    ).rejects.toThrow('boom');
    expect(teardown).toHaveBeenCalledTimes(1);
  });
});
