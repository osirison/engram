import { PrismaClient } from '@prisma/client';
import { DEFAULT_EMBEDDING_MODEL } from '../types.js';
import { OpenAIEmbeddingProvider } from '../providers/openai-embedding.provider.js';

const DEFAULT_BATCH_SIZE = 100;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function backfill(): Promise<void> {
  const prisma = new PrismaClient();
  const provider = new OpenAIEmbeddingProvider();

  const batchSize = parsePositiveInt(process.env['BACKFILL_BATCH_SIZE'], DEFAULT_BATCH_SIZE);
  const maxBatches = parsePositiveInt(process.env['BACKFILL_MAX_BATCHES'], Number.MAX_SAFE_INTEGER);
  const dryRun = process.env['BACKFILL_DRY_RUN'] === 'true';

  let totalScanned = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let batches = 0;
  let cursorId: string | undefined;

  console.log(
    `[backfill] starting long-term memory embeddings backfill (batchSize=${batchSize}, maxBatches=${maxBatches}, dryRun=${dryRun})`,
  );

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
        const embedding = await provider.generate(memory.content, DEFAULT_EMBEDDING_MODEL);
        if (!embedding || embedding.length === 0) {
          totalSkipped += 1;
          continue;
        }

        if (!dryRun) {
          await prisma.memory.update({
            where: { id: memory.id },
            data: { embedding },
          });
        }

        totalUpdated += 1;
      }

      console.log(
        `[backfill] batch ${batches} complete (scanned=${totalScanned}, updated=${totalUpdated}, skipped=${totalSkipped})`,
      );
    }

    console.log(
      `[backfill] done (batches=${batches}, scanned=${totalScanned}, updated=${totalUpdated}, skipped=${totalSkipped}, dryRun=${dryRun})`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void backfill().catch((error) => {
  console.error('[backfill] failed', error);
  process.exitCode = 1;
});
