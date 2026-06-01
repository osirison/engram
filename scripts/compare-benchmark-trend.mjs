#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

function parseArgs(argv) {
  const args = {
    current: 'artifacts/bench-results.json',
    baseline: 'artifacts/bench-baseline.json',
    out: 'artifacts/bench-trend-summary.json',
    maxP95Delta: 20,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--current':
        args.current = value ?? args.current;
        i += 1;
        break;
      case '--baseline':
        args.baseline = value ?? args.baseline;
        i += 1;
        break;
      case '--out':
      case '-o':
        args.out = value ?? args.out;
        i += 1;
        break;
      case '--max-p95-delta':
        args.maxP95Delta = Number.parseFloat(value ?? '20');
        i += 1;
        break;
      default:
        break;
    }
  }
  return args;
}

async function readJson(path) {
  const content = await readFile(path, 'utf8');
  return JSON.parse(content);
}

function buildDelta(current, baseline, maxP95Delta) {
  const pgvectorDelta = current.pgvector.p95 - baseline.pgvector.p95;
  const qdrantDelta = current.qdrant.p95 - baseline.qdrant.p95;
  const breaches = [];

  if (pgvectorDelta > maxP95Delta) {
    breaches.push(`pgvector p95 delta ${pgvectorDelta.toFixed(2)}ms > ${maxP95Delta}ms`);
  }
  if (qdrantDelta > maxP95Delta) {
    breaches.push(`qdrant p95 delta ${qdrantDelta.toFixed(2)}ms > ${maxP95Delta}ms`);
  }

  return {
    generatedAt: new Date().toISOString(),
    thresholdMs: maxP95Delta,
    current: {
      pgvectorP95: current.pgvector.p95,
      qdrantP95: current.qdrant.p95,
    },
    baseline: {
      pgvectorP95: baseline.pgvector.p95,
      qdrantP95: baseline.qdrant.p95,
    },
    deltas: {
      pgvectorP95: pgvectorDelta,
      qdrantP95: qdrantDelta,
    },
    breaches,
    passed: breaches.length === 0,
  };
}

async function main() {
  const { current, baseline, out, maxP95Delta } = parseArgs(process.argv.slice(2));

  let currentReport;
  try {
    currentReport = await readJson(current);
  } catch (error) {
    throw new Error(
      `Current benchmark report missing or invalid at ${current}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let baselineReport;
  try {
    baselineReport = await readJson(baseline);
  } catch {
    console.log(`Skipping trend comparison: baseline report not found at ${baseline}`);
    return;
  }

  const summary = buildDelta(currentReport, baselineReport, maxP95Delta);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`Benchmark trend summary written to ${out}`);

  if (!summary.passed) {
    throw new Error(`Benchmark trend regression detected: ${summary.breaches.join('; ')}`);
  }
}

main().catch((error) => {
  console.error('Benchmark trend comparison failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
