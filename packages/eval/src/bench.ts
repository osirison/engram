/**
 * CLI entry point for latency benchmarking. Invoked via `pnpm bench`.
 *
 * By default it runs against a deterministic in-memory fake target so the
 * command is runnable with no external services. Real backends can be measured
 * by wiring {@link createVectorStoreLatencyTarget} to a pgvector
 * store in a consumer script.
 */

import { runLatencyBenchmark } from './latency.js';
import type { LatencyTarget, LatencyThresholds } from './latency.js';

interface BenchArgs {
  iterations: number;
  warmup: number;
  thresholds: LatencyThresholds;
}

function parseArgs(argv: readonly string[]): BenchArgs {
  const args: BenchArgs = { iterations: 100, warmup: 10, thresholds: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case '--iterations':
      case '-n':
        args.iterations = Number.parseInt(argv[(i += 1)] ?? '', 10);
        break;
      case '--warmup':
        args.warmup = Number.parseInt(argv[(i += 1)] ?? '', 10);
        break;
      case '--p95':
        args.thresholds.p95 = Number.parseFloat(argv[(i += 1)] ?? '');
        break;
      case '--p99':
        args.thresholds.p99 = Number.parseFloat(argv[(i += 1)] ?? '');
        break;
      default:
        break;
    }
  }
  return args;
}

/**
 * A deterministic fake target. Simulates retrieval latency with a fixed
 * pseudo-random sequence so the default benchmark is reproducible and needs no
 * services. Replace with {@link createVectorStoreLatencyTarget} for real runs.
 */
function createFakeTarget(): LatencyTarget {
  let state = 0x2545f491;
  const nextDelay = (): number => {
    // xorshift for a stable pseudo-random latency in ~[1, 6) ms.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const unit = ((state >>> 0) % 1000) / 1000;
    return 1 + unit * 5;
  };

  return {
    search: async () => {
      await new Promise((resolve) => setTimeout(resolve, nextDelay()));
      return [];
    },
  };
}

async function main(): Promise<void> {
  const { iterations, warmup, thresholds } = parseArgs(process.argv.slice(2));
  const target = createFakeTarget();

  const result = await runLatencyBenchmark({
    target,
    iterations,
    warmup,
    thresholds: Object.keys(thresholds).length > 0 ? thresholds : undefined,
  });

  const { summary } = result;
  console.log('Latency benchmark (fake target)');
  console.log(`  iterations: ${summary.count}`);
  console.log(`  min:  ${summary.min.toFixed(2)} ms`);
  console.log(`  mean: ${summary.mean.toFixed(2)} ms`);
  console.log(`  p50:  ${summary.p50.toFixed(2)} ms`);
  console.log(`  p95:  ${summary.p95.toFixed(2)} ms`);
  console.log(`  p99:  ${summary.p99.toFixed(2)} ms`);
  console.log(`  max:  ${summary.max.toFixed(2)} ms`);

  if (result.breaches.length > 0) {
    console.error('\nThreshold breaches:');
    for (const breach of result.breaches) {
      console.error(`  - ${breach.metric}: ${breach.value.toFixed(2)} ms > ${breach.threshold} ms`);
    }
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('Latency benchmark failed:', error);
  process.exitCode = 1;
});
