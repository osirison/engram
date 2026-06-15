#!/usr/bin/env node

/**
 * Load test for the ENGRAM memory pipeline.
 *
 * Runs concurrent write (memory create) and recall (vector search) scenarios
 * against a live Postgres+pgvector instance and reports throughput and latency.
 * No OpenAI key required — embeddings are deterministic fake vectors.
 *
 * Usage:
 *   node scripts/load-test.mjs [options]
 *
 * Options:
 *   --duration-ms <ms>    Duration of each scenario (default: 10000)
 *   --concurrency <n>     Parallel workers per scenario (default: 8)
 *   --output <path>       Write JSON report to file (optional)
 *
 * Environment:
 *   DATABASE_URL          Required — Postgres connection string
 */

import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

function parseArgs(argv) {
  const args = { durationMs: 10_000, concurrency: 8, output: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--duration-ms':
        args.durationMs = Number.parseInt(value ?? '', 10);
        i += 1;
        break;
      case '--concurrency':
      case '-c':
        args.concurrency = Number.parseInt(value ?? '', 10);
        i += 1;
        break;
      case '--output':
      case '-o':
        args.output = value;
        i += 1;
        break;
      default:
        break;
    }
  }
  return args;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function summarize(samples, elapsedMs) {
  if (samples.length === 0) {
    return { count: 0, opsPerSec: 0, min: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  }
  const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  return {
    count: samples.length,
    opsPerSec: Number(((samples.length / elapsedMs) * 1000).toFixed(1)),
    min: Number(Math.min(...samples).toFixed(2)),
    mean: Number(mean.toFixed(2)),
    p50: Number(percentile(samples, 50).toFixed(2)),
    p95: Number(percentile(samples, 95).toFixed(2)),
    p99: Number(percentile(samples, 99).toFixed(2)),
    max: Number(Math.max(...samples).toFixed(2)),
  };
}

function fakeEmbedding(seed, dims = 1536) {
  const vec = new Array(dims).fill(0);
  vec[seed % dims] = 1;
  vec[(seed * 7 + 3) % dims] = 0.5;
  const norm = Math.sqrt(1.25);
  return vec.map((v) => v / norm);
}

async function runWriteScenario(prisma, userId, durationMs, concurrency) {
  const samples = [];
  const errors = [];
  let seed = 0;
  const deadline = performance.now() + durationMs;

  async function worker() {
    while (performance.now() < deadline) {
      const mySeed = seed++;
      const t0 = performance.now();
      try {
        await prisma.memory.create({
          data: {
            id: randomUUID(),
            userId,
            content: `load-test memory ${mySeed}: the quick brown fox jumps over the lazy dog`,
            metadata: null,
            tags: ['load-test'],
            type: 'long-term',
            embedding: fakeEmbedding(mySeed),
          },
        });
        samples.push(performance.now() - t0);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }

  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { samples, errors, elapsedMs: performance.now() - started };
}

async function runRecallScenario(prisma, userId, durationMs, concurrency) {
  const samples = [];
  const errors = [];
  let seed = 0;
  const deadline = performance.now() + durationMs;

  async function worker() {
    while (performance.now() < deadline) {
      const vec = fakeEmbedding(seed++);
      const literal = `[${vec.join(',')}]`;
      const t0 = performance.now();
      try {
        await prisma.$queryRawUnsafe(
          'SELECT "id", "content" FROM "memories" WHERE "userId" = $2 AND "embedding_vec" IS NOT NULL ORDER BY "embedding_vec" <=> $1::vector LIMIT 10',
          literal,
          userId,
        );
        samples.push(performance.now() - t0);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }

  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { samples, errors, elapsedMs: performance.now() - started };
}

async function main() {
  const { durationMs, concurrency, output } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const userId = `load-test-${Date.now()}`;
  const userEmail = `${userId}@engram.load`;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  console.log(`ENGRAM load test  duration=${durationMs}ms  concurrency=${concurrency}`);

  try {
    await prisma.$connect();

    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "embedding_vec" vector(1536)',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "memories_embedding_vec_hnsw" ON "memories" USING hnsw ("embedding_vec" vector_cosine_ops)',
    );
    await prisma.user.upsert({
      where: { email: userEmail },
      update: {},
      create: { id: userId, email: userEmail },
    });

    // --- Write scenario ---
    console.log('\n[1/3] Write scenario (concurrent memory create)...');
    const writeResult = await runWriteScenario(prisma, userId, durationMs, concurrency);
    const writeStats = summarize(writeResult.samples, writeResult.elapsedMs);
    console.log(
      `      ops=${writeStats.count}  ops/sec=${writeStats.opsPerSec}  ` +
        `p50=${writeStats.p50}ms  p95=${writeStats.p95}ms  p99=${writeStats.p99}ms`,
    );
    if (writeResult.errors.length > 0) {
      console.warn(`      write errors: ${writeResult.errors.length}`);
    }

    // Backfill embedding_vec so the recall scenario has indexed vectors to search.
    console.log('\n[2/3] Backfilling embedding_vec for indexed recall...');
    const memories = await prisma.memory.findMany({ where: { userId } });
    for (let i = 0; i < memories.length; i++) {
      const literal = `[${fakeEmbedding(i).join(',')}]`;
      await prisma.$executeRawUnsafe(
        'UPDATE "memories" SET "embedding_vec" = $1::vector WHERE "id" = $2',
        literal,
        memories[i].id,
      );
    }
    console.log(`      backfilled ${memories.length} vectors`);

    // --- Recall scenario ---
    console.log('\n[3/3] Recall scenario (concurrent vector search)...');
    const recallResult = await runRecallScenario(prisma, userId, durationMs, concurrency);
    const recallStats = summarize(recallResult.samples, recallResult.elapsedMs);
    console.log(
      `      ops=${recallStats.count}  ops/sec=${recallStats.opsPerSec}  ` +
        `p50=${recallStats.p50}ms  p95=${recallStats.p95}ms  p99=${recallStats.p99}ms`,
    );
    if (recallResult.errors.length > 0) {
      console.warn(`      recall errors: ${recallResult.errors.length}`);
    }

    console.log('\nBottleneck notes:');
    if (writeStats.p95 > 100) {
      console.log('  - Write p95 > 100ms: check Postgres connection pool size and I/O throughput');
    }
    if (recallStats.p95 > 50) {
      console.log('  - Recall p95 > 50ms: HNSW index may need tuning (ef_search, m) or more RAM');
    }
    if (writeStats.opsPerSec < 100) {
      console.log(
        '  - Write throughput < 100 ops/sec: consider connection pooling (PgBouncer) or batching',
      );
    }
    if (recallStats.opsPerSec < 50) {
      console.log('  - Recall throughput < 50 ops/sec: consider read replicas for search traffic');
    }

    const report = {
      generatedAt: new Date().toISOString(),
      config: { durationMs, concurrency },
      write: { ...writeStats, errorCount: writeResult.errors.length },
      recall: { ...recallStats, errorCount: recallResult.errors.length },
    };

    if (output) {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, JSON.stringify(report, null, 2), 'utf8');
      console.log(`\nLoad test report written to ${output}`);
    }
  } finally {
    await prisma.memory.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Load test failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
