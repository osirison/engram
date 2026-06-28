import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DualWriteCoordinator,
  FileCheckpointBackend,
  LiteJsonStore,
  MigrationStateService,
  computeContentHash,
} from '../migration';

const workDirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'engram-dual-write-'));
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
  organizationId?: string;
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
  get(userId: string, memoryId: string): Promise<EnterpriseMemory | null>;
} {
  const rows = new Map<string, EnterpriseMemory>();
  // Translate `userId::liteId` keys (the dual-write coordinator uses
  // the lite id when calling `update`/`delete`) to the canonical
  // enterprise id so the stub can locate the right row.
  const liteIndex = new Map<string, string>();
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
      const row: EnterpriseMemory = {
        id,
        userId: input.userId,
        organizationId: input.organizationId,
        content: input.content,
        tags: input.tags ?? [],
        metadata: input.metadata,
      };
      rows.set(`${input.userId}::${id}`, row);
      const liteId = readLiteIdFromMetadata(input.metadata);
      if (liteId) {
        liteIndex.set(`${input.userId}::${liteId}`, id);
      }
      return { ...row };
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
      const enterpriseId = liteIndex.get(`${userId}::${memoryId}`) ?? memoryId;
      const key = `${userId}::${enterpriseId}`;
      const row = rows.get(key);
      if (!row) throw new Error('not found');
      const next: EnterpriseMemory = {
        ...row,
        content: patch.content ?? row.content,
        tags: patch.tags ?? row.tags,
        metadata: patch.metadata ?? row.metadata,
      };
      rows.set(key, next);
      return { ...next };
    },
    async delete(userId: string, memoryId: string): Promise<boolean> {
      await Promise.resolve();
      const enterpriseId = liteIndex.get(`${userId}::${memoryId}`) ?? memoryId;
      const removed = rows.delete(`${userId}::${enterpriseId}`);
      liteIndex.delete(`${userId}::${memoryId}`);
      return removed;
    },
    async get(
      userId: string,
      memoryId: string,
    ): Promise<EnterpriseMemory | null> {
      await Promise.resolve();
      const direct = rows.get(`${userId}::${memoryId}`);
      if (direct) return direct;
      const enterpriseId = liteIndex.get(`${userId}::${memoryId}`);
      if (enterpriseId) {
        return rows.get(`${userId}::${enterpriseId}`) ?? null;
      }
      return null;
    },
  };
}

function readLiteIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)['_liteId'];
  return typeof value === 'string' ? value : null;
}

interface Env {
  liteStore: LiteJsonStore;
  enterprise: ReturnType<typeof buildEnterpriseLtmStub>;
  state: MigrationStateService;
  dual: DualWriteCoordinator;
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
  return { liteStore, enterprise, state, dual };
}

async function armCopying(state: MigrationStateService): Promise<void> {
  await state.checkpointMigration('preparing', { cursor: null, progress: 0 });
  await state.checkpointMigration('copying', { cursor: null, progress: 0 });
}

