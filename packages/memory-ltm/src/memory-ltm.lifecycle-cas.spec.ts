import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryLtmService } from './memory-ltm.service';
import { MemoryType } from '@engram/database';
import { ImportanceScoringService } from './importance.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { ContradictionDetectionService } from './contradiction-detection.service';

/**
 * G3-T3 — lifecycle metadata writes participate in optimistic concurrency and
 * the audit trail.
 *
 * Every lifecycle path (`applyDecayPolicy` prune + metadata rewrite,
 * `markSuperseded`, `linkDuplicateAndReturn`, `recordAccess`) must:
 *  - CAS against the version it read (same `where` shape as user `update()`),
 *  - bump `version: { increment: 1 }` — EXCEPT `recordAccess`, which keeps
 *    the version-keyed `where` but must NOT increment: get()/recall record
 *    access, so a bump would 409 the caller's own read-then-update flow
 *    (update_memory requires `expectedVersion` since G4-T2),
 *  - on a conflict re-read and retry ONCE (recomputing from the FRESH row),
 *    then SKIP — a lifecycle job must never clobber a concurrent user edit,
 *  - `recordAccess` skips silently with NO retry (hot path),
 *  - prune + supersede emit system-actor audit rows whose `before` snapshot
 *    satisfies the WP2 T5 restore contract.
 *
 * The interleaving is simulated by mocking Prisma: the first CAS write misses
 * (deleteMany count 0 / update P2025) as if another writer bumped the version
 * between the lifecycle read and write, and the follow-up read returns the
 * concurrently-edited row at a higher version.
 */
