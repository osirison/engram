import { PostgresCheckpointBackend } from './postgres-checkpoint.backend';
import type { MigrationCheckpoint } from './migration.types';

function makeCheckpoint(
  overrides: Partial<MigrationCheckpoint> = {},
): MigrationCheckpoint {
  return {
    id: 'test-migration',
    sourceProfile: 'lite',
    targetProfile: 'enterprise',
    state: 'preparing',
    cursor: null,
    progress: 0,
    totalItems: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    sourceManifestHash: null,
    history: [],
    ...overrides,
  };
}

function makeRow(cp: MigrationCheckpoint): Record<string, unknown> {
  return {
    id: cp.id,
    sourceProfile: cp.sourceProfile,
    targetProfile: cp.targetProfile,
    state: cp.state,
    cursor: cp.cursor,
    progress: cp.progress,
    totalItems: cp.totalItems,
    startedAt: new Date(cp.startedAt),
    updatedAt: new Date(cp.updatedAt),
    completedAt: cp.completedAt ? new Date(cp.completedAt) : null,
    sourceManifestHash: cp.sourceManifestHash,
    history: cp.history,
  };
}

describe('PostgresCheckpointBackend', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let backend: PostgresCheckpointBackend;

  beforeEach(() => {
    tx = {
      migrationCheckpoint: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    prisma = {
      // Simulate Prisma's $transaction by invoking the callback with tx.
      $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
      migrationCheckpoint: {
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    backend = new PostgresCheckpointBackend(prisma);
  });

  describe('save()', () => {
    it('creates a new record when none exists', async () => {
      tx.migrationCheckpoint.findUnique.mockResolvedValue(null);
      await backend.save(makeCheckpoint());
      expect(tx.migrationCheckpoint.create).toHaveBeenCalledTimes(1);
      expect(tx.migrationCheckpoint.update).not.toHaveBeenCalled();
    });

    it('sets completedAt to a Date in create when provided', async () => {
      tx.migrationCheckpoint.findUnique.mockResolvedValue(null);
      await backend.save(
        makeCheckpoint({ completedAt: '2026-06-01T00:00:00.000Z' }),
      );
      const { data } = tx.migrationCheckpoint.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.completedAt).toBeInstanceOf(Date);
    });

    it('sets completedAt to null in create when not provided', async () => {
      tx.migrationCheckpoint.findUnique.mockResolvedValue(null);
      await backend.save(makeCheckpoint({ completedAt: null }));
      const { data } = tx.migrationCheckpoint.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.completedAt).toBeNull();
    });

    it('updates an existing record when state can advance forward', async () => {
      tx.migrationCheckpoint.findUnique.mockResolvedValue(
        makeRow(makeCheckpoint({ state: 'preparing' })),
      );
      await backend.save(makeCheckpoint({ state: 'copying' }));
      expect(tx.migrationCheckpoint.update).toHaveBeenCalledTimes(1);
      expect(tx.migrationCheckpoint.create).not.toHaveBeenCalled();
    });

    it('allows a self-transition (same state)', async () => {
      tx.migrationCheckpoint.findUnique.mockResolvedValue(
        makeRow(makeCheckpoint({ state: 'copying' })),
      );
      await backend.save(makeCheckpoint({ state: 'copying', progress: 42 }));
      expect(tx.migrationCheckpoint.update).toHaveBeenCalledTimes(1);
    });

    it('sets completedAt to a Date in update when provided', async () => {
      tx.migrationCheckpoint.findUnique.mockResolvedValue(
        makeRow(makeCheckpoint({ state: 'cutting_over' })),
      );
      await backend.save(
        makeCheckpoint({
          state: 'complete',
          completedAt: '2026-06-01T12:00:00.000Z',
        }),
      );
      const { data } = tx.migrationCheckpoint.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.completedAt).toBeInstanceOf(Date);
    });

    it('sets completedAt to null in update when not provided', async () => {
      tx.migrationCheckpoint.findUnique.mockResolvedValue(
        makeRow(makeCheckpoint({ state: 'preparing' })),
      );
      await backend.save(
        makeCheckpoint({ state: 'copying', completedAt: null }),
      );
      const { data } = tx.migrationCheckpoint.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.completedAt).toBeNull();
    });

    it('throws when state would regress', async () => {
      tx.migrationCheckpoint.findUnique.mockResolvedValue(
        makeRow(makeCheckpoint({ state: 'copying' })),
      );
      await expect(
        backend.save(makeCheckpoint({ state: 'preparing' })),
      ).rejects.toThrow(/refused to regress/);
      expect(tx.migrationCheckpoint.update).not.toHaveBeenCalled();
    });

    it('throws when existing state is terminal (complete)', async () => {
      tx.migrationCheckpoint.findUnique.mockResolvedValue(
        makeRow(makeCheckpoint({ state: 'complete' })),
      );
      await expect(
        backend.save(makeCheckpoint({ state: 'rollback' })),
      ).rejects.toThrow(/refused to regress/);
    });

    it('throws when existing state is terminal (rollback)', async () => {
      tx.migrationCheckpoint.findUnique.mockResolvedValue(
        makeRow(makeCheckpoint({ state: 'rollback' })),
      );
      await expect(
        backend.save(makeCheckpoint({ state: 'copying' })),
      ).rejects.toThrow(/refused to regress/);
    });

    it('allows rollback from a non-terminal state', async () => {
      tx.migrationCheckpoint.findUnique.mockResolvedValue(
        makeRow(makeCheckpoint({ state: 'copying' })),
      );
      await backend.save(makeCheckpoint({ state: 'rollback' }));
      expect(tx.migrationCheckpoint.update).toHaveBeenCalledTimes(1);
    });

    it('throws when existing row has an unknown state', async () => {
      const row = makeRow(makeCheckpoint({ state: 'preparing' }));
      row.state = 'legacy_unknown';
      tx.migrationCheckpoint.findUnique.mockResolvedValue(row);
      await expect(
        backend.save(makeCheckpoint({ state: 'copying' })),
      ).rejects.toThrow(/refused to regress/);
    });

    it('uses Serializable isolation', async () => {
      tx.migrationCheckpoint.findUnique.mockResolvedValue(null);
      await backend.save(makeCheckpoint());
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
    });
  });

  describe('load()', () => {
    it('returns null when the row does not exist', async () => {
      prisma.migrationCheckpoint.findUnique.mockResolvedValue(null);
      await expect(backend.load('does-not-exist')).resolves.toBeNull();
    });

    it('returns a parsed checkpoint when the row exists', async () => {
      const cp = makeCheckpoint({
        state: 'copying',
        cursor: 'mem-42',
        progress: 5,
      });
      prisma.migrationCheckpoint.findUnique.mockResolvedValue(makeRow(cp));
      const result = await backend.load(cp.id);
      expect(result).toMatchObject({
        state: 'copying',
        cursor: 'mem-42',
        progress: 5,
      });
    });

    it('returns null completedAt when row has no completedAt', async () => {
      prisma.migrationCheckpoint.findUnique.mockResolvedValue(
        makeRow(makeCheckpoint()),
      );
      const result = await backend.load('test-migration');
      expect(result?.completedAt).toBeNull();
    });

    it('converts completedAt Date to ISO string', async () => {
      const cp = makeCheckpoint({
        state: 'complete',
        completedAt: '2026-06-01T12:00:00.000Z',
      });
      prisma.migrationCheckpoint.findUnique.mockResolvedValue(makeRow(cp));
      const result = await backend.load(cp.id);
      expect(result?.completedAt).toBe('2026-06-01T12:00:00.000Z');
    });

    it('normalises non-array history to []', async () => {
      const row = { ...makeRow(makeCheckpoint()), history: null };
      prisma.migrationCheckpoint.findUnique.mockResolvedValue(row);
      const result = await backend.load('test-migration');
      expect(result?.history).toEqual([]);
    });
  });

  describe('clear()', () => {
    it('resolves when delete succeeds', async () => {
      prisma.migrationCheckpoint.delete.mockResolvedValue({});
      await expect(backend.clear('test-migration')).resolves.toBeUndefined();
    });

    it('swallows P2025 (record not found) and resolves', async () => {
      prisma.migrationCheckpoint.delete.mockRejectedValue({ code: 'P2025' });
      await expect(backend.clear('does-not-exist')).resolves.toBeUndefined();
    });

    it('re-throws non-P2025 errors', async () => {
      const err = new Error('connection lost');
      prisma.migrationCheckpoint.delete.mockRejectedValue(err);
      await expect(backend.clear('test-migration')).rejects.toThrow(
        'connection lost',
      );
    });
  });
});
