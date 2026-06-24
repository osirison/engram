import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  migrationCheckpointSchema,
  type MigrationCheckpoint,
} from './migration.types';
import type { MigrationCheckpointBackend } from './migration.backend.interface';

/**
 * File-backed implementation of {@link MigrationCheckpointBackend}.
 *
 * Layout: `<rootDir>/state/<id>.json`.
 *
 * The directory and every file are written with the same owner-only modes
 * used by `@engram/memory-lite` so the profile-lite security posture is
 * preserved for migration state. Writes are atomic (write to `*.tmp`
 * then rename) to guarantee the checkpoint never reflects a partial
 * update on disk.
 *
 * Used by both profile-lite (where the data directory is already
 * encrypted at rest) and tests (where an ephemeral temp dir is supplied).
 */
export class FileCheckpointBackend implements MigrationCheckpointBackend {
  constructor(private readonly rootDir: string) {
    if (!rootDir) {
      throw new Error('FileCheckpointBackend requires a rootDir.');
    }
  }

  private async ensureRoot(): Promise<string> {
    const dir = path.join(this.rootDir, 'state');
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700);
    }
    return dir;
  }

  private pathFor(id: string): string {
    const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.rootDir, 'state', `${safe}.json`);
  }

  async load(id: string): Promise<MigrationCheckpoint | null> {
    await this.ensureRoot();
    const target = this.pathFor(id);
    if (!existsSync(target)) return null;
    const raw = await readFile(target, 'utf8');
    try {
      return migrationCheckpointSchema.parse(JSON.parse(raw));
    } catch (error) {
      throw new Error(
        `Failed to parse migration checkpoint at ${target}: ${(error as Error).message}`,
      );
    }
  }

  async save(checkpoint: MigrationCheckpoint): Promise<void> {
    await this.ensureRoot();
    const target = this.pathFor(checkpoint.id);
    const tmp = `${target}.${randomUUID()}.tmp`;
    const json = JSON.stringify(checkpoint);
    await writeFile(tmp, json, { encoding: 'utf8', mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, target);
    await chmod(target, 0o600);
  }

  async clear(id: string): Promise<void> {
    await this.ensureRoot();
    const target = this.pathFor(id);
    if (existsSync(target)) {
      await rm(target, { force: true });
    }
  }
}
