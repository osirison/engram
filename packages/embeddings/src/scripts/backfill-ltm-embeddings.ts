import { PrismaClient } from '@prisma/client';
import { DEFAULT_EMBEDDING_MODEL } from '../types.js';
import { DisabledEmbeddingProvider } from '../providers/disabled-embedding.provider.js';
import { LocalEmbeddingProvider } from '../providers/local-embedding.provider.js';
import { OpenAIEmbeddingProvider } from '../providers/openai-embedding.provider.js';
import {
  DEFAULT_EMBEDDING_PROVIDER,
  type EmbeddingProviderName,
} from '../providers/provider.tokens.js';
import type { EmbeddingProvider } from '../providers/embedding-provider.interface.js';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function selectProvider(name: EmbeddingProviderName): EmbeddingProvider {
  switch (name) {
    case 'disabled':
      return new DisabledEmbeddingProvider();
    case 'local':
      return new LocalEmbeddingProvider();
    case 'openai':
    default:
      return new OpenAIEmbeddingProvider();
  }
}

function logInfo(event: string, metadata: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ event, ...metadata })}\n`);
}

function logError(event: string, metadata: Record<string, unknown>): void {
  console.error(JSON.stringify({ event, ...metadata }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRetry<T>(
  operation: string,
  fn: () => Promise<T>,
  retryAttempts: number,
  retryBaseDelayMs: number,
  metadata: Record<string, unknown>
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < retryAttempts) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= retryAttempts) {
        break;
      }

      const delayMs = retryBaseDelayMs * 2 ** (attempt - 1);
      logError(`embedding.backfill.${operation}_retry`, {
        ...metadata,
        attempt,
        retryAttempts,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function backfill(): Promise<void> {
  const prisma = new PrismaClient();
  const providerName =
    (process.env['EMBEDDING_PROVIDER'] as EmbeddingProviderName | undefined) ??
    DEFAULT_EMBEDDING_PROVIDER;
  const provider = selectProvider(providerName);

  const batchSize = parsePositiveInt(process.env['BACKFILL_BATCH_SIZE'], DEFAULT_BATCH_SIZE);
  const maxBatches = parsePositiveInt(process.env['BACKFILL_MAX_BATCHES'], Number.MAX_SAFE_INTEGER);
  const dryRun = process.env['BACKFILL_DRY_RUN'] === 'true';
  const retryAttempts = parsePositiveInt(
    process.env['BACKFILL_RETRY_ATTEMPTS'],
    DEFAULT_RETRY_ATTEMPTS
  );
  const retryBaseDelayMs = parsePositiveInt(
    process.env['BACKFILL_RETRY_BASE_DELAY_MS'],
    DEFAULT_RETRY_BASE_DELAY_MS
  );

  let totalScanned = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalProviderErrors = 0;
  let batches = 0;
  let cursorId: string | undefined;

  logInfo('embedding.backfill.start', {
    batchSize,
    maxBatches,
    dryRun,
    providerName,
    retryAttempts,
    retryBaseDelayMs,
  });

  try {
    while (batches < maxBatches) {
      const memories = await prisma.memory.findMany({
        where: {
          type: 'long-term',
          embedding: { isEmpty: true },
        },
        select: {
          id: true,
          content: true,
        },
        orderBy: {
          id: 'asc',
        },
        ...(cursorId
          ? {
              cursor: { id: cursorId },
              skip: 1,
            }
          : {}),
        take: batchSize,
      });

      if (memories.length === 0) {
        break;
      }

      batches += 1;
      totalScanned += memories.length;
      cursorId = memories[memories.length - 1]?.id;

      for (const memory of memories) {
        const embedding = await withRetry(
          'provider',
          async () => provider.generate(memory.content, DEFAULT_EMBEDDING_MODEL),
          retryAttempts,
          retryBaseDelayMs,
          { memoryId: memory.id }
        ).catch((error) => {
          totalProviderErrors += 1;
          logError('embedding.backfill.provider_error', {
            memoryId: memory.id,
            error: error instanceof Error ? error.message : String(error),
            totalProviderErrors,
          });
          return null;
        });

        if (!embedding || embedding.length === 0) {
          totalSkipped += 1;
          continue;
        }

        if (!dryRun) {
          await withRetry(
            'db_update',
            async () =>
              prisma.memory.update({
                where: { id: memory.id },
                data: { embedding },
              }),
            retryAttempts,
            retryBaseDelayMs,
            { memoryId: memory.id }
          );
        }

        totalUpdated += 1;
      }

      logInfo('embedding.backfill.batch_complete', {
        batch: batches,
        scanned: totalScanned,
        updated: totalUpdated,
        skipped: totalSkipped,
        providerErrors: totalProviderErrors,
      });
    }

    logInfo('embedding.backfill.complete', {
      batches,
      scanned: totalScanned,
      updated: totalUpdated,
      skipped: totalSkipped,
      providerErrors: totalProviderErrors,
      dryRun,
      providerName,
    });
  } finally {
    await prisma.$disconnect();
  }
}

void backfill().catch((error) => {
  logError('embedding.backfill.failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
