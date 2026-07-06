/**
 * File-watcher sync daemon (WP5 T11).
 *
 * Watches native agent-memory files under one or more roots and syncs changes
 * into ENGRAM using the WP4 importer, honoring the D7 newest-wins conflict rule
 * (never clobbers a memory edited more recently inside ENGRAM). Runs as a
 * long-lived systemd user service alongside the MCP server.
 *
 * Usage (from repo root):
 *   pnpm --filter mcp-server watch -- [<root> ...] --user <id> [--scope <s>]
 *                                     [--debounce <ms>] [--force] [--no-embed] [--once]
 */
import { watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '@engram/database';
import {
  ImportLedgerService,
  MemoryImportService,
} from '@engram/memory-import';

import { AppModule } from './app.module';
import { Debouncer } from './sync/debounce';
import { deriveImportRoot, mapFileToSource } from './sync/path-mapping';
import { MemorySyncService, type SyncSpec } from './sync/memory-sync.service';

export interface WatchArgs {
  roots: string[];
  userId?: string;
  scope?: string;
  debounceMs?: number;
  force?: boolean;
  embed?: boolean;
  /** Run one sync pass over each root then exit (for verification/cron use). */
  once?: boolean;
}

export function parseWatchArgs(argv: readonly string[]): WatchArgs {
  const args: WatchArgs = { roots: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case '--user':
        args.userId = argv[(i += 1)];
        break;
      case '--scope':
        args.scope = argv[(i += 1)];
        break;
      case '--debounce': {
        const value = Number.parseInt(argv[(i += 1)] ?? '', 10);
        if (Number.isFinite(value) && value >= 0) args.debounceMs = value;
        break;
      }
      case '--force':
        args.force = true;
        break;
      case '--no-embed':
        args.embed = false;
        break;
      case '--once':
        args.once = true;
        break;
      default:
        if (flag && !flag.startsWith('--')) args.roots.push(flag);
        break;
    }
  }
  return args;
}

const KEY_SEP = ' ';

/**
 * Encode a (root, source) pair into a debouncer key. `source` is a space-free
 * enum appended last, so decoding splits on the LAST separator — a root may
 * therefore contain spaces without corrupting either field.
 */
export function encodeWatchKey(root: string, source: string): string {
  return `${root}${KEY_SEP}${source}`;
}

export function decodeWatchKey(key: string): { root: string; source: string } {
  const sep = key.lastIndexOf(KEY_SEP);
  return { root: key.slice(0, sep), source: key.slice(sep + 1) };
}

async function main(): Promise<void> {
  const logger = new Logger('WatchCli');
  const args = parseWatchArgs(process.argv.slice(2));

  if (!args.userId) {
    logger.error('Missing required --user <id>');
    process.exitCode = 1;
    return;
  }
  const roots =
    args.roots.length > 0 ? args.roots.map((r) => resolve(r)) : [process.cwd()];
  const userId = args.userId;
  const debounceMs = args.debounceMs ?? 1000;

  const app = await NestFactory.createApplicationContext(AppModule.forRoot(), {
    bufferLogs: false,
  });
  const sync = new MemorySyncService(
    app.get(MemoryImportService),
    app.get(ImportLedgerService),
    app.get(PrismaService),
  );

  const runSync = (spec: SyncSpec): void => {
    void sync
      .syncSource(spec, { force: args.force, embed: args.embed })
      .then((result) => {
        if (result.skipped)
          logger.warn(
            `skipped ${result.source} (${result.conflicts.length} conflict(s))`,
          );
      })
      .catch((err: unknown) => {
        logger.error(
          `sync failed for ${spec.source}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  };

  // --once: one import pass per (root, source) for known files, then exit.
  if (args.once) {
    const sources: SyncSpec['source'][] = [
      'claude-code',
      'codex',
      'gemini',
      'cursor',
      'copilot',
    ];
    for (const root of roots) {
      for (const source of sources) {
        await sync
          .syncSource(
            { source, root, userId, scope: args.scope },
            { force: args.force, embed: args.embed },
          )
          .catch((err: unknown) =>
            logger.error(
              `sync failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
      }
    }
    await app.close();
    return;
  }

  const debouncer = new Debouncer<string>(debounceMs, (key) => {
    const { root, source } = decodeWatchKey(key);
    runSync({
      source: source as SyncSpec['source'],
      root,
      userId,
      scope: args.scope,
    });
  });

  // Recursive watching (needed for nested .github/instructions, .cursor/rules,
  // .claude/**/memory) requires Node >= 20 on Linux. Guard so an unsupported
  // platform gives a clear message instead of a raw crash.
  const watchers: FSWatcher[] = [];
  for (const root of roots) {
    try {
      watchers.push(
        watch(root, { recursive: true }, (_event, filename) => {
          if (!filename) return;
          const abs = resolve(root, filename.toString());
          const source = mapFileToSource(abs);
          if (!source) return;
          // Import from the dir the adapter expects (may differ from the watch root).
          const importRoot = deriveImportRoot(abs) ?? root;
          debouncer.trigger(encodeWatchKey(importRoot, source));
        }),
      );
    } catch (err) {
      if (
        (err as NodeJS.ErrnoException).code ===
        'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM'
      ) {
        logger.error(
          `recursive file watching requires Node >=20; cannot watch ${root}`,
        );
      } else {
        throw err;
      }
    }
  }
  if (watchers.length === 0) {
    logger.error('no roots could be watched — exiting');
    await app.close();
    process.exitCode = 1;
    return;
  }
  logger.log(
    `watching ${roots.join(', ')} for user ${userId} (debounce ${debounceMs}ms)`,
  );

  const shutdown = async (): Promise<void> => {
    for (const w of watchers) w.close();
    debouncer.clearAll();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

// Only auto-run when invoked as the CLI entrypoint (not when imported by a spec).
if (process.argv[1] && /watch\.cli\./.test(process.argv[1])) {
  void main().catch((err: unknown) => {
    console.error('watch daemon failed:', err);
    process.exit(1);
  });
}
