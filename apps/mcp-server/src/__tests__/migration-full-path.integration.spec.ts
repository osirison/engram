import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BackfillService,
  DEFAULT_HARD_STOP_FRACTION,
  DEFAULT_MIGRATION_ID,
  DualWriteCoordinator,
  FileCheckpointBackend,
  LiteJsonStore,
  MigrationStateService,
  VerifierService,
  computeLiteManifestHash,
  encodeCursor,
} from '../migration';

const workDirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'engram-mig-full-'));
  workDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (workDirs.length > 0) {
    const dir = workDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Build a tiny stand-in for `MemoryLtmService` that satisfies the
 * `create`/`update`/`delete`/`get`/`list` slice the migration tooling
 * depends on. Kept in this file so the suite remains self-contained.
 */
interface EnterpriseMemory {
  id: string;
  userId: string;
  organizationId?: string;
  content: string;
  metadata?: Record<string, unknown>;
  tags: string[];
  type: 'long-term';
  createdAt: Date;
  updatedAt: Date;
}

function buildEnterpriseLtmStub(): {
  rows: Map<string, EnterpriseMemory>;
  create(input: {
    userId: string;
    organizationId?: string;
    content: string;
    metadata?: Record<string, unknown>;
    tags?: string[];
  }): Promise<EnterpriseMemory>;
  get(userId: string, memoryId: string): Promise<EnterpriseMemory | null>;
  update(
    userId: string,
    memoryId: string,
    patch: {
      content?: string;
      metadata?: Record<string, unknown>;
      tags?: string[];
    },
  ): Promise<EnterpriseMemory>;
  delete(userId: string, memoryId: string): Promise<boolean>;
  list(userId: string): Promise<{
    items: EnterpriseMemory[];
    totalCount: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  }>;
} {
  // Two indexes: the canonical `userId::enterpriseId` key (used by
  // create/update/delete) and a `userId::liteId` key (used by the
  // verifier, which looks up by `_liteId` metadata so the row's
  // enterprise id is irrelevant). Either path returns the same row.
  const rows = new Map<string, EnterpriseMemory>();
  const liteIndex = new Map<string, string>(); // userId::liteId -> enterpriseId
  let nextId = 0;
  return {
    rows,
    async create(input: {
      userId: string;
      organizationId?: string;
      content: string;
      metadata?: Record<string, unknown>;
      tags?: string[];
    }): Promise<EnterpriseMemory> {
      await Promise.resolve();
      const id = `ent-${++nextId}`;
      const now = new Date();
      const row: EnterpriseMemory = {
        id,
        userId: input.userId,
        organizationId: input.organizationId,
        content: input.content,
        metadata: input.metadata,
        tags: input.tags ?? [],
        type: 'long-term',
        createdAt: now,
        updatedAt: now,
      };
      rows.set(`${input.userId}::${id}`, row);
      const liteId = readLiteIdFromMetadata(input.metadata);
      if (liteId) {
        liteIndex.set(`${input.userId}::${liteId}`, id);
      }
      return row;
    },
    async get(
      userId: string,
      memoryId: string,
    ): Promise<EnterpriseMemory | null> {
      await Promise.resolve();
      // Direct lookup first (canonical enterprise id).
      const direct = rows.get(`${userId}::${memoryId}`);
      if (direct) return direct;
      // Fall back to the `_liteId` index so the verifier can match
      // by source-lite id without knowing the enterprise id.
      const enterpriseId = liteIndex.get(`${userId}::${memoryId}`);
      if (enterpriseId) {
        return rows.get(`${userId}::${enterpriseId}`) ?? null;
      }
      return null;
    },
    async update(
      userId: string,
      memoryId: string,
      patch: {
        content?: string;
        metadata?: Record<string, unknown>;
        tags?: string[];
      },
    ): Promise<EnterpriseMemory> {
      await Promise.resolve();
      // Translate `memoryId` through the lite index if needed.
      const enterpriseId = liteIndex.get(`${userId}::${memoryId}`) ?? memoryId;
      const key = `${userId}::${enterpriseId}`;
      const row = rows.get(key);
      if (!row) {
        throw new Error('not found');
      }
      const next: EnterpriseMemory = {
        ...row,
        content: patch.content ?? row.content,
        metadata: patch.metadata ?? row.metadata,
        tags: patch.tags ?? row.tags,
        updatedAt: new Date(),
      };
      rows.set(key, next);
      return next;
    },
    async delete(userId: string, memoryId: string): Promise<boolean> {
      await Promise.resolve();
      const enterpriseId = liteIndex.get(`${userId}::${memoryId}`) ?? memoryId;
      const removed = rows.delete(`${userId}::${enterpriseId}`);
      liteIndex.delete(`${userId}::${memoryId}`);
      return removed;
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

function readLiteIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)['_liteId'];
  return typeof value === 'string' ? value : null;
}

interface Env {
  dataDir: string;
  liteStore: LiteJsonStore;
  enterprise: ReturnType<typeof buildEnterpriseLtmStub>;
  state: MigrationStateService;
  dual: DualWriteCoordinator;
  backfill: BackfillService;
  verifier: VerifierService;
}

function buildEnv(): Env {
  const dataDir = freshDir();
  const liteStore = new LiteJsonStore(dataDir);
  const state = new MigrationStateService();
  state.setBackend(new FileCheckpointBackend(dataDir));
  const enterprise = buildEnterpriseLtmStub();
  const dual = new DualWriteCoordinator(
    liteStore,
    state,
    enterprise as unknown as ConstructorParameters<
      typeof DualWriteCoordinator
    >[2],
  );
  const backfill = new BackfillService(
    liteStore,
    state,
    enterprise as unknown as ConstructorParameters<typeof BackfillService>[2],
  );
  const verifier = new VerifierService(
    liteStore,
    state,
    enterprise as unknown as ConstructorParameters<typeof VerifierService>[2],
  );
  return { dataDir, liteStore, enterprise, state, dual, backfill, verifier };
}

describe('Migration full path (happy)', () => {
  it('seeds → copies → verifies → completes; counts match', async () => {
    const env = buildEnv();

    // 1. Pre-populate lite store with two users / six memories.
    const userA = 'user-a';
    const userB = 'user-b';
    for (let i = 0; i < 4; i += 1) {
      await env.liteStore.create({
        userId: userA,
        content: `a-${i}`,
        tags: [`tag-a-${i}`],
        type: 'long-term',
      });
    }
    for (let i = 0; i < 2; i += 1) {
      await env.liteStore.create({
        userId: userB,
        content: `b-${i}`,
        type: 'long-term',
      });
    }

    // 2. Seed the migration state into `preparing` then move to `copying`.
    await env.state.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
      totalItems: 6,
      sourceManifestHash: await computeLiteManifestHash(env.liteStore),
    });
    expect((await env.state.currentState()) ?? null).toBe('preparing');

    await env.state.checkpointMigration('copying', {
      cursor: null,
      progress: 0,
      totalItems: 6,
    });

    // 3. Run the backfill.
    const summary = await env.backfill.run({});
    expect(summary.processed).toBe(6);
    expect(summary.written).toBe(6);
    expect(summary.failed).toBe(0);
    expect(env.enterprise.rows.size).toBe(6);

    // 4. Run the verifier — must pass and transition to cutting_over.
    const report = await env.verifier.verify({});
    expect(report.passed).toBe(true);
    expect(report.globalSourceCount).toBe(6);
    expect(report.globalTargetCount).toBe(6);
    expect(report.globalHashMismatchCount).toBe(0);
    expect(report.hardStopFraction).toBe(DEFAULT_HARD_STOP_FRACTION);
    expect(report.perUser).toHaveLength(2);

    // 5. Complete the migration.
    const final = await env.state.completeMigration();
    expect(final.state).toBe('complete');
    expect(final.completedAt).not.toBeNull();
    expect((await env.state.currentState()) ?? null).toBe('complete');

    // 6. Dual-write outside the copying window is a no-op on the
    //    shadow side (state is `complete`).
    const tailResult = await env.dual.create({
      userId: userA,
      content: 'post-migration',
    });
    expect(tailResult.shadowWritten).toBe(false);
    expect(tailResult.shadowDuplicate).toBe(false);
  });

  it('re-runs the backfill idempotently — duplicates are skipped', async () => {
    const env = buildEnv();
    const userId = 'user-c';
    for (let i = 0; i < 3; i += 1) {
      await env.liteStore.create({
        userId,
        content: `c-${i}`,
        type: 'long-term',
      });
    }
    await env.state.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
      totalItems: 3,
    });
    await env.state.checkpointMigration('copying', {
      cursor: null,
      progress: 0,
    });
    const first = await env.backfill.run({});
    expect(first.written).toBe(3);

    // Force a second pass from the beginning by clearing the
    // cursor + progress on the checkpoint. The existing rows in
    // the enterprise shadow must be classified as `duplicate`
    // (idempotent retry) and not re-created.
    await env.state.checkpointMigration('copying', {
      cursor: null,
      progress: 0,
    });
    const second = await env.backfill.run({});
    expect(second.processed).toBe(3);
    expect(second.written).toBe(0);
    expect(second.duplicates).toBe(3);
    expect(env.enterprise.rows.size).toBe(3);
  });

  it('encodes/decodes cursors round-trip', () => {
    expect(encodeCursor(null, null)).toBeNull();
    expect(encodeCursor('alice', 'm-1')).toBe('alice::m-1');
    expect(encodeCursor('alice', null)).toBe('alice::');
  });

  it('seeds the migration in the default id slot', async () => {
    const env = buildEnv();
    expect(await env.state.tryLoad()).toBeNull();
    await env.state.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
    });
    const loaded = await env.state.tryLoad(DEFAULT_MIGRATION_ID);
    expect(loaded?.state).toBe('preparing');
  });
});
