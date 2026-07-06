/* eslint-disable @typescript-eslint/no-explicit-any -- mock call-arg assertions */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LinkResolver, type ResolverFact } from './link-resolver.service.js';

/** Minimal in-memory prisma double capturing memoryLink writes. */
function makePrisma(
  opts: { existingMemoryIds?: string[]; deferredRows?: Record<string, unknown>[] } = {}
) {
  const existing = new Set(opts.existingMemoryIds ?? []);
  const upserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const deletes: Record<string, unknown>[] = [];
  const prisma = {
    memory: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        existing.has(where.id) ? { id: where.id } : null
      ),
    },
    memoryLink: {
      upsert: vi.fn(async (arg: Record<string, unknown>) => {
        upserts.push(arg);
        return { id: 'link-x' };
      }),
      findMany: vi.fn(async () => opts.deferredRows ?? []),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async (arg: Record<string, unknown>) => {
        updates.push(arg);
        return {};
      }),
      delete: vi.fn(async (arg: Record<string, unknown>) => {
        deletes.push(arg);
        return {};
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return { prisma, upserts, updates, deletes };
}

const link = (over: Partial<Record<string, unknown>>) => ({
  kind: 'wikilink',
  rawTarget: 'x',
  targetLocator: 'slug:x',
  relType: 'relates-to',
  ...over,
});

describe('LinkResolver.resolveBatch', () => {
  let ledger: { listByUser: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    ledger = { listByUser: vi.fn(async () => []) };
  });

  function resolver(prisma: unknown) {
    return new LinkResolver(prisma as any, ledger as any);
  }

  it('Pass A: resolves an intra-batch link to id: with the target memoryId', async () => {
    const { prisma, upserts } = makePrisma();
    const facts: ResolverFact[] = [
      {
        memoryId: 'A',
        sourceTool: 'markdown',
        sourcePath: 'a.md',
        links: [link({ rawTarget: 'b', targetLocator: 'slug:b' })],
      },
      { memoryId: 'B', sourceTool: 'markdown', sourcePath: 'b.md', links: [] },
    ];
    const summary = await resolver(prisma).resolveBatch({
      userId: 'qp',
      importBatchId: 'batch1',
      facts,
    });
    expect(summary).toEqual({ resolved: 1, deferred: 0, total: 1 });
    const call = upserts[0]!;
    expect((call.where as any).sourceMemoryId_targetLocator_relType.targetLocator).toBe('id:B');
    expect((call.create as any).targetMemoryId).toBe('B');
    expect((call.create as any).origin).toBe('authored');
    expect((call.create as any).metadata.originalLocator).toBe('slug:b');
  });

  it('deferred: persists a null-target row keyed on the source-derived locator', async () => {
    const { prisma, upserts } = makePrisma();
    const facts: ResolverFact[] = [
      {
        memoryId: 'A',
        sourceTool: 'markdown',
        sourcePath: 'a.md',
        links: [link({ rawTarget: 'missing', targetLocator: 'slug:missing' })],
      },
    ];
    const summary = await resolver(prisma).resolveBatch({
      userId: 'qp',
      importBatchId: 'b',
      facts,
    });
    expect(summary).toEqual({ resolved: 0, deferred: 1, total: 1 });
    const call = upserts[0]!;
    expect((call.where as any).sourceMemoryId_targetLocator_relType.targetLocator).toBe(
      'slug:missing'
    );
    expect((call.create as any).targetMemoryId).toBeNull();
  });

  it('Pass B: resolves a link against a prior-run ledger entry (by filename stem)', async () => {
    const { prisma, upserts } = makePrisma();
    ledger.listByUser.mockResolvedValue([
      {
        memoryId: 'P',
        sourceTool: 'markdown',
        sourcePath: 'notes/prior.md',
        sourceKey: 'markdown:notes/prior.md',
        contentHash: 'h',
        importBatchId: 'old',
        importedAt: new Date(),
        updatedAt: new Date(),
        id: 'l',
        userId: 'qp',
      },
    ]);
    const facts: ResolverFact[] = [
      {
        memoryId: 'A',
        sourceTool: 'markdown',
        sourcePath: 'a.md',
        links: [link({ rawTarget: 'prior', targetLocator: 'slug:prior' })],
      },
    ];
    const summary = await resolver(prisma).resolveBatch({
      userId: 'qp',
      importBatchId: 'b',
      facts,
    });
    expect(summary.resolved).toBe(1);
    expect((upserts[0]!.create as any).targetMemoryId).toBe('P');
  });

  it('resolves an id: locator via an existing (manually-created) memory', async () => {
    const { prisma, upserts } = makePrisma({ existingMemoryIds: ['EXT'] });
    const facts: ResolverFact[] = [
      {
        memoryId: 'A',
        sourceTool: 'markdown',
        sourcePath: 'a.md',
        links: [link({ kind: 'frontmatter-ref', rawTarget: 'EXT', targetLocator: 'id:EXT' })],
      },
    ];
    const summary = await resolver(prisma).resolveBatch({
      userId: 'qp',
      importBatchId: 'b',
      facts,
    });
    expect(summary.resolved).toBe(1);
    expect((upserts[0]!.create as any).targetMemoryId).toBe('EXT');
    expect(prisma.memory.findFirst).toHaveBeenCalled();
  });

  it('never self-links a fact whose locator resolves to itself', async () => {
    const { prisma, upserts } = makePrisma();
    // A's own filename stem is 'self'; a wikilink [[self]] would resolve to A.
    const facts: ResolverFact[] = [
      {
        memoryId: 'A',
        sourceTool: 'markdown',
        sourcePath: 'self.md',
        links: [link({ rawTarget: 'self', targetLocator: 'slug:self' })],
      },
    ];
    const summary = await resolver(prisma).resolveBatch({
      userId: 'qp',
      importBatchId: 'b',
      facts,
    });
    expect(summary.deferred).toBe(1); // self-resolution suppressed → stays deferred
    expect((upserts[0]!.create as any).targetMemoryId).toBeNull();
  });
});

describe('LinkResolver.resolveDeferred', () => {
  it('fills a prior null-target row when its target is now imported', async () => {
    const { prisma, updates } = makePrisma({
      deferredRows: [
        {
          id: 'L1',
          sourceMemoryId: 'A',
          relType: 'relates-to',
          targetLocator: 'slug:later',
          targetMemoryId: null,
          metadata: { originalLocator: 'slug:later' },
        },
      ],
    });
    const ledger = {
      listByUser: vi.fn(async () => [
        {
          memoryId: 'Z',
          sourceTool: 'markdown',
          sourcePath: 'later.md',
          sourceKey: 'markdown:later.md',
          contentHash: 'h',
          importBatchId: 'b',
          importedAt: new Date(),
          updatedAt: new Date(),
          id: 'l',
          userId: 'qp',
        },
      ]),
    };
    const filled = await new LinkResolver(prisma as any, ledger as any).resolveDeferred('qp');
    expect(filled).toBe(1);
    expect(updates[0]!.data as any).toMatchObject({ targetMemoryId: 'Z', targetLocator: 'id:Z' });
  });

  it('returns 0 when there are no deferred rows', async () => {
    const { prisma } = makePrisma({ deferredRows: [] });
    const ledger = { listByUser: vi.fn(async () => []) };
    expect(await new LinkResolver(prisma as any, ledger as any).resolveDeferred('qp')).toBe(0);
  });
});
