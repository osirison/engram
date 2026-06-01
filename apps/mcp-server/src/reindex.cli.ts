/**
 * Standalone reindex CLI.
 *
 * Rebuilds the vector store from Postgres without starting the HTTP/MCP server.
 * Use after enabling a vector backend or changing the embedding model.
 *
 * Usage (from repo root):
 *   pnpm --filter mcp-server reindex -- [options]
 *
 * Options:
 *   --user <cuid>        Reindex only this user (default: all users)
 *   --batch-size <n>     Memories per page (1-1000, default 100)
 *   --regenerate         Regenerate embeddings instead of reusing stored ones
 *   --max <n>            Stop after processing at most n memories
 *   --cursor <id>        Resume from a prior cursor
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { MemoryService } from './memory/memory.service';

interface CliArgs {
  userId?: string;
  batchSize?: number;
  reuseExistingEmbeddings?: boolean;
  maxMemories?: number;
  cursor?: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case '--user':
        args.userId = argv[(i += 1)];
        break;
      case '--batch-size': {
        const value = Number.parseInt(argv[(i += 1)] ?? '', 10);
        if (Number.isInteger(value)) {
          args.batchSize = value;
        }
        break;
      }
      case '--max': {
        const value = Number.parseInt(argv[(i += 1)] ?? '', 10);
        if (Number.isInteger(value)) {
          args.maxMemories = value;
        }
        break;
      }
      case '--cursor':
        args.cursor = argv[(i += 1)];
        break;
      case '--regenerate':
        args.reuseExistingEmbeddings = false;
        break;
      default:
        break;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const logger = new Logger('ReindexCli');
  const args = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });

  try {
    const memoryService = app.get(MemoryService);
    logger.log(
      `Starting reindex (${args.userId ? `user=${args.userId}` : 'all users'})`,
    );

    const summary = await memoryService.reindex(args);

    logger.log(
      `Reindex complete: processed=${summary.processed} indexed=${summary.indexed} ` +
        `skipped=${summary.skipped} failed=${summary.failed}`,
    );

    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    logger.error(
      `Reindex failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
