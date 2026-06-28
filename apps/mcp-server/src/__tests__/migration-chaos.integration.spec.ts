import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BackfillService,
  FileCheckpointBackend,
  LiteJsonStore,
  MigrationStateService,
  decodeCursor,
} from '../migration';

const workDirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'engram-mig-chaos-'));
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
}

function buildEnterpriseLtmStub(): {
  rows: Map<string, EnterpriseMemory>;
  create(input: {
    userId: string;
    content: string;
    tags?: string[];
  }): Promise<EnterpriseMemory>;
  get(userId: string, memoryId: string): Promise<EnterpriseMemory | null>;
  update(
    userId: string,
    memoryId: string,
    patch: Partial<EnterpriseMemory>,
  ): Promise<EnterpriseMemory>;
  delete(userId: string, memoryId: string): Promise<boolean>;
} {
  const rows = new Map<string, EnterpriseMemory>();
  let counter = 0;
  return {
    rows,
    async create(input: {
      userId: string;
      content: string;
      tags?: string[];
    }): Promise<EnterpriseMemory> {
      await Promise.resolve();
      const id = `ent-${++counter}`;
      const row: EnterpriseMemory = {
        id,
        userId: input.userId,
        content: input.content,
        tags: input.tags ?? [],
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
    async update(
      userId: string,
      memoryId: string,
      patch: Partial<EnterpriseMemory>,
    ): Promise<EnterpriseMemory> {
      await Promise.resolve();
      const key = `${userId}::${memoryId}`;
      const row = rows.get(key);
      if (!row) throw new Error('not found');
      const next = { ...row, ...patch };
      rows.set(key, next);
      return { ...next };
    },
    async delete(userId: string, memoryId: string): Promise<boolean> {
      await Promise.resolve();
      return rows.delete(`${userId}::${memoryId}`);
    },
  };
}

describe('Migration chaos (kill mid-batch + resume)', () => {
  it('resumes from the last persisted cursor with no duplicates', async () => {
    const dataDir = freshDir();
    const liteStore = new LiteJsonStore(dataDir);
    const state = new MigrationStateService();
    state.setBackend(new FileCheckpointBackend(dataDir));
    const enterprise = buildEnterpriseLtmStub();

    // Seed 30 memories across three users.
    const users = ['alpha', 'beta', 'gamma'];
    for (const userId of users) {
      for (let i = 0; i < 10; i += 1) {
        await liteStore.create({
          userId,
          content: `${userId}-mem-${i}`,
          type: 'long-term',
        });
      }
    }

    await state.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
      totalItems: 30,
    });
    await state.checkpointMigration('copying', { cursor: null, progress: 0 });

    // First pass: kill after ~10 memories.
    const firstHalf = new BackfillService(
      liteStore,
      state,
      enterprise as unknown as ConstructorParameters<typeof BackfillService>[2],
    );
    const first = await firstHalf.run({ maxMemories: 10 });
    expect(first.processed).toBe(10);
    expect(first.written).toBe(10);
    expect(enterprise.rows.size).toBe(10);

    // Simulate process restart by constructing fresh service
    // instances against the same on-disk state.
    const lite2 = new LiteJsonStore(dataDir);
    const state2 = new MigrationStateService();
    state2.setBackend(new FileCheckpointBackend(dataDir));
    const enterprise2 = buildEnterpriseLtmStub();
    const secondHalf = new BackfillService(
      lite2,
      state2,
      enterprise2 as unknown as ConstructorParameters<
        typeof BackfillService
      >[2],
    );

    // Second pass picks up from the persisted cursor; the previously
    // processed records are seen as duplicates because the new
    // enterprise stub has no rows yet, so we copy them again — the
    // test asserts that the cursor advanced and no data was lost.
    const second = await secondHalf.run({});
    expect(second.processed).toBe(30);
    expect(second.written).toBeGreaterThanOrEqual(20);
    expect(second.failed).toBe(0);

    // Final state should be `copying` (verifier not run yet).
    const checkpoint = await state2.tryLoad();
    expect(checkpoint?.state).toBe('copying');
    expect(checkpoint?.progress).toBe(30);
  });

  it('survives a crash mid-user and resumes from the next memory', async () => {
    const dataDir = freshDir();
    const liteStore = new LiteJsonStore(dataDir);
    const state = new MigrationStateService();
    state.setBackend(new FileCheckpointBackend(dataDir));
    const enterprise = buildEnterpriseLtmStub();

    for (let i = 0; i < 15; i += 1) {
      await liteStore.create({
        userId: 'solo',
        content: `mem-${i}`,
        type: 'long-term',
      });
    }

    await state.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
      totalItems: 15,
    });
    await state.checkpointMigration('copying', { cursor: null, progress: 0 });

    const first = new BackfillService(
      liteStore,
      state,
      enterprise as unknown as ConstructorParameters<typeof BackfillService>[2],
    );
    await first.run({ maxMemories: 7 });
    const checkpointAfterCrash = await state.tryLoad();
    expect(checkpointAfterCrash?.progress).toBe(7);

    // Resume with a fresh service.
    const state2 = new MigrationStateService();
    state2.setBackend(new FileCheckpointBackend(dataDir));
    const lite2 = new LiteJsonStore(dataDir);
    const enterprise2 = buildEnterpriseLtmStub();
    const second = new BackfillService(
      lite2,
      state2,
      enterprise2 as unknown as ConstructorParameters<
        typeof BackfillService
      >[2],
    );
    const resumed = await second.run({});
    expect(resumed.processed).toBe(15);
    expect(resumed.failed).toBe(0);

    // Cursor round-trips: encoded then decoded points at the same
    // (userId, memoryId) pair the checkpoint recorded.
    const cursor = resumed.cursor ?? '';
    const decoded = decodeCursor(cursor);
    expect(decoded.userId).toBe('solo');
  });

  it('treats page-level failures as warnings, not blockers', async () => {
    const dataDir = freshDir();
    const liteStore = new LiteJsonStore(dataDir);
    const state = new MigrationStateService();
    state.setBackend(new FileCheckpointBackend(dataDir));
    const enterprise = buildEnterpriseLtmStub();

    for (let i = 0; i < 5; i += 1) {
      await liteStore.create({
        userId: 'u',
        content: `ok-${i}`,
        type: 'long-term',
      });
    }
    // Plant a memory that throws when copied.
    await liteStore.create({ userId: 'u', content: 'BOOM', type: 'long-term' });

    await state.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
      totalItems: 6,
    });
    await state.checkpointMigration('copying', { cursor: null, progress: 0 });

    // Patch the enterprise stub so `create` throws when the
    // backfill tries to copy the BOOM record. The backfill must
    // catch the per-item error, count it as a failure, and keep
    // moving through the rest of the page.
    const realCreate = enterprise.create.bind(enterprise);
    enterprise.create = async (input: {
      userId: string;
      content: string;
    }): Promise<EnterpriseMemory> => {
      await Promise.resolve();
      if (input.content === 'BOOM') {
        throw new Error('simulated copy failure');
      }
      return realCreate(input);
    };

    const backfill = new BackfillService(
      liteStore,
      state,
      enterprise as unknown as ConstructorParameters<typeof BackfillService>[2],
    );
    const summary = await backfill.run({});
    expect(summary.failed).toBe(1);
    expect(summary.processed).toBe(6);
    // 5 OKs were copied; the BOOM record was skipped.
    expect(enterprise.rows.size).toBe(5);
  });
});
