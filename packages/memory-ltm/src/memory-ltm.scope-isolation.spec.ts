import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryLtmService } from './memory-ltm.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { ContradictionDetectionService } from './contradiction-detection.service';
import { MemoryType } from '@engram/database';
import type { VectorStore } from '@engram/vector-store';

/**
 * Regression coverage for cross-scope leaks in the LTM create/promote paths:
 *  - exact-content dedup ({@link MemoryLtmService} findExactDuplicate)
 *  - semantic dedup (findDuplicate)
 *  - contradiction / supersession (findContradictionCandidate)
 *
 * An unscoped write must never collapse into — or supersede — a scoped memory,
 * and a scoped write must stay inside its own namespace.
 */

const USER = 'cldx4k8xp000108l83h4y8v2q';
const SCOPE_A = 'agent:alpha';

type Row = {
  id: string;
  userId: string;
  organizationId: string | null;
  scope: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  tags: string[];
  type: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: null;
  embedding: number[];
};

function makeRow(overrides: Partial<Row>): Row {
  return {
    id: 'row-1',
    userId: USER,
    organizationId: null,
    scope: null,
    content: 'content',
    metadata: null,
    tags: [],
    type: MemoryType.LONG_TERM,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: null,
    embedding: [0.1, 0.2, 0.3],
    ...overrides,
  };
}

/**
 * Faithful Prisma `where` matcher: a `scope` key set to `null` means "scope IS
 * NULL" (only unscoped rows), a string means that exact scope, and an absent
 * key means no scope constraint — exactly how Prisma treats it.
 */
function whereMatches(row: Row, where: Record<string, unknown>): boolean {
  if (where.userId && row.userId !== where.userId) return false;
  if (where.type && row.type !== where.type) return false;
  if (where.content !== undefined && row.content !== where.content) return false;
  if ('scope' in where && row.scope !== (where.scope ?? null)) return false;
  if (where.id) {
    if (typeof where.id === 'object' && where.id !== null && 'in' in where.id) {
      if (!(where.id as { in: string[] }).in.includes(row.id)) return false;
    } else if (row.id !== where.id) {
      return false;
    }
  }
  return true;
}

