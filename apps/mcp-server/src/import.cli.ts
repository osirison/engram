/**
 * Standalone agentic-memory import CLI (WP4 T12).
 *
 * Imports agent memory files (Claude/Copilot/Cursor/Codex/Gemini/markdown) from
 * a path into long-term memory, preserving inter-memory links. Idempotent;
 * safe to re-run. Mirrors reindex.cli.ts.
 *
 * Usage (from repo root):
 *   pnpm --filter mcp-server import -- <source> <path> [options]
 *
 * Arguments:
 *   <source>   claude-code | copilot | cursor | codex | gemini | markdown
 *   <path>     Filesystem path to import from
 *
 * Options:
 *   --user <id>              Data owner the memories are written for
 *   --scope <s>              Dedup/link namespace (default: import)
 *   --dry-run                Parse + estimate only; write nothing
 *   --secrets <policy>       redact | flag | skip | fail (default: redact)
 *   --no-embed               Store without embeddings; reindex later
 *   --split-headings         H2-chunk 1-file-1-memory sources (markdown vaults)
 *   --include-global         Include ~/.codex / ~/.gemini global files
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import {
  MemoryImportService,
  type ImportRunInput,
  type SourceTool,
  type SecretPolicy,
} from '@engram/memory-import';
import { AppModule } from './app.module';

const SOURCES: readonly SourceTool[] = [
  'claude-code',
  'copilot',
  'cursor',
  'codex',
  'gemini',
  'markdown',
];
const SECRET_POLICIES: readonly SecretPolicy[] = [
  'redact',
  'flag',
  'skip',
  'fail',
];

interface CliArgs {
  source?: SourceTool;
  path?: string;
  userId?: string;
  scope?: string;
  dryRun?: boolean;
  secretsPolicy?: SecretPolicy;
  embed?: boolean;
  splitHeadings?: boolean;
  includeGlobal?: boolean;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case '--user':
        args.userId = argv[(i += 1)];
        break;
      case '--scope':
        args.scope = argv[(i += 1)];
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--secrets': {
        const value = argv[(i += 1)];
        if (value && (SECRET_POLICIES as readonly string[]).includes(value)) {
          args.secretsPolicy = value as SecretPolicy;
        }
        break;
      }
      case '--no-embed':
        args.embed = false;
        break;
      case '--split-headings':
        args.splitHeadings = true;
        break;
      case '--include-global':
        args.includeGlobal = true;
        break;
      default:
        if (flag && !flag.startsWith('--')) positional.push(flag);
        break;
    }
  }
  const [source, path] = positional;
  if (source && (SOURCES as readonly string[]).includes(source))
    args.source = source as SourceTool;
  if (path) args.path = path;
  return args;
}

async function main(): Promise<void> {
  const logger = new Logger('ImportCli');
  const args = parseArgs(process.argv.slice(2));

  if (!args.source || !args.path) {
    logger.error(
      `Usage: import <source> <path> [--user <id>] [--scope <s>] [--dry-run] ` +
        `[--secrets redact|flag|skip|fail] [--no-embed] [--split-headings] [--include-global]\n` +
        `  <source> must be one of: ${SOURCES.join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }
  if (!args.userId) {
    logger.error('Missing required --user <id>');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule.forRoot(), {
    bufferLogs: false,
  });

  try {
    const importService = app.get(MemoryImportService);
    const input: ImportRunInput = {
      source: args.source,
      path: args.path,
      userId: args.userId,
      ...(args.scope !== undefined ? { scope: args.scope } : {}),
      ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
      ...(args.secretsPolicy !== undefined
        ? { secretsPolicy: args.secretsPolicy }
        : {}),
      ...(args.embed !== undefined ? { embed: args.embed } : {}),
      ...(args.splitHeadings !== undefined
        ? { splitHeadings: args.splitHeadings }
        : {}),
      ...(args.includeGlobal !== undefined
        ? { includeGlobal: args.includeGlobal }
        : {}),
    };
    logger.log(
      `Importing ${args.source} from ${args.path} (user=${args.userId})${args.dryRun ? ' [dry-run]' : ''}`,
    );

    const summary = await importService.run(input);

    logger.log(
      `Import complete: parsed=${summary.parsed} created=${summary.created} updated=${summary.updated} ` +
        `skipped=${summary.skipped} merged=${summary.mergedIntoExisting} secretsSkipped=${summary.secretsSkipped} ` +
        `failed=${summary.failed} links(resolved=${summary.links.resolved} deferred=${summary.links.deferred} ` +
        `dangling=${summary.links.dangling}) est=$${summary.embeddingCostEstimate.approxUsd}`,
    );
    for (const advisory of summary.advisories) logger.warn(advisory);
    if (summary.secrets.length > 0) {
      logger.warn(
        `Secrets detected in ${summary.secrets.length} file(s): ${summary.secrets.map((s) => s.path).join(', ')}`,
      );
    }

    if (summary.failed > 0 || summary.cursor !== undefined) {
      process.exitCode = 1;
    }
  } catch (error) {
    logger.error(
      `Import failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

// Only auto-run when invoked as the CLI entrypoint (not when imported by a spec).
if (process.argv[1] && /import\.cli\./.test(process.argv[1])) {
  void main().finally(() => {
    process.exit(process.exitCode ?? 0);
  });
}
