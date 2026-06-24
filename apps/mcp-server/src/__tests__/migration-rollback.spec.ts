import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_HARD_STOP_FRACTION,
  FileCheckpointBackend,
  LiteJsonStore,
  MigrationStateService,
  VerifierService,
} from '../migration';

const workDirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'engram-mig-roll-'));
  workDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (workDirs.length > 0) {
    const dir = workDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

interface EnterpriseMemory {
  id: string;
  userId: string;
  content: string;
  tags: string[];
  metadata?: Record<string, unknown>;
}

function buildEnterpriseLtmStub(initial: EnterpriseMemory[] = []): {
  rows: Map<string, EnterpriseMemory>;
  create(input: {
    userId: string;
    content: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<EnterpriseMemory>;
  get(userId: string, memoryId: string): Promise<EnterpriseMemory | null>;
  list(userId: string): Promise<{
    items: EnterpriseMemory[];
    totalCount: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  }>;
} {
  const rows = new Map<string, EnterpriseMemory>();
  let counter = 0;
  for (const row of initial) {
    rows.set(`${row.userId}::${row.id}`, row);
    counter += 1;
  }
  return {
    rows,
    async create(input: {
      userId: string;
      content: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
    }): Promise<EnterpriseMemory> {
      await Promise.resolve();
      const id = `ent-${++counter}`;
      const row: EnterpriseMemory = {
        id,
        userId: input.userId,
        content: input.content,
        tags: input.tags ?? [],
        metadata: input.metadata,
      };
      rows.set(`${input.userId}::${id}`, row);
      return { ...row };
    },
    async get(
      userId: string,
      memoryId: string,
    ): Promise<EnterpriseMemory | null> {
      await Promise.resolve();
      return rows.get(`${userId}::${memoryId}`) ?? null;
    },
    async list(userId: string): Promise<{
      items: EnterpriseMemory[];
      totalCount: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    }> {
      await Promise.resolve();
      const items: EnterpriseMemory[] = [];
      for (const row of rows.values()) {
        if (row.userId === userId) items.push(row);
      }
      return {
        items,
        totalCount: items.length,
        hasNextPage: false,
        hasPreviousPage: false,
      };
    },
  };
}

describe('Migration rollback on verifier failure', () => {
  it('transitions to rollback and the lite source remains readable', async () => {
    const dataDir = freshDir();
    const liteStore = new LiteJsonStore(dataDir);
    const state = new MigrationStateService();
    state.setBackend(new FileCheckpointBackend(dataDir));

    // Source has 3 records; enterprise only has 2. The verifier
    // should hard-stop and the state should move to rollback.
    await liteStore.create({
      userId: 'alice',
      content: 'a-1',
      type: 'long-term',
    });
    await liteStore.create({
      userId: 'alice',
      content: 'a-2',
      type: 'long-term',
    });
    await liteStore.create({
      userId: 'alice',
      content: 'a-3',
      type: 'long-term',
    });

    const enterprise = buildEnterpriseLtmStub([
      { id: 'ent-1', userId: 'alice', content: 'a-1', tags: [] },
      { id: 'ent-2', userId: 'alice', content: 'a-2', tags: [] },
    ]);

    await state.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
      totalItems: 3,
    });
    await state.checkpointMigration('copying', { cursor: null, progress: 0 });

    const verifier = new VerifierService(
      liteStore,
      state,
      enterprise as unknown as ConstructorParameters<typeof VerifierService>[2],
    );

    const report = await verifier.verify({});
    expect(report.passed).toBe(false);
    expect(report.globalHashMismatchCount).toBeGreaterThan(0);
    expect(report.abortReason).toMatch(/integrity/);
    expect((await state.currentState()) ?? null).toBe('rollback');

    // Lite source is still readable after the rollback transition.
    const recovered = await liteStore.list('alice', {
      limit: 100,
      includeShortTerm: true,
    });
    expect(recovered.items.length).toBe(3);

    // Aborting a checkpoint already in rollback is idempotent.
    const second = await state.abortMigration();
    expect(second.state).toBe('rollback');
  });

  it('refuses to advance when the hard-stop fraction is exceeded', async () => {
    const dataDir = freshDir();
    const liteStore = new LiteJsonStore(dataDir);
    const state = new MigrationStateService();
    state.setBackend(new FileCheckpointBackend(dataDir));

    // Same content but mismatched metadata triggers hash mismatch.
    await liteStore.create({
      userId: 'bob',
      content: 'hello',
      type: 'long-term',
      metadata: { tag: 'a' },
    });
    const enterprise = buildEnterpriseLtmStub([
      {
        id: 'ent-1',
        userId: 'bob',
        content: 'hello',
        tags: [],
        metadata: { tag: 'b' },
      },
    ]);

    await state.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
      totalItems: 1,
    });
    await state.checkpointMigration('copying', { cursor: null, progress: 0 });

    const verifier = new VerifierService(
      liteStore,
      state,
      enterprise as unknown as ConstructorParameters<typeof VerifierService>[2],
    );

    const report = await verifier.verify({
      hardStopFraction: DEFAULT_HARD_STOP_FRACTION,
    });
    expect(report.passed).toBe(false);
    expect((await state.currentState()) ?? null).toBe('rollback');
  });

  it('passes cleanly when source and target agree', async () => {
    const dataDir = freshDir();
    const liteStore = new LiteJsonStore(dataDir);
    const state = new MigrationStateService();
    state.setBackend(new FileCheckpointBackend(dataDir));

    const created = await liteStore.create({
      userId: 'carol',
      content: 'shared',
      type: 'long-term',
      metadata: { k: 'v' },
    });
    const enterprise = buildEnterpriseLtmStub([
      {
        id: 'ent-1',
        userId: 'carol',
        content: 'shared',
        tags: [],
        metadata: { k: 'v', _liteId: created.id },
      },
    ]);

    await state.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
      totalItems: 1,
    });
    await state.checkpointMigration('copying', { cursor: null, progress: 0 });

    const verifier = new VerifierService(
      liteStore,
      state,
      enterprise as unknown as ConstructorParameters<typeof VerifierService>[2],
    );
    const report = await verifier.verify({});
    expect(report.passed).toBe(true);
    expect((await state.currentState()) ?? null).toBe('cutting_over');
  });

  it('refuses to run the verifier before the migration is seeded', async () => {
    const dataDir = freshDir();
    const liteStore = new LiteJsonStore(dataDir);
    const state = new MigrationStateService();
    state.setBackend(new FileCheckpointBackend(dataDir));
    const enterprise = buildEnterpriseLtmStub();
    const verifier = new VerifierService(
      liteStore,
      state,
      enterprise as unknown as ConstructorParameters<typeof VerifierService>[2],
    );
    await expect(verifier.verify({})).rejects.toThrow(
      /no migration checkpoint/,
    );
  });
});