describe('MemoryLtmService — create/promote scope isolation', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let db: Row[];

  function buildPrisma(rows: Row[]): Record<string, unknown> {
    db = rows;
    return {
      memory: {
        findFirst: vi.fn(({ where }) =>
          Promise.resolve(db.find((r) => whereMatches(r, where)) ?? null)
        ),
        findMany: vi.fn(({ where }) => Promise.resolve(db.filter((r) => whereMatches(r, where)))),
        create: vi.fn(({ data }: { data: Partial<Row> }) =>
          Promise.resolve(makeRow({ ...data, id: 'row-new' }))
        ),
        update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(makeRow({ id: 'row-existing', ...data }))
        ),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn(),
    };
  }

  const embeddings = {
    generate: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
  };

  function makeVectorStore(
    hits: Array<{ id: string; score: number; payload?: Record<string, unknown> }>
  ): Record<string, unknown> {
    return {
      backend: 'qdrant',
      ensureReady: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue(hits),
    } as unknown as VectorStore & {
      search: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    embeddings.generate.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
  });

  // ── #4 exact-content dedup ────────────────────────────────────────────────
  describe('exact-content dedup (findExactDuplicate)', () => {
    it('an unscoped create does NOT dedup against a scoped memory with identical content', async () => {
      prisma = buildPrisma([makeRow({ id: 'scoped', scope: SCOPE_A, content: 'shared text' })]);
      const service = new MemoryLtmService(prisma);

      const result = await service.create({ userId: USER, content: 'shared text' });

      // A brand-new unscoped row is written rather than returning the scoped one.
      expect(prisma.memory.create).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('row-new');
      // The dedup probe constrained scope to NULL (unscoped only).
      expect(prisma.memory.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ content: 'shared text', scope: null }),
      });
    });

    it('a scoped create does NOT dedup against an unscoped memory with identical content', async () => {
      prisma = buildPrisma([makeRow({ id: 'unscoped', scope: null, content: 'shared text' })]);
      const service = new MemoryLtmService(prisma);

      const result = await service.create({ userId: USER, scope: SCOPE_A, content: 'shared text' });

      expect(prisma.memory.create).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('row-new');
      expect(prisma.memory.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ content: 'shared text', scope: SCOPE_A }),
      });
    });

    it('a scoped create DOES dedup against a same-scope memory with identical content', async () => {
      prisma = buildPrisma([makeRow({ id: 'same-scope', scope: SCOPE_A, content: 'shared text' })]);
      const service = new MemoryLtmService(prisma);

      const result = await service.create({ userId: USER, scope: SCOPE_A, content: 'shared text' });

      // Existing row returned; no new write.
      expect(prisma.memory.create).not.toHaveBeenCalled();
      expect(result.id).toBe('same-scope');
    });

    it('an unscoped create DOES dedup against an unscoped memory with identical content', async () => {
      prisma = buildPrisma([makeRow({ id: 'unscoped', scope: null, content: 'shared text' })]);
      const service = new MemoryLtmService(prisma);

      const result = await service.create({ userId: USER, content: 'shared text' });

      expect(prisma.memory.create).not.toHaveBeenCalled();
      expect(result.id).toBe('unscoped');
    });
  });

  // ── #6 semantic dedup ─────────────────────────────────────────────────────
  describe('semantic dedup (findDuplicate)', () => {
    it('passes the create scope into the vector-store search filter', async () => {
      prisma = buildPrisma([]);
      const vectorStore = makeVectorStore([]);
      const service = new MemoryLtmService(
        prisma,
        undefined,
        embeddings as never,
        vectorStore,
        undefined,
        new DuplicateDetectionService()
      );

      await service.create({ userId: USER, scope: SCOPE_A, content: 'new fact' });

      expect(vectorStore.search).toHaveBeenCalledWith(
        [0.1, 0.2, 0.3],
        expect.objectContaining({ scope: SCOPE_A, type: MemoryType.LONG_TERM }),
        expect.any(Number)
      );
    });

    it('drops a cross-scope vector hit so an unscoped create is not deduped against a scoped memory', async () => {
      prisma = buildPrisma([makeRow({ id: 'scoped', scope: SCOPE_A, content: 'similar' })]);
      // A near-identical hit, but it belongs to SCOPE_A.
      const vectorStore = makeVectorStore([
        { id: 'scoped', score: 0.999, payload: { userId: USER, scope: SCOPE_A } },
      ]);
      const service = new MemoryLtmService(
        prisma,
        undefined,
        embeddings as never,
        vectorStore,
        undefined,
        new DuplicateDetectionService()
      );

      const result = await service.create({ userId: USER, content: 'similar' });

      // Not deduped: a fresh unscoped row is written, the scoped one is untouched.
      expect(prisma.memory.create).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('row-new');
    });

    it('dedups against a same-scope vector hit', async () => {
      prisma = buildPrisma([makeRow({ id: 'row-existing', scope: SCOPE_A, content: 'similar' })]);
      const vectorStore = makeVectorStore([
        { id: 'row-existing', score: 0.999, payload: { userId: USER, scope: SCOPE_A } },
      ]);
      const service = new MemoryLtmService(
        prisma,
        undefined,
        embeddings as never,
        vectorStore,
        undefined,
        new DuplicateDetectionService()
      );

      const result = await service.create({ userId: USER, scope: SCOPE_A, content: 'similar' });

      // Linked to the existing row (annotated via update), no new row created.
      expect(prisma.memory.create).not.toHaveBeenCalled();
      expect(result.id).toBe('row-existing');
    });
  });

  // ── #7 contradiction / supersession ───────────────────────────────────────
  describe('contradiction detection (findContradictionCandidate)', () => {
    it('confines the candidate content query to the create scope', async () => {
      prisma = buildPrisma([]);
      const vectorStore = makeVectorStore([{ id: 'other', score: 0.5, payload: { userId: USER } }]);
      const service = new MemoryLtmService(
        prisma,
        undefined,
        embeddings as never,
        vectorStore,
        undefined,
        new DuplicateDetectionService(),
        undefined,
        new ContradictionDetectionService()
      );

      await service.create({ userId: USER, scope: SCOPE_A, content: 'the sky is green' });

      // The content-hydration query for contradiction candidates is scoped.
      const scopedFindMany = prisma.memory.findMany.mock.calls.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call: any) => call[0]?.where && 'id' in call[0].where && call[0].where.id?.in
      );
      expect(scopedFindMany).toBeDefined();
      expect(scopedFindMany![0].where.scope).toBe(SCOPE_A);
    });

    it('uses scope IS NULL for the candidate content query on an unscoped create', async () => {
      prisma = buildPrisma([]);
      const vectorStore = makeVectorStore([{ id: 'other', score: 0.5, payload: { userId: USER } }]);
      const service = new MemoryLtmService(
        prisma,
        undefined,
        embeddings as never,
        vectorStore,
        undefined,
        new DuplicateDetectionService(),
        undefined,
        new ContradictionDetectionService()
      );

      await service.create({ userId: USER, content: 'the sky is green' });

      const scopedFindMany = prisma.memory.findMany.mock.calls.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call: any) => call[0]?.where && 'id' in call[0].where && call[0].where.id?.in
      );
      expect(scopedFindMany).toBeDefined();
      expect(scopedFindMany![0].where.scope).toBeNull();
    });
  });
});
