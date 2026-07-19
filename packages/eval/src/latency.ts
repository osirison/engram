/**
 * Latency benchmarking for retrieval backends.
 *
 * Backend-agnostic: any vector store (pgvector or a fake) can be
 * measured by implementing the small {@link LatencyTarget} contract. The
 * benchmark seeds the target, issues repeated searches, records per-call
 * wall-clock latency, and summarizes the distribution with percentiles.
 */

/** A measurable retrieval backend. */
export interface LatencyTarget {
  /** Optional one-time setup (e.g. upsert fixtures) run before measurement. */
  seed?: () => Promise<void> | void;
  /** A single search invocation to measure. */
  search: (iteration: number) => Promise<unknown>;
  /** Optional teardown run after measurement completes. */
  teardown?: () => Promise<void> | void;
}

/** Latency distribution summary in milliseconds. */
export interface LatencySummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

/** Optional pass/fail thresholds in milliseconds. */
export interface LatencyThresholds {
  p50?: number;
  p95?: number;
  p99?: number;
  max?: number;
}

export interface LatencyBenchmarkOptions {
  target: LatencyTarget;
  /** Number of measured search calls. Must be a positive integer. */
  iterations: number;
  /** Untimed warmup calls run before measurement (default 0). */
  warmup?: number;
  /** Optional thresholds; breaches are reported in the result. */
  thresholds?: LatencyThresholds;
  /** Clock source (injectable for deterministic tests). Defaults to performance.now. */
  now?: () => number;
}

export interface LatencyBenchmarkResult {
  summary: LatencySummary;
  /** Raw per-call samples in milliseconds, in execution order. */
  samples: number[];
  /** Threshold breaches keyed by metric, present only when thresholds are set. */
  breaches: Array<{ metric: keyof LatencyThresholds; value: number; threshold: number }>;
  /** True when no thresholds were breached (or none were provided). */
  passed: boolean;
}

/**
 * Compute the p-th percentile of `values` using linear interpolation between
 * closest ranks. `p` is a fraction in [0, 1]. Returns 0 for an empty input.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const clamped = Math.min(1, Math.max(0, p));
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) {
    return sorted[0] as number;
  }
  const rank = clamped * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const lowValue = sorted[low] as number;
  if (low === high) {
    return lowValue;
  }
  const highValue = sorted[high] as number;
  return lowValue + (highValue - lowValue) * (rank - low);
}

/** Summarize a set of latency samples (milliseconds). */
export function summarize(samples: readonly number[]): LatencySummary {
  if (samples.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  }
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const value of samples) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  return {
    count: samples.length,
    min,
    max,
    mean: sum / samples.length,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
  };
}

/**
 * Run a latency benchmark against a {@link LatencyTarget}.
 *
 * Seeds the target, performs optional warmup, measures `iterations` search
 * calls, then tears down. Returns the latency summary, raw samples, and any
 * threshold breaches.
 */
export async function runLatencyBenchmark(
  options: LatencyBenchmarkOptions
): Promise<LatencyBenchmarkResult> {
  const { target, iterations, warmup = 0, thresholds, now = defaultNow } = options;

  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error('iterations must be a positive integer');
  }
  if (!Number.isInteger(warmup) || warmup < 0) {
    throw new Error('warmup must be a non-negative integer');
  }

  if (target.seed) {
    await target.seed();
  }

  try {
    for (let i = 0; i < warmup; i += 1) {
      await target.search(i);
    }

    const samples: number[] = [];
    for (let i = 0; i < iterations; i += 1) {
      const start = now();
      await target.search(i);
      samples.push(now() - start);
    }

    const summary = summarize(samples);
    const breaches = collectBreaches(summary, thresholds);

    return { summary, samples, breaches, passed: breaches.length === 0 };
  } finally {
    if (target.teardown) {
      await target.teardown();
    }
  }
}

function collectBreaches(
  summary: LatencySummary,
  thresholds?: LatencyThresholds
): LatencyBenchmarkResult['breaches'] {
  if (!thresholds) {
    return [];
  }
  const breaches: LatencyBenchmarkResult['breaches'] = [];
  const metrics: Array<keyof LatencyThresholds> = ['p50', 'p95', 'p99', 'max'];
  for (const metric of metrics) {
    const threshold = thresholds[metric];
    if (threshold === undefined) {
      continue;
    }
    const value = summary[metric];
    if (value > threshold) {
      breaches.push({ metric, value, threshold });
    }
  }
  return breaches;
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
