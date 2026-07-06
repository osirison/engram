import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import type { RememberInput } from '@engram/client';
import type { SpoolEntry } from './types.js';

/**
 * Local durable queue for writes that could not reach the server. Every command
 * is non-blocking (D5): on server-unreachable it appends here and exits 0; a
 * later `engram sync-spool` replays entries idempotently.
 */
export class SpoolStore {
  constructor(private readonly path: string) {}

  /**
   * Deterministic idempotency key for a payload — sha256 over the tenant, tier,
   * scope, and content. Used to de-duplicate local spool appends; server-side
   * dedup independently covers content-level duplicates on replay.
   */
  makeKey(payload: RememberInput): string {
    const material = JSON.stringify([
      payload.userId,
      payload.type ?? 'auto',
      payload.scope ?? '',
      payload.content,
    ]);
    return createHash('sha256').update(material).digest('hex').slice(0, 32);
  }

  /** Append one entry, creating the spool directory on first use. Never throws on a well-formed entry. */
  append(entry: SpoolEntry): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  private get tempPath(): string {
    return `${this.path}.draining`;
  }

  private readFile(file: string): SpoolEntry[] {
    if (!existsSync(file)) return [];
    const raw = readFileSync(file, 'utf8');
    const entries: SpoolEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const parsed = JSON.parse(trimmed) as SpoolEntry;
        if (parsed && parsed.tool === 'remember' && parsed.payload) entries.push(parsed);
      } catch {
        // Skip a corrupt line rather than lose the whole spool.
      }
    }
    return entries;
  }

  /** Read all entries, tolerating (and skipping) corrupt lines. Returns [] when the spool is absent. */
  readAll(): SpoolEntry[] {
    return this.readFile(this.path);
  }

  /**
   * Atomically claim the current spool contents for a drain: move the live spool
   * aside so concurrent `append()`s land in a fresh file and are never clobbered
   * by the drain's rewrite. Also recovers a temp left by a crashed prior drain.
   * Call `commitDrain(survivors)` after replay.
   */
  takeSnapshot(): SpoolEntry[] {
    const entries = this.readFile(this.tempPath); // recover a crashed prior drain
    if (existsSync(this.path)) {
      renameSync(this.path, this.tempPath); // overwrite the already-read temp
      entries.push(...this.readFile(this.tempPath));
    }
    return entries;
  }

  /** Finish a drain: drop the snapshot temp and re-queue any survivors onto the live spool. */
  commitDrain(survivors: readonly SpoolEntry[]): void {
    if (existsSync(this.tempPath)) rmSync(this.tempPath);
    for (const survivor of survivors) this.append(survivor);
  }

  /** Overwrite the spool with the given entries; removes the file entirely when empty. */
  replaceAll(entries: readonly SpoolEntry[]): void {
    if (entries.length === 0) {
      if (existsSync(this.path)) rmSync(this.path);
      return;
    }
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  }
}
