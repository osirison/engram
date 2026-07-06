/**
 * Standalone markdown-export CLI (WP3 T6).
 *
 * Dumps a user's ENGRAM memories as an Obsidian-compatible vault (YAML
 * frontmatter + `[[wikilinks]]`) without starting the HTTP/MCP server. This is
 * the first delivery surface: no transport size limit, ideal for a full vault.
 *
 * Usage (from repo root):
 *   pnpm --filter mcp-server export -- --user qp --out ./vault [options]
 *
 * Options:
 *   --user <id>        Owner whose memories to export (required)
 *   --out <dir>        Output directory (default ./engram-export)
 *   --include-stm      Also export short-term (Redis) memories (default off)
 *   --tag <t>          Only memories carrying this tag (repeatable)
 *   --scope <s>        Only memories in this scope namespace
 *   --type <t>         Restrict to one tier: short-term | long-term
 *   --from <iso>       Only memories created on/after this ISO date
 *   --to <iso>         Only memories created on/before this ISO date
 *   --single           Emit one file (anchored) instead of one file per memory
 *   --deterministic    Omit the manifest's exportedAt for byte-identical diffs
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { MemoryExportService } from './memory/export/memory-export.service';
import { DirectorySink } from './memory/export/directory-sink';
import type {
  ExportResult,
  ExportTypeFilter,
  MemoryExportOptions,
} from './memory/export/export.types';

const DEFAULT_OUT_DIR = './engram-export';

export interface ExportCliArgs {
  userId?: string;
  out: string;
  includeStm: boolean;
  tags: string[];
  scope?: string;
  type?: ExportTypeFilter;
  from?: string;
  to?: string;
  single: boolean;
  deterministic: boolean;
}

export function parseArgs(argv: readonly string[]): ExportCliArgs {
  const args: ExportCliArgs = {
    out: DEFAULT_OUT_DIR,
    includeStm: false,
    tags: [],
    single: false,
    deterministic: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case '--user':
        args.userId = argv[(i += 1)];
        break;
      case '--out':
        args.out = argv[(i += 1)] ?? DEFAULT_OUT_DIR;
        break;
      case '--include-stm':
        args.includeStm = true;
        break;
      case '--tag': {
        const tag = argv[(i += 1)];
        if (tag) args.tags.push(tag);
        break;
      }
      case '--scope':
        args.scope = argv[(i += 1)];
        break;
      case '--type': {
        const value = argv[(i += 1)];
        if (value === 'short-term' || value === 'long-term') args.type = value;
        break;
      }
      case '--from':
        args.from = argv[(i += 1)];
        break;
      case '--to':
        args.to = argv[(i += 1)];
        break;
      case '--single':
        args.single = true;
        break;
      case '--deterministic':
        args.deterministic = true;
        break;
      default:
        break;
    }
  }
  return args;
}

/**
 * Map parsed CLI args to service options, validating the required `--user` and
 * any ISO dates. Throws with an operator-friendly message on bad input.
 */
export function buildExportOptions(args: ExportCliArgs): MemoryExportOptions {
  if (!args.userId) {
    throw new Error('--user <id> is required');
  }
  return {
    userId: args.userId,
    includeStm: args.includeStm,
    ...(args.tags.length > 0 ? { tags: args.tags } : {}),
    ...(args.scope ? { scope: args.scope } : {}),
    ...(args.type ? { type: args.type } : {}),
    ...(args.from ? { dateFrom: parseIsoDate(args.from, '--from') } : {}),
    ...(args.to ? { dateTo: parseIsoDate(args.to, '--to') } : {}),
    mode: args.single ? 'single' : 'multi',
    deterministic: args.deterministic,
  };
}

function parseIsoDate(value: string, flag: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${flag} is not a valid ISO date: ${value}`);
  }
  return date;
}

/** Run an export via the given service into `args.out`. Returns the result. */
export async function runExport(
  service: MemoryExportService,
  args: ExportCliArgs,
): Promise<ExportResult> {
  const options = buildExportOptions(args);
  const sink = new DirectorySink(args.out);
  return service.export(options, sink);
}

async function main(): Promise<void> {
  const logger = new Logger('ExportCli');
  const args = parseArgs(process.argv.slice(2));

  if (!args.userId) {
    logger.error('--user <id> is required');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule.forRoot(), {
    bufferLogs: false,
  });

  try {
    const service = app.get(MemoryExportService);
    logger.log(`Exporting memories for user=${args.userId} → ${args.out}`);

    const result = await runExport(service, args);
    const { counts } = result.manifest;
    logger.log(
      `Export complete: total=${counts.total} longTerm=${counts.longTerm} ` +
        `shortTerm=${counts.shortTerm} files=${counts.files} failed=${counts.failed}`,
    );
    if (counts.failed > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    logger.error(
      `Export failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

// Only bootstrap when run directly (not when imported by tests).
if (require.main === module) {
  void main().finally(() => {
    process.exit(process.exitCode ?? 0);
  });
}
