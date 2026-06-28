import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  FileCheckpointBackend,
  MigrationStateService,
  DEFAULT_MIGRATION_ID,
  MigrationCheckpointNotFoundError,
  InvalidMigrationTransitionError,
  selectCheckpointBackend,
  PostgresCheckpointBackend,
} from '../migration';
import { DeploymentProfile } from '@engram/config';

/**
 * Migration state service tests.
 *
 * Each test allocates a fresh temp directory for the file-backed
 * checkpoint backend so suites can run in parallel without colliding on
 * the default migration id.
 */

const workDirs: string[] = [];

function setupService(): {
  workDir: string;
  backend: FileCheckpointBackend;
  service: MigrationStateService;
} {
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'engram-migration-'));
  workDirs.push(workDir);
  const backend = new FileCheckpointBackend(workDir);
  const service = new MigrationStateService();
  service.setBackend(backend);
  return { workDir, backend, service };
}

afterEach(() => {
  while (workDirs.length > 0) {
    const dir = workDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('FileCheckpointBackend', () => {
  it('clear() deletes an existing checkpoint file', async () => {
    const { backend } = setupService();
    const checkpoint = {
      id: DEFAULT_MIGRATION_ID,
      sourceProfile: 'lite' as const,
      targetProfile: 'enterprise' as const,
      state: 'preparing' as const,
      cursor: null,
      progress: 0,
      totalItems: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      sourceManifestHash: null,
      history: [],
    };
    await backend.save(checkpoint);
    await backend.clear(DEFAULT_MIGRATION_ID);
    await expect(backend.load(DEFAULT_MIGRATION_ID)).resolves.toBeNull();
  });

  it('clear() is a no-op when no checkpoint file exists', async () => {
    const { backend } = setupService();
    await expect(backend.clear('nonexistent-id')).resolves.toBeUndefined();
  });

  it('round-trips a checkpoint', async () => {
    const { backend } = setupService();
    const checkpoint = {
      id: DEFAULT_MIGRATION_ID,
      sourceProfile: 'lite' as const,
      targetProfile: 'enterprise' as const,
      state: 'preparing' as const,
      cursor: 'mem-1',
      progress: 10,
      totalItems: 100,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      sourceManifestHash: null,
      history: [
        {
          at: new Date().toISOString(),
          from: 'idle' as const,
          to: 'preparing' as const,
          note: 'seed',
        },
      ],
    };
    await backend.save(checkpoint);
    const loaded = await backend.load(DEFAULT_MIGRATION_ID);
    expect(loaded).toEqual(checkpoint);
  });

  it('returns null for an unknown id', async () => {
    const { backend } = setupService();
    const result = await backend.load('does-not-exist');
    expect(result).toBeNull();
  });

  it('rejects malformed JSON on load', async () => {
    const { backend } = setupService();
    const rootDir = (backend as unknown as { rootDir: string }).rootDir;
    const dir = path.join(rootDir, 'state');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${DEFAULT_MIGRATION_ID}.json`), '{not-json');
    await expect(backend.load(DEFAULT_MIGRATION_ID)).rejects.toThrow(/parse/);
  });
});

describe('MigrationStateService.checkpointMigration', () => {
  it('seeds a new checkpoint from idle when none exists', async () => {
    const { service } = setupService();
    const checkpoint = await service.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
    });
    expect(checkpoint.state).toBe('preparing');
    expect(checkpoint.history).toHaveLength(1);
    expect(checkpoint.history[0]).toMatchObject({
      from: 'idle',
      to: 'preparing',
    });
  });

  it('records the cursor and progress on subsequent calls', async () => {
    const { service } = setupService();
    await service.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
    });
    const next = await service.checkpointMigration('copying', {
      cursor: 'mem-100',
      progress: 100,
      totalItems: 500,
    });
    expect(next.state).toBe('copying');
    expect(next.cursor).toBe('mem-100');
    expect(next.progress).toBe(100);
    expect(next.totalItems).toBe(500);
    expect(next.history).toHaveLength(2);
    expect(next.history[1]).toMatchObject({ from: 'preparing', to: 'copying' });
  });

  it('refuses an invalid transition', async () => {
    const { service } = setupService();
    await service.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
    });
    await expect(
      service.checkpointMigration('complete', { cursor: null, progress: 0 }),
    ).rejects.toBeInstanceOf(InvalidMigrationTransitionError);
  });
});

describe('MigrationStateService.resumeMigration', () => {
  it('returns the latest checkpoint for an id', async () => {
    const { service } = setupService();
    await service.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
    });
    await service.checkpointMigration('copying', {
      cursor: 'mem-50',
      progress: 50,
    });
    const resumed = await service.resumeMigration();
    expect(resumed.state).toBe('copying');
    expect(resumed.cursor).toBe('mem-50');
  });

  it('throws when no checkpoint exists', async () => {
    const { service } = setupService();
    await expect(service.resumeMigration()).rejects.toBeInstanceOf(
      MigrationCheckpointNotFoundError,
    );
  });
});

describe('MigrationStateService.completeMigration', () => {
  it('transitions through cutting_over to complete', async () => {
    const { service } = setupService();
    await service.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
    });
    await service.checkpointMigration('copying', { cursor: 'a', progress: 1 });
    await service.checkpointMigration('verifying', {
      cursor: 'a',
      progress: 1,
    });
    await service.checkpointMigration('cutting_over', {
      cursor: null,
      progress: 1,
    });
    const final = await service.completeMigration();
    expect(final.state).toBe('complete');
    expect(final.completedAt).not.toBeNull();
  });

  it('is idempotent when already complete', async () => {
    const { service } = setupService();
    await service.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
    });
    await service.checkpointMigration('copying', { cursor: 'a', progress: 1 });
    await service.checkpointMigration('verifying', {
      cursor: 'a',
      progress: 1,
    });
    await service.checkpointMigration('cutting_over', {
      cursor: null,
      progress: 1,
    });
    const a = await service.completeMigration();
    const b = await service.completeMigration();
    expect(b).toEqual(a);
  });
});

describe('MigrationStateService.abortMigration', () => {
  it('rolls back from any non-terminal state', async () => {
    const { service } = setupService();
    await service.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
    });
    await service.checkpointMigration('copying', { cursor: 'a', progress: 1 });
    const aborted = await service.abortMigration(undefined, 'operator abort');
    expect(aborted.state).toBe('rollback');
    expect(aborted.history.at(-1)?.note).toBe('operator abort');
  });

  it('refuses to abort a completed migration', async () => {
    const { service } = setupService();
    await service.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
    });
    await service.checkpointMigration('copying', { cursor: 'a', progress: 1 });
    await service.checkpointMigration('verifying', {
      cursor: 'a',
      progress: 1,
    });
    await service.checkpointMigration('cutting_over', {
      cursor: null,
      progress: 1,
    });
    await service.completeMigration();
    await expect(service.abortMigration()).rejects.toThrow(/completed/);
  });

  it('is idempotent when already rolled back', async () => {
    const { service } = setupService();
    await service.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
    });
    await service.abortMigration(undefined, 'first');
    const second = await service.abortMigration(undefined, 'second');
    expect(second.history.at(-1)?.note).toBe('first');
  });
});

describe('MigrationStateService without a backend', () => {
  it('fails fast with a clear error', async () => {
    const bare = new MigrationStateService();
    await expect(
      bare.checkpointMigration('preparing', { cursor: null, progress: 0 }),
    ).rejects.toThrow(/no backend/);
  });
});

describe('selectCheckpointBackend', () => {
  const enterpriseCapabilities = {
    profile: DeploymentProfile.ENTERPRISE,
    requiresDatabase: true,
    requiresRedis: true,
    requiresQdrant: true,
    inProcessAdapters: false,
    persistent: true,
  };

  const liteCapabilities = {
    profile: DeploymentProfile.LITE,
    requiresDatabase: true,
    requiresRedis: false,
    requiresQdrant: false,
    inProcessAdapters: false,
    persistent: true,
  };

  it('returns forceBackend immediately when provided', () => {
    const forced = {} as FileCheckpointBackend;
    expect(selectCheckpointBackend({ forceBackend: forced })).toBe(forced);
  });

  it('returns a PostgresCheckpointBackend for enterprise profile with prisma', () => {
    const prisma = {} as never;
    const result = selectCheckpointBackend({
      capabilities: enterpriseCapabilities,
      prisma,
    });
    expect(result).toBeInstanceOf(PostgresCheckpointBackend);
  });

  it('throws for enterprise profile without prisma', () => {
    expect(() =>
      selectCheckpointBackend({ capabilities: enterpriseCapabilities }),
    ).toThrow(/enterprise profile requires a PrismaService/);
  });

  it('returns a FileCheckpointBackend for lite profile with dataDir', () => {
    const result = selectCheckpointBackend({
      capabilities: liteCapabilities,
      dataDir: '/tmp/test',
    });
    expect(result).toBeInstanceOf(FileCheckpointBackend);
  });

  it('falls back to defaultDataDir when dataDir is absent', () => {
    const result = selectCheckpointBackend({
      capabilities: liteCapabilities,
      defaultDataDir: '/tmp/default',
    });
    expect(result).toBeInstanceOf(FileCheckpointBackend);
  });

  it('throws for non-enterprise profile with no data directory', () => {
    expect(() =>
      selectCheckpointBackend({ capabilities: liteCapabilities }),
    ).toThrow(/requires a dataDir/);
  });
});
