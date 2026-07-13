import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryType } from '@engram/database';
import { CorpusConsolidationService } from './corpus-consolidation.service';
import { MemoryLtmService } from './memory-ltm.service';
import { ContradictionDetectionService } from './contradiction-detection.service';

/**
 * G3-T2 — periodic corpus consolidation (near-duplicate clustering).
 *
 * Verifies the pinned merge semantics against a mocked Prisma + vector store:
 *  - N near-dupes in [0.85, 0.95] collapse to 1 canonical + N−1 losers marked
 *    superseded (write-time markers), linked `duplicate-of`, and audited with
 *    the `corpus_consolidation` system actor;
 *  - dry-run (the DEFAULT) mutates absolutely nothing;
 *  - a second run is a no-op because losers are excluded (idempotence);
 *  - cursor-resumable mid-run;
 *  - contradiction-flagged pairs (G3-T4) are never merged;
 *  - a concurrent edit that keeps winning the CAS is skipped and counted;
 *  - tags are unioned onto the canonical through the CAS path;
 *  - canonical election = highest importance, tie-break most recent.
 */
describe('CorpusConsolidationService (G3-T2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let vectorStore: any;

  const userId = 'cldx4k8xp000108l83h4y8v2q';
  const DAY_MS = 86_400_000;
  const p2025 = () => Object.assign(new Error('Record to update not found.'), { code: 'P2025' });

  type Row = {
    id: string;
    userId: string;
    organizationId: string | null;
    scope: string | null;
    content: string;
    metadata: Record<string, unknown> | null;
    tags: string[];
    type: string;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    expiresAt: Date | null;
    embedding: number[];
  };

  const row = (overrides: Partial<Row> & { id: string }): Row => ({
    userId,
    organizationId: null,
    scope: null,
    content: `content of ${overrides.id}`,
    metadata: { importance: 0.5 },
    tags: [],
    type: MemoryType.LONG_TERM,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: null,
    embedding: [0.1, 0.2, 0.3],
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      memory: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
        deleteMany: vi.fn(),
        count: vi.fn(),
      },
      memoryAudit: { create: vi.fn().mockResolvedValue({ id: 'audit-row' }) },
      memoryLink: { upsert: vi.fn().mockResolvedValue({ id: 'link-row' }) },
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn(),
    };
    vectorStore = {
      backend: 'qdrant' as const,
      upsert: vi.fn(),
      delete: vi.fn(),
      ensureReady: vi.fn(),
      search: vi.fn().mockResolvedValue([]),
    };
  });

  const buildService = () =>
    new CorpusConsolidationService(
      prisma as never,
      new MemoryLtmService(prisma as never),
      new ContradictionDetectionService(),
      vectorStore as never
    );

  /**
   * Seed-page queue for the cursor loop. The service also uses findMany for
   * candidate hydration (`where.id.in`), which is routed to the full corpus.
   */
  const seedBatches = (...pages: Row[][]) => {
    const corpus = pages.flat();
    const queue = [...pages];
    prisma.memory.findMany.mockImplementation(
      async (args: { where?: { id?: { in?: string[] } }; take?: number }) => {
        if (args.where?.id?.in) {
          const wanted = new Set(args.where.id.in);
          return corpus.filter((r) => wanted.has(r.id));
        }
        return queue.shift() ?? [];
      }
    );
  };

  const successfulCas = () => {
    prisma.memory.update.mockImplementation(
      async (args: { where: { id: string; version: number }; data: Record<string, unknown> }) => ({
        ...row({ id: args.where.id }),
        ...args.data,
        version: args.where.version + 1,
      })
    );
  };

  it('collapses N near-dupes in [0.85, 0.95] into 1 canonical + N−1 superseded/linked/audited losers', async () => {
    const a = row({ id: 'mem-a', metadata: { importance: 0.4 }, tags: ['alpha'] });
    const b = row({ id: 'mem-b', metadata: { importance: 0.9 }, tags: ['beta'], version: 3 });
    const c = row({ id: 'mem-c', metadata: { importance: 0.2 }, tags: ['alpha', 'gamma'] });
    seedBatches([a, b, c]);
    vectorStore.search.mockResolvedValueOnce([
      { id: 'mem-a', score: 1.0 },
      { id: 'mem-b', score: 0.92 },
      { id: 'mem-c', score: 0.88 },
    ]);
    successfulCas();

    const result = await buildService().run({ dryRun: false });

    expect(result).toMatchObject({
      scanned: 3,
      clusters: 1,
      merged: 2,
      skippedConcurrentEdit: 0,
      cursor: null,
      dryRun: false,
      perClusterTruncated: false,
    });
    expect(result.perCluster).toEqual([
      {
        canonicalId: 'mem-b', // highest importance wins
        loserIds: ['mem-a', 'mem-c'],
        // seed lost the election → reports its similarity to the canonical
        scores: [0.92, 0.88],
        unionedTags: ['beta', 'alpha', 'gamma'],
      },
    ]);

    // Vector search ran once (for the seed); B and C were claimed, never re-seeded.
    expect(vectorStore.search).toHaveBeenCalledTimes(1);
    expect(vectorStore.search).toHaveBeenCalledWith(
      a.embedding,
      { userId, organizationId: undefined, scope: undefined, type: MemoryType.LONG_TERM },
      20
    );

    // Three CAS writes: tag union on canonical + two loser supersedes, each
    // version-keyed with an increment (the G3-T3 protocol).
    expect(prisma.memory.update).toHaveBeenCalledTimes(3);
    const calls = prisma.memory.update.mock.calls.map(
      (call: [{ where: { id: string; version: number }; data: Record<string, unknown> }]) => call[0]
    );
    const tagCall = calls.find((call: { data: { tags?: unknown } }) => call.data.tags)!;
    expect(tagCall.where).toEqual({
      id: 'mem-b',
      userId,
      type: MemoryType.LONG_TERM,
      version: 3,
    });
    expect(tagCall.data.tags).toEqual(['beta', 'alpha', 'gamma']);
    expect(tagCall.data.version).toEqual({ increment: 1 });

    for (const loserId of ['mem-a', 'mem-c']) {
      const supersedeCall = calls.find(
        (call: { where: { id: string }; data: { metadata?: unknown } }) =>
          call.where.id === loserId && call.data.metadata
      )!;
      expect(supersedeCall.where.version).toBe(1);
      expect(supersedeCall.data.version).toEqual({ increment: 1 });
      // EXACTLY the write-time supersede markers (annotateSuperseded), so the
      // G3-T1 recall filter and get_memory behave identically.
      expect(supersedeCall.data.metadata).toEqual(
        expect.objectContaining({
          status: 'superseded',
          supersededBy: 'mem-b',
          supersededReason: expect.stringContaining('near-duplicate consolidation'),
          supersededAt: expect.any(String),
        })
      );
    }

    // One duplicate-of link per loser: source=loser, target=canonical, derived.
    expect(prisma.memoryLink.upsert).toHaveBeenCalledTimes(2);
    const linkCall = prisma.memoryLink.upsert.mock.calls[0][0];
    expect(linkCall.where).toEqual({
      sourceMemoryId_targetLocator_relType: {
        sourceMemoryId: 'mem-a',
        targetLocator: 'id:mem-b',
        relType: 'duplicate-of',
      },
    });
    expect(linkCall.create).toMatchObject({
      userId,
      organizationId: null,
      sourceMemoryId: 'mem-a',
      targetMemoryId: 'mem-b',
      relType: 'duplicate-of',
      origin: 'derived',
      score: 0.92,
    });

    // One system-actor supersede audit row per loser, restore-shaped snapshot.
    expect(prisma.memoryAudit.create).toHaveBeenCalledTimes(2);
    const audit = prisma.memoryAudit.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({
      memoryId: 'mem-a',
      userId,
      action: 'supersede',
      actorType: 'system',
      actorId: 'corpus_consolidation',
      actorLabel: null,
      delegated: false,
      after: {
        superseded: true,
        supersededBy: 'mem-b',
        supersededReason: expect.stringContaining('near-duplicate consolidation'),
      },
    });
    expect(audit.before).toEqual({
      content: 'content of mem-a',
      tags: ['alpha'],
      metadata: { importance: 0.4 },
      type: 'long-term',
      scope: null,
      expiresAt: null,
      version: 1,
    });
  });

  it('dry-run is the DEFAULT and mutates absolutely nothing', async () => {
    const a = row({ id: 'mem-a', tags: ['alpha'] });
    const b = row({ id: 'mem-b', metadata: { importance: 0.9 } });
    seedBatches([a, b]);
    vectorStore.search.mockResolvedValueOnce([{ id: 'mem-b', score: 0.9 }]);

    // No dryRun passed — the review gate must default it to TRUE.
    const result = await buildService().run();

    expect(result).toMatchObject({
      scanned: 2,
      clusters: 1,
      merged: 1,
      skippedConcurrentEdit: 0,
      dryRun: true,
    });
    expect(result.perCluster).toEqual([
      {
        canonicalId: 'mem-b',
        loserIds: ['mem-a'],
        scores: [0.9],
        unionedTags: ['alpha'],
      },
    ]);

    // ZERO writes of any kind.
    expect(prisma.memory.update).not.toHaveBeenCalled();
    expect(prisma.memory.create).not.toHaveBeenCalled();
    expect(prisma.memory.deleteMany).not.toHaveBeenCalled();
    expect(prisma.memoryLink.upsert).not.toHaveBeenCalled();
    expect(prisma.memoryAudit.create).not.toHaveBeenCalled();
  });

  it('is idempotent: a second run finds nothing because losers are now superseded', async () => {
    // State AFTER a real merge: A and C carry the supersede markers.
    const a = row({
      id: 'mem-a',
      metadata: { status: 'superseded', supersededBy: 'mem-b' },
    });
    const b = row({ id: 'mem-b', metadata: { importance: 0.9 }, tags: ['beta', 'alpha'] });
    const c = row({
      id: 'mem-c',
      // Decay may have rewritten status since — supersededBy is the durable marker.
      metadata: { status: 'active', supersededBy: 'mem-b' },
    });
    seedBatches([a, b, c]);
    // The vector index still contains all three (supersede does not unindex).
    vectorStore.search.mockResolvedValue([
      { id: 'mem-a', score: 0.92 },
      { id: 'mem-c', score: 0.88 },
    ]);

    const result = await buildService().run({ dryRun: false });

    // B was the only eligible seed; its in-band hits hydrate to superseded
    // rows, which are filtered out — no cluster forms, nothing is written.
    expect(result).toMatchObject({ scanned: 3, clusters: 0, merged: 0 });
    expect(prisma.memory.update).not.toHaveBeenCalled();
    expect(prisma.memoryLink.upsert).not.toHaveBeenCalled();
    expect(prisma.memoryAudit.create).not.toHaveBeenCalled();
  });

  it('resumes from a cursor and returns a non-null cursor when a limit stops the run early', async () => {
    const a = row({ id: 'mem-a' });
    const b = row({ id: 'mem-b' });
    seedBatches([a], [b]);

    const service = buildService();
    const first = await service.run({ limit: 1, batchSize: 1 });
    expect(first.scanned).toBe(1);
    expect(first.cursor).toBe('mem-a'); // resumable — corpus not exhausted

    const firstSeedPage = prisma.memory.findMany.mock.calls[0][0];
    expect(firstSeedPage.cursor).toBeUndefined();

    const second = await service.run({ cursor: first.cursor!, batchSize: 1 });
    const resumedPage = prisma.memory.findMany.mock.calls[1][0];
    expect(resumedPage).toMatchObject({ skip: 1, cursor: { id: 'mem-a' } });
    expect(second.scanned).toBe(1);
    expect(second.cursor).toBeNull(); // exhausted
  });

  it('never merges a contradiction-flagged pair (G3-T4 deliberately-kept rows)', async () => {
    const seed = row({ id: 'mem-a' });
    const flagged = row({
      id: 'mem-b',
      metadata: { status: 'contradicted', contradictionWith: 'mem-a' },
    });
    // A contradicted SEED is skipped outright too.
    const contradictedSeed = row({
      id: 'mem-c',
      metadata: { contradictionWith: 'mem-z', status: 'active' },
    });
    seedBatches([seed, flagged, contradictedSeed]);
    vectorStore.search.mockResolvedValue([{ id: 'mem-b', score: 0.9 }]);

    const result = await buildService().run({ dryRun: false });

    expect(result).toMatchObject({ scanned: 3, clusters: 0, merged: 0 });
    expect(prisma.memory.update).not.toHaveBeenCalled();
    // Only eligible seeds searched: mem-a and mem-b... mem-b is flagged, so
    // exactly ONE search (for mem-a); mem-c never reaches the vector store.
    expect(vectorStore.search).toHaveBeenCalledTimes(1);
  });

  it('skips gracefully over rows with no vector or embeddingExcluded', async () => {
    const noVector = row({ id: 'mem-a', embedding: [] });
    const excluded = row({ id: 'mem-b', metadata: { embeddingExcluded: true } });
    seedBatches([noVector, excluded]);

    const result = await buildService().run({ dryRun: false });

    expect(result).toMatchObject({ scanned: 2, clusters: 0, merged: 0 });
    expect(vectorStore.search).not.toHaveBeenCalled();
  });

  it('counts skippedConcurrentEdit when a loser CAS conflicts twice (retry-once-from-fresh)', async () => {
    const a = row({ id: 'mem-a', metadata: { importance: 0.9 }, version: 2 });
    const b = row({ id: 'mem-b', metadata: { importance: 0.1 }, version: 5 });
    seedBatches([a, b]);
    vectorStore.search.mockResolvedValueOnce([{ id: 'mem-b', score: 0.9 }]);
    // Every CAS write misses, as if a user keeps editing mem-b.
    prisma.memory.update.mockRejectedValue(p2025());
    // Fresh re-read: concurrent edit landed at v7 with user metadata.
    prisma.memory.findFirst.mockResolvedValue(
      row({ id: 'mem-b', version: 7, metadata: { importance: 0.1, userNote: 'kept' } })
    );

    const result = await buildService().run({ dryRun: false });

    expect(result).toMatchObject({ clusters: 1, merged: 0, skippedConcurrentEdit: 1 });
    // Exactly retry-once: two version-keyed attempts (v5 then the fresh v7).
    expect(prisma.memory.update).toHaveBeenCalledTimes(2);
    expect(prisma.memory.update.mock.calls[0][0].where.version).toBe(5);
    expect(prisma.memory.update.mock.calls[1][0].where.version).toBe(7);
    // The retry merged the marker into the FRESH metadata, not the stale copy.
    expect(prisma.memory.update.mock.calls[1][0].data.metadata).toEqual(
      expect.objectContaining({ userNote: 'kept', status: 'superseded', supersededBy: 'mem-a' })
    );
    // No link/audit for a skipped supersede.
    expect(prisma.memoryLink.upsert).not.toHaveBeenCalled();
    expect(prisma.memoryAudit.create).not.toHaveBeenCalled();
  });

  it('recomputes the tag union from the fresh canonical on a CAS miss', async () => {
    const a = row({ id: 'mem-a', metadata: { importance: 0.9 }, tags: ['alpha'], version: 2 });
    const b = row({ id: 'mem-b', metadata: { importance: 0.1 }, tags: ['beta'] });
    seedBatches([a, b]);
    vectorStore.search.mockResolvedValueOnce([{ id: 'mem-b', score: 0.9 }]);
    // First (tag-union) CAS misses; the fresh canonical gained a user tag at v4.
    prisma.memory.findFirst.mockResolvedValueOnce(
      row({ id: 'mem-a', metadata: { importance: 0.9 }, tags: ['alpha', 'user-tag'], version: 4 })
    );
    prisma.memory.update
      .mockRejectedValueOnce(p2025())
      .mockImplementation(
        async (args: {
          where: { id: string; version: number };
          data: Record<string, unknown>;
        }) => ({
          ...row({ id: args.where.id }),
          ...args.data,
          version: args.where.version + 1,
        })
      );

    const result = await buildService().run({ dryRun: false });

    expect(result).toMatchObject({ clusters: 1, merged: 1, skippedConcurrentEdit: 0 });
    const retry = prisma.memory.update.mock.calls[1][0];
    expect(retry.where).toMatchObject({ id: 'mem-a', version: 4 });
    // Union recomputed against the fresh tags — the concurrent tag survives.
    expect(retry.data.tags).toEqual(['alpha', 'user-tag', 'beta']);
  });

  it('elects the most recent row as canonical when importance ties', async () => {
    const older = row({
      id: 'mem-a',
      metadata: { importance: 0.5 },
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const newer = row({
      id: 'mem-b',
      metadata: { importance: 0.5 },
      createdAt: new Date(Date.now() - 1 * DAY_MS),
    });
    seedBatches([older, newer]);
    vectorStore.search.mockResolvedValueOnce([{ id: 'mem-b', score: 0.9 }]);

    const result = await buildService().run(); // dry-run default is fine here

    expect(result.perCluster[0]).toMatchObject({
      canonicalId: 'mem-b',
      loserIds: ['mem-a'],
    });
  });

  it('never clusters across scopes: hits carrying a different scope payload are dropped', async () => {
    const seed = row({ id: 'mem-a' }); // unscoped
    const scoped = row({ id: 'mem-b', scope: 'project:x' });
    seedBatches([seed, scoped]);
    // A misconfigured store returns the scoped row for the unscoped seed.
    vectorStore.search.mockResolvedValue([
      { id: 'mem-b', score: 0.9, payload: { scope: 'project:x' } },
    ]);

    const result = await buildService().run({ dryRun: false });

    // The scoped hit is dropped pre-hydration for the unscoped seed; the
    // scoped SEED then searches its own namespace and finds nothing new.
    expect(result).toMatchObject({ clusters: 0, merged: 0 });
    expect(prisma.memory.update).not.toHaveBeenCalled();
  });

  it('returns an empty summary when no vector store is configured', async () => {
    const service = new CorpusConsolidationService(
      prisma as never,
      new MemoryLtmService(prisma as never),
      new ContradictionDetectionService()
    );

    const result = await service.run({ dryRun: false });

    expect(result).toEqual({
      scanned: 0,
      clusters: 0,
      merged: 0,
      skippedConcurrentEdit: 0,
      cursor: null,
      dryRun: false,
      perCluster: [],
      perClusterTruncated: false,
    });
    expect(prisma.memory.findMany).not.toHaveBeenCalled();
  });
});