describe('DualWriteCoordinator — fan-out to both stores', () => {
  it('writes to the lite store + enterprise shadow when state is copying', async () => {
    const env = buildEnv();
    await armCopying(env.state);

    const result = await env.dual.create({
      userId: 'alice',
      content: 'hello world',
      tags: ['greeting'],
    });

    // Primary side is always the lite store.
    expect(result.primary.userId).toBe('alice');
    expect(result.primary.content).toBe('hello world');
    expect(result.primary.tags).toEqual(['greeting']);

    // Shadow side gets the row with the lite-assigned id and the
    // content hash recorded for de-dup.
    expect(result.shadowWritten).toBe(true);
    expect(result.shadowDuplicate).toBe(false);
    expect(result.contentHash).toBe(computeContentHash('alice', 'hello world'));
    expect(env.enterprise.rows.size).toBe(1);
    const [shadowRow] = Array.from(env.enterprise.rows.values());
    expect(shadowRow?.userId).toBe('alice');
    expect(shadowRow?.content).toBe('hello world');
    expect(shadowRow?.tags).toEqual(['greeting']);
    // Shadow id differs from primary because the enterprise adapter
    // minted its own — that is intentional, the migration tooling
    // is responsible for remapping ids at cutover.
    expect(shadowRow?.id).not.toBe(result.primary.id);

    // In-process shadow index is populated.
    expect(env.dual.snapshotShadowIndex()).toEqual({
      [result.primary.id]: result.contentHash,
    });
  });

  it('skips the shadow leg outside the copying/verifying window', async () => {
    const env = buildEnv();

    // No migration checkpoint — shouldDualWrite returns false.
    const result = await env.dual.create({
      userId: 'bob',
      content: 'untouched',
    });
    expect(result.shadowWritten).toBe(false);
    expect(result.shadowDuplicate).toBe(false);
    expect(env.enterprise.rows.size).toBe(0);

    // Move into `preparing` — still no fan-out.
    await env.state.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
    });
    const result2 = await env.dual.create({
      userId: 'bob',
      content: 'still-no-shadow',
    });
    expect(result2.shadowWritten).toBe(false);
    expect(env.enterprise.rows.size).toBe(0);
  });

  it('does not block the primary write when the shadow leg fails', async () => {
    const env = buildEnv();
    await armCopying(env.state);

    // Force the enterprise stub to throw on every create so we
    // exercise the retry-exhausted path. The lite store is the
    // canonical source during the migration window so its write
    // must succeed regardless.
    const boom = new Error('enterprise outage');
    env.enterprise.create = async (): Promise<never> => {
      await Promise.resolve();
      throw boom;
    };

    const result = await env.dual.create({
      userId: 'carol',
      content: 'best-effort',
    });

    expect(result.primary.userId).toBe('carol');
    expect(result.primary.content).toBe('best-effort');
    expect(result.shadowWritten).toBe(false);
    expect(result.shadowDuplicate).toBe(false);
    // Retries were exhausted (3 attempts) and the memory id is
    // recorded in the pending set so the backfill can mop up.
    expect(result.retryCount).toBe(3);
    const pending = env.dual.drainPendingShadowWrites();
    expect(pending).toContain(result.primary.id);
    expect(env.dual.drainPendingShadowWrites()).toEqual([]);
  });

  it('treats a duplicate-key conflict in the shadow as a successful no-op', async () => {
    const env = buildEnv();
    await armCopying(env.state);

    // First call writes through cleanly.
    const first = await env.dual.create({
      userId: 'dave',
      content: 'first',
    });
    expect(first.shadowWritten).toBe(true);

    // The shadow index should already hold `first.primary.id` mapped
    // to its content hash. We replace the stub's `create` with one
    // that always throws Prisma P2002; the coordinator must treat
    // that as a duplicate and update the shadow index instead of
    // bubbling the error.
    const liteId = first.primary.id;
    env.enterprise.create = async (): Promise<never> => {
      await Promise.resolve();
      const err = new Error('Unique constraint failed') as Error & {
        code: string;
      };
      err.code = 'P2002';
      throw err;
    };

    const second = await env.dual.create({
      userId: 'dave',
      content: 'first',
    });
    expect(second.shadowDuplicate).toBe(true);
    expect(second.shadowWritten).toBe(false);
    // The new lite id from the second call gets a shadow index entry
    // (so the next retry short-circuits), and the original entry is
    // also still present. The canonical hash wins either way.
    const index = env.dual.snapshotShadowIndex();
    expect(index[second.primary.id]).toBe(second.contentHash);
    expect(index[liteId]).toBe(first.contentHash);
  });

  it('propagates deletes to both stores during the copying window', async () => {
    const env = buildEnv();
    await armCopying(env.state);

    const created = await env.dual.create({
      userId: 'erin',
      content: 'to-be-deleted',
    });
    expect(created.shadowWritten).toBe(true);
    expect(env.enterprise.rows.size).toBe(1);

    // The stub's `delete` already translates the lite id via the
    // `_liteId` metadata recorded during create. No patching needed.
    const removed = await env.dual.delete('erin', created.primary.id);
    expect(removed).toBe(true);
    expect(env.enterprise.rows.size).toBe(0);
  });

  it('updates both stores and tracks the new content hash', async () => {
    const env = buildEnv();
    await armCopying(env.state);

    const created = await env.dual.create({
      userId: 'frank',
      content: 'before',
    });
    expect(created.shadowWritten).toBe(true);

    // The stub's `update` already translates the lite id to the
    // canonical enterprise id via the `_liteId` metadata recorded
    // during create. No additional patching is required.
    const updated = await env.dual.update('frank', created.primary.id, {
      content: 'after',
    });
    expect(updated?.primary.content).toBe('after');
    expect(updated?.shadowWritten).toBe(true);
    expect(updated?.contentHash).toBe(computeContentHash('frank', 'after'));
    // Enterprise shadow is the most recent value.
    const [shadowRow] = Array.from(env.enterprise.rows.values());
    expect(shadowRow?.content).toBe('after');
  });
});

describe('DualWriteCoordinator — without an enterprise adapter', () => {
  it('still writes to the lite store and queues pending shadow writes', async () => {
    const dataDir = freshDir();
    const liteStore = new LiteJsonStore(dataDir);
    const state = new MigrationStateService();
    state.setBackend(new FileCheckpointBackend(dataDir));
    await state.checkpointMigration('preparing', {
      cursor: null,
      progress: 0,
    });
    await state.checkpointMigration('copying', { cursor: null, progress: 0 });

    // No enterprise adapter passed — the coordinator should still
    // accept writes and queue the shadow leg for the next backfill.
    const dual = new DualWriteCoordinator(liteStore, state);

    const result = await dual.create({
      userId: 'grace',
      content: 'no-shadow-adapter',
    });
    expect(result.primary.content).toBe('no-shadow-adapter');
    expect(result.shadowWritten).toBe(false);
    expect(dual.drainPendingShadowWrites()).toContain(result.primary.id);
  });
});
