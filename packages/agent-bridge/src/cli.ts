#!/usr/bin/env node
import { createEngramClient } from './bridge.js';
import {
  runCapture,
  runRecall,
  runRecallContext,
  runRemember,
  runSyncSpool,
  type CommandDeps,
} from './commands.js';
import { resolveConfig } from './config.js';
import { createOpenAiDistillProvider } from './distill.js';
import { createLogger } from './logger.js';
import { SpoolStore } from './spool.js';

const BOOLEAN_FLAGS = new Set(['json']);

interface ParsedArgs {
  command?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { command, positionals, flags };
}

function str(flags: Record<string, string | boolean>, name: string): string | undefined {
  const v = flags[name];
  return typeof v === 'string' ? v : undefined;
}

function num(flags: Record<string, string | boolean>, name: string): number | undefined {
  const v = str(flags, name);
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function float(flags: Record<string, string | boolean>, name: string): number | undefined {
  const v = str(flags, name);
  if (v === undefined) return undefined;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

function tags(flags: Record<string, string | boolean>, name: string): string[] | undefined {
  const v = str(flags, name);
  if (v === undefined) return undefined;
  const list = v
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return list.length > 0 ? list : undefined;
}

function memoryType(
  flags: Record<string, string | boolean>
): 'auto' | 'short-term' | 'long-term' | undefined {
  const v = str(flags, 'type');
  return v === 'short-term' || v === 'long-term' || v === 'auto' ? v : undefined;
}

const USAGE = `engram — ENGRAM agent-memory bridge (non-blocking; exits 0 on failure)

Usage:
  engram recall-context [--scope project:<slug>] [--budget <chars>]
  engram recall <query> [--scope <scope>] [--tags a,b] [--limit <n>] [--json]
  engram remember <content> [--scope <scope>] [--tags a,b] [--type auto|short-term|long-term] [--importance <0-1>]
  engram capture --transcript <path> [--scope <scope>]
  engram sync-spool

Environment:
  ENGRAM_URL (default http://127.0.0.1:3000/mcp), ENGRAM_API_KEY, ENGRAM_USER_ID (default qp),
  ENGRAM_AGENT, ENGRAM_TIMEOUT_MS (default 2000), ENGRAM_SPOOL (default ~/.engram/spool.jsonl),
  ENGRAM_DISTILL_API_KEY | OPENAI_API_KEY, ENGRAM_DISTILL_MODEL, ENGRAM_DISTILL_BASE_URL.
`;

async function main(): Promise<number> {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2));
  const config = resolveConfig();
  const deps: CommandDeps = {
    config,
    spool: new SpoolStore(config.spoolPath),
    logger: createLogger(
      process.env['ENGRAM_DEBUG'] === '1' || process.env['ENGRAM_DEBUG'] === 'true'
    ),
    createClient: () => createEngramClient(config),
    distillProvider: createOpenAiDistillProvider(config.distill),
    now: () => new Date(),
    stdout: (text) => process.stdout.write(text),
  };

  switch (command) {
    case 'recall-context':
      return runRecallContext({ scope: str(flags, 'scope'), budget: num(flags, 'budget') }, deps);
    case 'recall':
      return runRecall(
        {
          query: positionals.join(' ') || str(flags, 'query') || '',
          scope: str(flags, 'scope'),
          tags: tags(flags, 'tags'),
          limit: num(flags, 'limit'),
          json: flags['json'] === true,
        },
        deps
      );
    case 'remember':
      return runRemember(
        {
          content: positionals.join(' ') || str(flags, 'content') || '',
          scope: str(flags, 'scope'),
          tags: tags(flags, 'tags'),
          type: memoryType(flags),
          importance: float(flags, 'importance'),
        },
        deps
      );
    case 'capture':
      return runCapture(
        {
          transcript: str(flags, 'transcript') ?? positionals[0] ?? '',
          scope: str(flags, 'scope'),
        },
        deps
      );
    case 'sync-spool':
      return runSyncSpool(deps);
    default:
      process.stderr.write(USAGE);
      return 0;
  }
}

/** Flush buffered stdout before exiting so piped output (e.g. `recall --json`) is not truncated. */
function exitAfterFlush(code: number): void {
  process.stdout.write('', () => process.exit(code));
}

main()
  .then((code) => exitAfterFlush(code))
  .catch((err: unknown) => {
    // Never block the calling agent — log and exit 0.
    process.stderr.write(`engram error: ${err instanceof Error ? err.message : String(err)}\n`);
    exitAfterFlush(0);
  });