describe('MemoryLtmService lifecycle CAS + audit (G3-T3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const userId = 'cldx4k8xp000108l83h4y8v2q';
  const memoryId = 'cldx4k8xp000208l84b5c9w3r';
  const DAY_MS = 86_400_000;

  const p2025 = () => Object.assign(new Error('Record to update not found.'), { code: 'P2025' });

  const baseMemory = {
    id: memoryId,
    userId,
    organizationId: null,
    scope: null,
    content: 'Test memory content',
    metadata: { test: 'data' },
    tags: ['test'],
    type: MemoryType.LONG_TERM,
    version: 1,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    expiresAt: null,
    embedding: [],
  };

  beforeEach(() => {
    prisma = {
      memory: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      memoryAudit: {
        create: vi.fn().mockResolvedValue({ id: 'audit-row' }),
      },
      memoryLink: {
        upsert: vi.fn().mockResolvedValue({ id: 'link-row' }),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (callback: (tx: any) => Promise<unknown>) => callback(prisma)
    );
  });

  const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

  describe('decay prune (applyDecayPolicy)', () => {
    // 'misc note' + 400 days old + empty metadata scores well below the 0.15
    // prune threshold (same fixture as the pre-existing decay specs).
    const pruneCandidate = (version: number, metadata: Record<string, unknown> = {}) => ({
      ...baseMemory,
      id: 'old-memory',
      content: 'misc note',
      createdAt: new Date(Date.now() - 400 * DAY_MS),
      metadata,
      version,
    });

    const decayService = () =>
      new MemoryLtmService(
        prisma as never,
        undefined,
        undefined,
        undefined,
        new ImportanceScoringService() as never
      );

    const decayOptions = { pruneOlderThanDays: 30, pruneScoreThreshold: 0.15 };

    it('prunes with a version-guarded delete and writes a restorable system audit row', async () => {
      prisma.memory.findMany.mockResolvedValueOnce([pruneCandidate(4)]).mockResolvedValueOnce([]);
      prisma.memory.deleteMany.mockResolvedValue({ count: 1 });

      const result = await decayService().applyDecayPolicy(decayOptions);

      expect(result.pruned).toBe(1);
      expect(result.skippedConcurrentEdit).toBe(0);
      expect(prisma.memory.deleteMany).toHaveBeenCalledWith({
        where: {
          id: 'old-memory',
          userId,
          type: MemoryType.LONG_TERM,
          version: 4,
        },
      });

      // Audit row: system actor, action 'delete', snapshot shape that
      // findLatestDeleteSnapshot()/restore_memory consume unchanged.
      expect(prisma.memoryAudit.create).toHaveBeenCalledTimes(1);
      const auditData = prisma.memoryAudit.create.mock.calls[0][0].data;
      expect(auditData).toMatchObject({
        memoryId: 'old-memory',
        userId,
        organizationId: null,
        scope: null,
        action: 'delete',
        actorType: 'system',
        actorId: 'ltm_decay',
        actorLabel: null,
        delegated: false,
        after: { deleted: true, reason: 'decay_prune' },
      });
      expect(auditData.before).toEqual({
        content: 'misc note',
        tags: ['test'],
        metadata: {},
        type: 'long-term',
        scope: null,
        expiresAt: null,
        version: 4,
      });
    });

    it('retries ONCE with the fresh version when a concurrent edit moves the row', async () => {
      prisma.memory.findMany.mockResolvedValueOnce([pruneCandidate(4)]).mockResolvedValueOnce([]);
      // First guarded delete misses (version moved 4 → 5), second succeeds.
      prisma.memory.deleteMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      // Re-read returns the concurrently-bumped row, still prune-eligible.
      prisma.memory.findFirst.mockResolvedValueOnce(pruneCandidate(5));

      const result = await decayService().applyDecayPolicy(decayOptions);

      expect(result.pruned).toBe(1);
      expect(result.skippedConcurrentEdit).toBe(0);
      expect(prisma.memory.deleteMany).toHaveBeenCalledTimes(2);
      // Never re-uses the stale version — the retry carries the FRESH version.
      expect(prisma.memory.deleteMany.mock.calls[0][0].where.version).toBe(4);
      expect(prisma.memory.deleteMany.mock.calls[1][0].where.version).toBe(5);
      // The audit snapshot reflects the row that was actually deleted (v5).
      expect(prisma.memoryAudit.create.mock.calls[0][0].data.before.version).toBe(5);
    });

    it('skips the prune (no clobber, no audit) when the version conflicts twice', async () => {
      prisma.memory.findMany.mockResolvedValueOnce([pruneCandidate(4)]).mockResolvedValueOnce([]);
      prisma.memory.deleteMany.mockResolvedValue({ count: 0 });
      prisma.memory.findFirst.mockResolvedValueOnce(pruneCandidate(5));

      const result = await decayService().applyDecayPolicy(decayOptions);

      expect(result.pruned).toBe(0);
      expect(result.skippedConcurrentEdit).toBe(1);
      // Exactly retry-once: two guarded attempts, then give up.
      expect(prisma.memory.deleteMany).toHaveBeenCalledTimes(2);
      expect(prisma.memoryAudit.create).not.toHaveBeenCalled();
    });

    it('skips the prune when the concurrent edit disqualifies the row (e.g. pins it)', async () => {
      prisma.memory.findMany.mockResolvedValueOnce([pruneCandidate(4)]).mockResolvedValueOnce([]);
      prisma.memory.deleteMany.mockResolvedValueOnce({ count: 0 });
      // The concurrent edit pinned the memory — it must NOT be deleted.
      prisma.memory.findFirst.mockResolvedValueOnce(pruneCandidate(5, { pinned: true }));

      const result = await decayService().applyDecayPolicy(decayOptions);

      expect(result.pruned).toBe(0);
      expect(result.skippedConcurrentEdit).toBe(1);
      // No second delete attempt against the now-pinned row.
      expect(prisma.memory.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.memoryAudit.create).not.toHaveBeenCalled();
    });

    it('a decay-pruned memory can be restored from its audit snapshot (round trip)', async () => {
      const candidate = {
        ...pruneCandidate(4, { note: 'keep-shape' }),
        tags: ['a', 'b'],
        scope: 'project:engram',
      };
      prisma.memory.findMany.mockResolvedValueOnce([candidate]).mockResolvedValueOnce([]);
      prisma.memory.deleteMany.mockResolvedValue({ count: 1 });

      const service = decayService();
      await service.applyDecayPolicy(decayOptions);

      const audit = prisma.memoryAudit.create.mock.calls[0][0].data;
      // The restore tool filters on action delete/bulk-delete and requires
      // before.content — exactly what the prune audit row provides.
      expect(['delete', 'bulk-delete']).toContain(audit.action);
      expect(typeof audit.before.content).toBe('string');
      expect(audit.before.content.length).toBeGreaterThan(0);

      // Feed the snapshot through restore() the same way restore_memory does.
      prisma.memory.count.mockResolvedValue(0);
      prisma.memory.create.mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (args: any) => ({ ...baseMemory, ...args.data, version: 1 })
      );
      const restored = await service.restore({
        id: audit.memoryId,
        userId: audit.userId,
        content: audit.before.content,
        tags: audit.before.tags,
        metadata: audit.before.metadata,
        scope: audit.before.scope ?? audit.scope,
        organizationId: audit.organizationId,
      });

      expect(prisma.memory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'old-memory',
          userId,
          content: 'misc note',
          tags: ['a', 'b'],
          metadata: { note: 'keep-shape' },
          scope: 'project:engram',
          type: MemoryType.LONG_TERM,
        }),
      });
      expect(restored.id).toBe('old-memory');
    });
  });

  describe('decay metadata rewrite (applyDecayPolicy)', () => {
    // Recent decision-cue content: status stays active but importance moves
    // well past the 0.01 write threshold against empty stored metadata.
    const updateCandidate = (version: number, metadata: Record<string, unknown> = {}) => ({
      ...baseMemory,
      id: 'strong-memory',
      content: 'Decision: keep after launch milestone',
      createdAt: new Date(Date.now() - 2 * DAY_MS),
      metadata,
      version,
    });

    const decayService = () =>
      new MemoryLtmService(
        prisma as never,
        undefined,
        undefined,
        undefined,
        new ImportanceScoringService() as never
      );

    it('recomputes the annotation from the FRESH row when the first CAS misses', async () => {
      prisma.memory.findMany.mockResolvedValueOnce([updateCandidate(2)]).mockResolvedValueOnce([]);
      // First CAS misses; the concurrent edit added user metadata at v9.
      prisma.memory.update
        .mockRejectedValueOnce(p2025())
        .mockImplementationOnce(async (args: { data: unknown }) => ({
          ...updateCandidate(9),
          ...(args.data as Record<string, unknown>),
          version: 10,
        }));
      prisma.memory.findFirst.mockResolvedValueOnce(updateCandidate(9, { note: 'user-edit' }));

      const result = await decayService().applyDecayPolicy({});

      expect(result.updated).toBe(1);
      expect(result.skippedConcurrentEdit).toBe(0);
      expect(prisma.memory.update).toHaveBeenCalledTimes(2);

      const first = prisma.memory.update.mock.calls[0][0];
      expect(first.where).toEqual({
        id: 'strong-memory',
        userId,
        type: MemoryType.LONG_TERM,
        version: 2,
      });
      expect(first.data.version).toEqual({ increment: 1 });

      const second = prisma.memory.update.mock.calls[1][0];
      // Retry CAS'd against the FRESH version, still bumping it...
      expect(second.where.version).toBe(9);
      expect(second.data.version).toEqual({ increment: 1 });
      // ...and the rewritten metadata was recomputed from the fresh row, so
      // the concurrent edit's fields survive instead of being clobbered.
      expect(second.data.metadata).toEqual(
        expect.objectContaining({ note: 'user-edit', importance: expect.any(Number) })
      );
    });

    it('skips the rewrite and counts the conflict when the CAS misses twice', async () => {
      prisma.memory.findMany.mockResolvedValueOnce([updateCandidate(2)]).mockResolvedValueOnce([]);
      prisma.memory.update.mockRejectedValue(p2025());
      prisma.memory.findFirst.mockResolvedValueOnce(updateCandidate(9, { note: 'user-edit' }));

      const result = await decayService().applyDecayPolicy({});

      expect(result.updated).toBe(0);
      expect(result.skippedConcurrentEdit).toBe(1);
      expect(prisma.memory.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('markSuperseded (contradiction supersede via create)', () => {
    // Supersede is an explicit opt-in since G3-T4 (default policy is `flag`);
    // the policy is read from the environment at service construction time.
    beforeEach(() => {
      process.env.MEMORY_CONTRADICTION_POLICY = 'supersede';
    });
    afterEach(() => {
      delete process.env.MEMORY_CONTRADICTION_POLICY;
    });

    const oldMemoryId = 'cldx4k8xp000308l84b5c9x4s';
    const oldRow = (version: number, metadata: Record<string, unknown> = { importance: 0.5 }) => ({
      ...baseMemory,
      id: oldMemoryId,
      content: 'I like Python',
      metadata,
      version,
    });
    const newMemory = { ...baseMemory, content: "I don't like Python" };

    const buildService = () => {
      const vectorStore = {
        backend: 'pgvector' as const,
        upsert: vi.fn(),
        delete: vi.fn(),
        ensureReady: vi.fn(),
        search: vi.fn().mockResolvedValue([{ id: oldMemoryId, score: 0.85 }]),
      };
      const embeddingsService = {
        generate: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      };
      prisma.memory.count.mockResolvedValue(0);
      prisma.memory.findMany.mockResolvedValue([{ id: oldMemoryId, content: 'I like Python' }]);
      prisma.memory.create.mockResolvedValue(newMemory);
      return new MemoryLtmService(
        prisma as never,
        undefined,
        embeddingsService as never,
        vectorStore as never,
        new ImportanceScoringService() as never,
        new DuplicateDetectionService() as never,
        undefined,
        new ContradictionDetectionService() as never
      );
    };

    it('merges the supersede marker into the FRESH row on retry and audits the supersede', async () => {
      const svc = buildService();
      prisma.memory.findFirst
        // exact-content dedup miss
        .mockResolvedValueOnce(null)
        // annotateContradictor read
        .mockResolvedValueOnce(oldRow(1))
        // markSuperseded initial read (v1)
        .mockResolvedValueOnce(oldRow(1))
        // retry read after CAS miss: concurrent edit landed (v3, new metadata)
        .mockResolvedValueOnce(oldRow(3, { userNote: 'kept' }));
      prisma.memory.update
        .mockRejectedValueOnce(p2025())
        .mockImplementationOnce(async (args: { data: unknown }) => ({
          ...oldRow(3),
          ...(args.data as Record<string, unknown>),
          version: 4,
        }));

      await svc.create({ userId, content: "I don't like Python" });

      expect(prisma.memory.update).toHaveBeenCalledTimes(2);
      const first = prisma.memory.update.mock.calls[0][0];
      expect(first.where).toEqual({
        id: oldMemoryId,
        userId,
        type: MemoryType.LONG_TERM,
        version: 1,
      });
      expect(first.data.version).toEqual({ increment: 1 });

      const second = prisma.memory.update.mock.calls[1][0];
      expect(second.where.version).toBe(3);
      expect(second.data.version).toEqual({ increment: 1 });
      // Marker merged into the CONCURRENT edit's metadata, not the stale copy.
      expect(second.data.metadata).toEqual(
        expect.objectContaining({
          userNote: 'kept',
          status: 'superseded',
          supersededBy: newMemory.id,
          supersededReason: 'negation asymmetry',
        })
      );

      // Supersede is user-visible (hides the row from recall) → audited.
      expect(prisma.memoryAudit.create).toHaveBeenCalledTimes(1);
      const audit = prisma.memoryAudit.create.mock.calls[0][0].data;
      expect(audit).toMatchObject({
        memoryId: oldMemoryId,
        userId,
        action: 'supersede',
        actorType: 'system',
        actorId: 'dedup_supersede',
        delegated: false,
        after: {
          superseded: true,
          supersededBy: newMemory.id,
          supersededReason: 'negation asymmetry',
        },
      });
      // Pre-image snapshot matches the WP2 T5 MemorySnapshot shape.
      expect(audit.before).toEqual({
        content: 'I like Python',
        tags: ['test'],
        metadata: { userNote: 'kept' },
        type: 'long-term',
        scope: null,
        expiresAt: null,
        version: 3,
      });
    });

    it('skips the supersede without clobbering or auditing after two conflicts', async () => {
      const svc = buildService();
      prisma.memory.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(oldRow(1))
        .mockResolvedValueOnce(oldRow(1))
        .mockResolvedValueOnce(oldRow(3, { userNote: 'kept' }));
      prisma.memory.update.mockRejectedValue(p2025());

      // The create itself still succeeds — supersede stays non-fatal.
      const created = await svc.create({ userId, content: "I don't like Python" });
      expect(created.id).toBe(newMemory.id);

      // Exactly retry-once, then give up; nothing audited.
      expect(prisma.memory.update).toHaveBeenCalledTimes(2);
      expect(prisma.memoryAudit.create).not.toHaveBeenCalled();
    });
  });

  describe('markContradicted (contradiction flag via create, G3-T4 default policy)', () => {
    const oldMemoryId = 'cldx4k8xp000308l84b5c9x4s';
    const oldRow = (version: number, metadata: Record<string, unknown> = { importance: 0.5 }) => ({
      ...baseMemory,
      id: oldMemoryId,
      content: 'I like Python',
      metadata,
      version,
    });
    const newMemory = { ...baseMemory, content: "I don't like Python" };

    beforeEach(() => {
      // Flag IS the default: prove it by deleting (not setting) the policy var.
      delete process.env.MEMORY_CONTRADICTION_POLICY;
    });

    const buildService = () => {
      const vectorStore = {
        backend: 'pgvector' as const,
        upsert: vi.fn(),
        delete: vi.fn(),
        ensureReady: vi.fn(),
        search: vi.fn().mockResolvedValue([{ id: oldMemoryId, score: 0.85 }]),
      };
      const embeddingsService = {
        generate: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      };
      prisma.memory.count.mockResolvedValue(0);
      prisma.memory.findMany.mockResolvedValue([{ id: oldMemoryId, content: 'I like Python' }]);
      prisma.memory.create.mockResolvedValue(newMemory);
      return new MemoryLtmService(
        prisma as never,
        undefined,
        embeddingsService as never,
        vectorStore as never,
        new ImportanceScoringService() as never,
        new DuplicateDetectionService() as never,
        undefined,
        new ContradictionDetectionService() as never
      );
    };

    it('merges the review fields into the FRESH row on retry, bumping the version', async () => {
      const svc = buildService();
      prisma.memory.findFirst
        // exact-content dedup miss
        .mockResolvedValueOnce(null)
        // annotateContradictor read
        .mockResolvedValueOnce(oldRow(1))
        // markContradicted initial read (v1)
        .mockResolvedValueOnce(oldRow(1))
        // retry read after CAS miss: concurrent edit landed (v3, new metadata)
        .mockResolvedValueOnce(oldRow(3, { userNote: 'kept' }));
      prisma.memory.update
        .mockRejectedValueOnce(p2025())
        .mockImplementationOnce(async (args: { data: unknown }) => ({
          ...oldRow(3),
          ...(args.data as Record<string, unknown>),
          version: 4,
        }));

      await svc.create({ userId, content: "I don't like Python" });

      expect(prisma.memory.update).toHaveBeenCalledTimes(2);
      const first = prisma.memory.update.mock.calls[0][0];
      expect(first.where).toEqual({
        id: oldMemoryId,
        userId,
        type: MemoryType.LONG_TERM,
        version: 1,
      });
      expect(first.data.version).toEqual({ increment: 1 });

      const second = prisma.memory.update.mock.calls[1][0];
      expect(second.where.version).toBe(3);
      expect(second.data.version).toEqual({ increment: 1 });
      // Review fields merged into the CONCURRENT edit's metadata, not the stale copy.
      expect(second.data.metadata).toEqual(
        expect.objectContaining({
          userNote: 'kept',
          status: 'contradicted',
          contradictionWith: newMemory.id,
          contradictionReason: 'negation asymmetry',
        })
      );
      expect(second.data.metadata).not.toHaveProperty('supersededBy');

      // Flagging hides nothing from recall (both rows stay visible), so unlike
      // supersede there is no user-visible mutation to audit.
      expect(prisma.memoryAudit.create).not.toHaveBeenCalled();
      // The pair is linked for review.
      expect(prisma.memoryLink.upsert).toHaveBeenCalledTimes(1);
    });

    it('skips the flag without clobbering after two conflicts; create still succeeds', async () => {
      const svc = buildService();
      prisma.memory.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(oldRow(1))
        .mockResolvedValueOnce(oldRow(1))
        .mockResolvedValueOnce(oldRow(3, { userNote: 'kept' }));
      prisma.memory.update.mockRejectedValue(p2025());

      // The create itself still succeeds — flagging stays non-fatal.
      const created = await svc.create({ userId, content: "I don't like Python" });
      expect(created.id).toBe(newMemory.id);

      // Exactly retry-once, then give up; nothing audited.
      expect(prisma.memory.update).toHaveBeenCalledTimes(2);
      expect(prisma.memoryAudit.create).not.toHaveBeenCalled();
    });
  });

  describe('linkDuplicateAndReturn (dedup annotation via create)', () => {
    const buildService = () => {
      const vectorStore = {
        backend: 'pgvector' as const,
        upsert: vi.fn(),
        delete: vi.fn(),
        ensureReady: vi.fn(),
        search: vi.fn().mockResolvedValue([{ id: memoryId, score: 0.99 }]),
      };
      const embeddingsService = {
        generate: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      };
      prisma.memory.count.mockResolvedValue(0);
      return new MemoryLtmService(
        prisma as never,
        undefined,
        embeddingsService as never,
        vectorStore as never,
        new ImportanceScoringService() as never,
        new DuplicateDetectionService() as never
      );
    };

    it('retries the annotation once against the fresh version', async () => {
      const svc = buildService();
      prisma.memory.findFirst
        // exact-content dedup miss
        .mockResolvedValueOnce(null)
        // linkDuplicate initial read (v1)
        .mockResolvedValueOnce({ ...baseMemory, version: 1 })
        // retry read after CAS miss (v6, concurrently edited metadata)
        .mockResolvedValueOnce({ ...baseMemory, version: 6, metadata: { edited: true } });
      prisma.memory.update
        .mockRejectedValueOnce(p2025())
        .mockImplementationOnce(async (args: { data: unknown }) => ({
          ...baseMemory,
          ...(args.data as Record<string, unknown>),
          version: 7,
        }));

      const result = await svc.create({ userId, content: 'Test memory content dup' });

      expect(prisma.memory.create).not.toHaveBeenCalled();
      expect(prisma.memory.update).toHaveBeenCalledTimes(2);
      expect(prisma.memory.update.mock.calls[0][0].where.version).toBe(1);
      const second = prisma.memory.update.mock.calls[1][0];
      expect(second.where.version).toBe(6);
      expect(second.data.version).toEqual({ increment: 1 });
      // Annotation recomputed on the fresh row: concurrent metadata survives.
      expect(second.data.metadata).toEqual(
        expect.objectContaining({
          edited: true,
          duplicateMatches: expect.arrayContaining([expect.objectContaining({ memoryId })]),
        })
      );
      expect(result.id).toBe(memoryId);
      // Metadata-only bookkeeping — no audit row for dedup annotations.
      expect(prisma.memoryAudit.create).not.toHaveBeenCalled();
    });

    it('drops the annotation (returns the row un-clobbered) after two conflicts', async () => {
      const svc = buildService();
      prisma.memory.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...baseMemory, version: 1 })
        .mockResolvedValueOnce({ ...baseMemory, version: 6, metadata: { edited: true } })
        .mockResolvedValueOnce({ ...baseMemory, version: 7, metadata: { edited: true } });
      prisma.memory.update.mockRejectedValue(p2025());

      const result = await svc.create({ userId, content: 'Test memory content dup' });

      // Exactly two CAS attempts, then the current row is returned as-is.
      expect(prisma.memory.update).toHaveBeenCalledTimes(2);
      expect(prisma.memory.create).not.toHaveBeenCalled();
      expect(result.id).toBe(memoryId);
      expect(result.metadata).toEqual({ edited: true });
    });
  });

  describe('recordAccess (recall/get hot path)', () => {
    const buildService = () =>
      new MemoryLtmService(
        prisma as never,
        undefined,
        undefined,
        undefined,
        new ImportanceScoringService() as never
      );

    it('writes access bookkeeping keyed to the read version WITHOUT bumping version', async () => {
      prisma.memory.findFirst.mockResolvedValue({ ...baseMemory, version: 2 });
      prisma.memory.update.mockResolvedValue({ ...baseMemory, version: 2 });

      const svc = buildService();
      await svc.get(userId, memoryId);
      await flushMicrotasks();

      expect(prisma.memory.update).toHaveBeenCalledTimes(1);
      const call = prisma.memory.update.mock.calls[0][0];
      // Version-KEYED where: a stale access write can never clobber a
      // concurrent edit — it just misses and is dropped.
      expect(call.where).toEqual({
        id: memoryId,
        userId,
        type: MemoryType.LONG_TERM,
        version: 2,
      });
      // ...but NO version increment: the caller that just read v2 must keep a
      // valid `expectedVersion` for a follow-up update (G4-T2 interaction).
      expect(call.data.version).toBeUndefined();
      expect(call.data.metadata).toEqual(expect.objectContaining({ accessCount: 1 }));
    });

    it('skips silently on version conflict — no retry, no throw', async () => {
      prisma.memory.findFirst.mockResolvedValue({ ...baseMemory, version: 2 });
      prisma.memory.update.mockRejectedValue(p2025());

      const svc = buildService();
      const result = await svc.get(userId, memoryId);
      await flushMicrotasks();

      expect(result?.id).toBe(memoryId);
      // Hot path: exactly ONE attempt, no re-read, no retry loop.
      expect(prisma.memory.update).toHaveBeenCalledTimes(1);
      expect(prisma.memory.findFirst).toHaveBeenCalledTimes(1);
    });

    it('never throws into the read path when the access write fails hard', async () => {
      prisma.memory.findFirst.mockResolvedValue({ ...baseMemory, version: 2 });
      prisma.memory.update.mockRejectedValue(new Error('connection reset'));

      const svc = buildService();
      const result = await svc.get(userId, memoryId);
      await flushMicrotasks();

      expect(result?.id).toBe(memoryId);
      expect(prisma.memory.update).toHaveBeenCalledTimes(1);
    });

    it('read-then-update with the read version does not self-409 after access bookkeeping', async () => {
      // Regression pin for the G3-T3 × G4-T2 interaction: get()/recall record
      // access, and update_memory REQUIRES expectedVersion — if the access
      // write bumped `version`, every client that read v2 would 409 against
      // its OWN access bump. Stateful mock honoring the version-keyed where
      // and `increment` semantics, so a reintroduced bump fails this test.
      let row: Record<string, unknown> = { ...baseMemory, version: 2 };
      prisma.memory.findFirst.mockImplementation(async () => ({ ...row }));
      prisma.memory.update.mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (args: any) => {
          if (args.where.version !== undefined && args.where.version !== row.version) {
            throw p2025();
          }
          const { version, ...data } = args.data as Record<string, unknown> & {
            version?: { increment: number };
          };
          row = {
            ...row,
            ...data,
            version: (row.version as number) + (version?.increment ?? 0),
          };
          return { ...row };
        }
      );

      const svc = buildService();
      const fetched = await svc.get(userId, memoryId);
      expect(fetched?.version).toBe(2);
      await flushMicrotasks(); // let the fire-and-forget access write land

      // The access write moved the bookkeeping but NOT the version...
      expect(row.version).toBe(2);
      expect((row.metadata as { accessCount?: number }).accessCount).toBe(1);

      // ...so the version the client read is still a valid CAS token.
      const updated = await svc.update(userId, memoryId, {
        content: 'edited right after reading v2',
        expectedVersion: 2,
      });
      expect(updated.version).toBe(3);
      expect(updated.content).toBe('edited right after reading v2');
    });
  });
});
