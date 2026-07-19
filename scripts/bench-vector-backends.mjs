#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

function parseArgs(argv) {
  const args = {
    iterations: 80,
    warmup: 20,
    limit: 10,
    p95: undefined,
    output: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--iterations':
      case '-n':
        args.iterations = Number.parseInt(value ?? '', 10);
        i += 1;
        break;
      case '--warmup':
        args.warmup = Number.parseInt(value ?? '', 10);
        i += 1;
        break;
      case '--limit':
        args.limit = Number.parseInt(value ?? '', 10);
        i += 1;
        break;
      case '--p95':
        args.p95 = Number.parseFloat(value ?? '');
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
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function summarize(samples) {
  return {
    count: samples.length,
    min: Math.min(...samples),
    mean: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    max: Math.max(...samples),
  };
}

function makeVector(dimensions, seed) {
  const vector = new Array(dimensions).fill(0);
  vector[seed % dimensions] = 1;
  vector[(seed * 13) % dimensions] = 0.25;
  return vector;
}

async function benchmark(name, warmup, iterations, runSearch) {
  for (let i = 0; i < warmup; i += 1) {
    await runSearch(i);
  }

  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    await runSearch(i);
    samples.push(performance.now() - started);
  }

  const stats = summarize(samples);
  console.log(`${name} latency (ms): min=${stats.min.toFixed(2)} mean=${stats.mean.toFixed(2)} p95=${stats.p95.toFixed(2)} p99=${stats.p99.toFixed(2)} max=${stats.max.toFixed(2)}`);
  return stats;
}

function vectorLiteral(vector) {
  return `[${vector.join(',')}]`;
}

async function run() {
  const { iterations, warmup, limit, p95, output } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const dimensions = Number.parseInt(process.env.VECTOR_DIMENSIONS ?? '1536', 10);
  const recordCount = 120;
  const queryCount = 12;
  const userId = 'bench-user';
  const userEmail = 'bench-user@engram.local';
  const prefix = `bench-${Date.now()}`;

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  const records = Array.from({ length: recordCount }, (_, index) => ({
    id: `${prefix}-mem-${index}`,
    vector: makeVector(dimensions, index + 1),
  }));
  const queries = Array.from({ length: queryCount }, (_, index) =>
    makeVector(dimensions, index + 7),
  );

  try {
    await prisma.$connect();

    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "embedding_vec" vector(1536)'
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "memories_embedding_vec_hnsw" ON "memories" USING hnsw ("embedding_vec" vector_cosine_ops)'
    );

    await prisma.user.upsert({
      where: { email: userEmail },
      update: {},
      create: { id: userId, email: userEmail },
    });

    await prisma.memory.createMany({
      data: records.map((record) => ({
        id: record.id,
        userId,
        content: `benchmark memory ${record.id}`,
        metadata: null,
        tags: ['benchmark'],
        type: 'long-term',
        embedding: record.vector,
      })),
      skipDuplicates: true,
    });

    for (const record of records) {
      await prisma.$executeRawUnsafe(
        'UPDATE "memories" SET "embedding_vec" = $1::vector WHERE "id" = $2',
        vectorLiteral(record.vector),
        record.id,
      );
    }

    const pgStats = await benchmark('pgvector', warmup, iterations, async (i) => {
      const vector = queries[i % queries.length];
      await prisma.$queryRawUnsafe(
        'SELECT "id" FROM "memories" WHERE "userId" = $2 AND "embedding_vec" IS NOT NULL ORDER BY "embedding_vec" <=> $1::vector LIMIT 10',
        vectorLiteral(vector),
        userId,
      );
    });

    const breaches = [];
    if (typeof p95 === 'number') {
      if (pgStats.p95 > p95) {
        breaches.push(`pgvector p95 ${pgStats.p95.toFixed(2)}ms > ${p95}ms`);
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      config: { iterations, warmup, limit, p95 },
      pgvector: pgStats,
      breaches,
    };

    if (output) {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, JSON.stringify(report, null, 2), 'utf8');
      console.log(`Benchmark artifact written to ${output}`);
    }

    if (breaches.length > 0) {
      throw new Error(`Backend benchmark thresholds failed: ${breaches.join('; ')}`);
    }
  } finally {
    await prisma.memory.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Vector backend benchmark failed:', message);
  process.exitCode = 1;
});
