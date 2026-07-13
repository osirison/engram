import { parseDocument } from '@engram/memory-interchange';
import { MemoryExportService, sanitizeMetadata } from './memory-export.service';
import type { ExportSink } from './export.types';

// ---- test doubles ---------------------------------------------------------

class InMemorySink implements ExportSink {
  readonly files = new Map<string, string>();
  writeFile(relativePath: string, content: string): void {
    this.files.set(relativePath, content);
  }
}

interface RawMemory {
  id: string;
  userId?: string;
  type?: 'long-term' | 'short-term';
  content?: string;
  tags?: string[];
  scope?: string | null;
  organizationId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: Date;
  updatedAt?: Date;
  expiresAt?: Date | null;
}

const ltmMem = (m: RawMemory): Record<string, unknown> => ({
  userId: 'qp',
  type: 'long-term',
  content: `Memory ${m.id}`,
  tags: [],
  scope: null,
  organizationId: null,
  metadata: null,
  createdAt: new Date('2026-06-01T10:00:00.000Z'),
  updatedAt: new Date('2026-06-01T10:00:00.000Z'),
  expiresAt: null,
  embedding: [],
  version: 1,
  ...m,
});

const stmMem = (m: RawMemory): Record<string, unknown> => ({
  ...ltmMem(m),
  type: 'short-term',
  expiresAt: new Date('2026-06-01T11:00:00.000Z'),
});

const page = (items: unknown[]) => ({
  items,
  totalCount: items.length,
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: undefined,
  endCursor: undefined,
});

const makeLtm = (items: unknown[] = []): { list: jest.Mock } => ({
  list: jest.fn().mockResolvedValue(page(items)),
});

const makeStm = (items: unknown[] = []): { list: jest.Mock } => {
  // STM SCAN: first call returns the page + resets the cursor to '0'.
  return {
    list: jest.fn().mockResolvedValue({ ...page(items), endCursor: '0' }),
  };
};

const auditRow = (action = 'update'): Record<string, unknown> => ({
  id: `aud-${action}`,
  action,
  actorType: 'api-key',
  actorLabel: null,
  delegated: false,
  before: { content: 'old content', version: 1 },
  after: { content: 'new content', version: 2 },
  createdAt: new Date('2026-06-02T10:00:00.000Z'),
});

/** Mock MemoryAuditService.list keyed by memoryId; unknown ids resolve to []. */
const makeAudit = (
  byId: Record<string, unknown[]> = {},
): { list: jest.Mock } => ({
  list: jest.fn((_userId: string, memoryId: string) => byId[memoryId] ?? []),
});

/** A `memory_links` row as the SHARED-1 seam selects it. */
interface RawLinkRow {
  sourceMemoryId: string;
  targetMemoryId: string | null;
  targetLocator: string;
  relType: string;
  origin: string;
  score: number | null;
  note: string | null;
}

const linkRow = (row: Partial<RawLinkRow> = {}): RawLinkRow => ({
  sourceMemoryId: 'claaa1',
  targetMemoryId: 'clbbb2',
  targetLocator: 'id:clbbb2',
  relType: 'relates-to',
  origin: 'authored',
  score: null,
  note: null,
  ...row,
});

/** Mock PrismaService exposing only the seam's `memoryLink.findMany`. */
const makePrisma = (
  rows: RawLinkRow[] = [],
): { memoryLink: { findMany: jest.Mock } } => ({
  memoryLink: { findMany: jest.fn().mockResolvedValue(rows) },
});

const svc = (
  ltm: unknown,
  stm?: unknown,
  audit?: unknown,
  prisma?: unknown,
): MemoryExportService =>
  new MemoryExportService(
    ltm as never,
    stm as never,
    audit as never,
    prisma as never,
  );

// ---- tests ----------------------------------------------------------------

describe('MemoryExportService.export (multi mode)', () => {
  it('writes one file per memory plus index.md and manifest.json', async () => {
    const ltm = makeLtm([ltmMem({ id: 'claaa1' }), ltmMem({ id: 'clbbb2' })]);
    const sink = new InMemorySink();
    const result = await svc(ltm).export(
      { userId: 'qp', deterministic: true },
      sink,
    );

    const paths = [...sink.files.keys()].sort();
    expect(paths).toEqual([
      'index.md',
      'manifest.json',
      'memories/memory-claaa1--claaa1.md',
      'memories/memory-clbbb2--clbbb2.md',
    ]);
    expect(result.fileCount).toBe(2);
    expect(sink.files.get('index.md')).toContain('[[claaa1|Memory claaa1]]');
    const manifest = JSON.parse(sink.files.get('manifest.json') as string);
    expect(manifest.counts).toMatchObject({
      total: 2,
      longTerm: 2,
      shortTerm: 0,
      files: 2,
      failed: 0,
    });
    expect(manifest.exportedAt).toBeUndefined(); // deterministic
    expect(manifest.notes.join(' ')).toContain('reindex');
  });

  it('produces byte-identical output across runs when deterministic', async () => {
    const items = [ltmMem({ id: 'clddd4' }), ltmMem({ id: 'clccc3' })];
    const a = new InMemorySink();
    const b = new InMemorySink();
    await svc(makeLtm(items)).export({ userId: 'qp', deterministic: true }, a);
    await svc(makeLtm(items)).export({ userId: 'qp', deterministic: true }, b);
    expect([...a.files.entries()].sort()).toEqual(
      [...b.files.entries()].sort(),
    );
  });

  it('emits edges in exported files and flags dangling targets in the manifest', async () => {
    const ltm = makeLtm([
      ltmMem({
        id: 'claaa1',
        metadata: { duplicateMatches: [{ memoryId: 'clbbb2', score: 0.9 }] },
      }),
      ltmMem({ id: 'clbbb2' }),
      ltmMem({
        id: 'clxxx9',
        metadata: { duplicateMatches: [{ memoryId: 'clGONE', score: 0.8 }] },
      }),
    ]);
    const sink = new InMemorySink();
    await svc(ltm).export({ userId: 'qp', deterministic: true }, sink);

    const a = parseDocument(
      sink.files.get('memories/memory-claaa1--claaa1.md') as string,
    );
    expect(a.frontmatter.links).toContainEqual({
      rel: 'duplicate-of',
      target: 'clbbb2',
      origin: 'derived',
      score: 0.9,
    });
    const x = sink.files.get('memories/memory-clxxx9--clxxx9.md') as string;
    expect(x).toContain('clGONE');
    expect(x).toContain('(not in export)');
    expect(x).not.toContain('[[clGONE'); // dangling ⇒ plain text, no phantom note
    const manifest = JSON.parse(sink.files.get('manifest.json') as string);
    expect(manifest.danglingTargets).toEqual(['clGONE']);
  });
});

describe('MemoryExportService MemoryLink seam (SHARED-1)', () => {
  const links = (sink: InMemorySink, id: string): unknown[] =>
    parseDocument(sink.files.get(`memories/memory-${id}--${id}.md`) as string)
      .frontmatter.links;

  it('emits first-class MemoryLink edges (authored ⇒ durable) plus in-set inverses', async () => {
    const ltm = makeLtm([ltmMem({ id: 'claaa1' }), ltmMem({ id: 'clbbb2' })]);
    const prisma = makePrisma([linkRow({ score: 0.7, note: 'authored link' })]);
    const sink = new InMemorySink();
    await svc(ltm, undefined, undefined, prisma).export(
      { userId: 'qp', deterministic: true },
      sink,
    );

    expect(links(sink, 'claaa1')).toContainEqual({
      rel: 'relates-to',
      target: 'clbbb2',
      origin: 'durable',
      score: 0.7,
      note: 'authored link',
    });
    // Inverse on the in-set target (relates-to is its own inverse).
    expect(links(sink, 'clbbb2')).toContainEqual({
      rel: 'relates-to',
      target: 'claaa1',
      origin: 'durable',
      score: 0.7,
    });
  });

  it('queries both directions, scoped to the exporting user (isolation)', async () => {
    const ltm = makeLtm([ltmMem({ id: 'claaa1' }), ltmMem({ id: 'clbbb2' })]);
    const prisma = makePrisma();
    const sink = new InMemorySink();
    await svc(ltm, undefined, undefined, prisma).export(
      { userId: 'qp', deterministic: true },
      sink,
    );

    expect(prisma.memoryLink.findMany).toHaveBeenCalledTimes(1);
    const args = prisma.memoryLink.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toEqual({
      userId: 'qp',
      OR: [
        { sourceMemoryId: { in: ['claaa1', 'clbbb2'] } },
        { targetMemoryId: { in: ['claaa1', 'clbbb2'] } },
      ],
    });
  });

  it('dedupes a MemoryLink against the same metadata-derived edge, merging annotations', async () => {
    const ltm = makeLtm([
      ltmMem({
        id: 'claaa1',
        metadata: { duplicateMatches: [{ memoryId: 'clbbb2', score: 0.9 }] },
      }),
      ltmMem({ id: 'clbbb2' }),
    ]);
    // Same (rel, target) as the metadata edge — e.g. corpus consolidation wrote
    // a first-class row alongside the legacy annotation.
    const prisma = makePrisma([
      linkRow({
        relType: 'duplicate-of',
        origin: 'derived',
        note: 'consolidated',
      }),
    ]);
    const sink = new InMemorySink();
    await svc(ltm, undefined, undefined, prisma).export(
      { userId: 'qp', deterministic: true },
      sink,
    );

    const duplicateEdges = (
      links(sink, 'claaa1') as Array<{ rel: string }>
    ).filter((e) => e.rel === 'duplicate-of');
    expect(duplicateEdges).toEqual([
      {
        rel: 'duplicate-of',
        target: 'clbbb2',
        origin: 'derived',
        score: 0.9, // from the metadata edge
        note: 'consolidated', // from the MemoryLink row
      },
    ]);
  });

  it('drops out-of-set sources and flags out-of-set targets dangling (locator fallback)', async () => {
    const ltm = makeLtm([ltmMem({ id: 'claaa1' })]);
    const prisma = makePrisma([
      // Source not exported ⇒ nothing to attach the edge to.
      linkRow({
        sourceMemoryId: 'clzzz9',
        targetMemoryId: 'claaa1',
        targetLocator: 'id:claaa1',
      }),
      // Unresolved target (NULL id) ⇒ falls back to the locator, dangling.
      linkRow({
        sourceMemoryId: 'claaa1',
        targetMemoryId: null,
        targetLocator: 'id:clGONE',
      }),
    ]);
    const sink = new InMemorySink();
    await svc(ltm, undefined, undefined, prisma).export(
      { userId: 'qp', deterministic: true },
      sink,
    );

    expect(links(sink, 'claaa1')).toEqual([
      {
        rel: 'relates-to',
        target: 'clGONE',
        origin: 'durable',
        dangling: true,
      },
    ]);
    const manifest = JSON.parse(sink.files.get('manifest.json') as string);
    expect(manifest.danglingTargets).toEqual(['clGONE']);
  });

  it('chunks large id sets and dedupes a row fetched via both directions', async () => {
    // 250 ids ⇒ two 200-id chunks. The single link's source sorts into chunk 1
    // and its target into chunk 2, so both queries return the same row.
    const ids = Array.from(
      { length: 250 },
      (_, i) => `clm${String(i).padStart(4, '0')}`,
    );
    const ltm = makeLtm(ids.map((id) => ltmMem({ id })));
    const row = linkRow({
      sourceMemoryId: ids[0] as string,
      targetMemoryId: ids[249] as string,
      targetLocator: `id:${ids[249] as string}`,
    });
    const prisma = makePrisma([row]);
    const sink = new InMemorySink();
    await svc(ltm, undefined, undefined, prisma).export(
      { userId: 'qp', deterministic: true },
      sink,
    );

    expect(prisma.memoryLink.findMany).toHaveBeenCalledTimes(2);
    expect(links(sink, ids[0] as string)).toEqual([
      {
        rel: 'relates-to',
        target: ids[249],
        origin: 'durable',
      },
    ]);
  });

  it('exports metadata edges only when Postgres is not wired (no prisma)', async () => {
    const ltm = makeLtm([
      ltmMem({
        id: 'claaa1',
        metadata: { duplicateMatches: [{ memoryId: 'clbbb2', score: 0.9 }] },
      }),
      ltmMem({ id: 'clbbb2' }),
    ]);
    const sink = new InMemorySink();
    await svc(ltm).export({ userId: 'qp', deterministic: true }, sink);
    expect(links(sink, 'claaa1')).toContainEqual({
      rel: 'duplicate-of',
      target: 'clbbb2',
      origin: 'derived',
      score: 0.9,
    });
  });
});

describe('MemoryExportService STM policy', () => {
  it('excludes STM by default and never calls the STM service', async () => {
    const ltm = makeLtm([ltmMem({ id: 'claaa1' })]);
    const stm = makeStm([stmMem({ id: 'clstm1' })]);
    const sink = new InMemorySink();
    const result = await svc(ltm, stm).export(
      { userId: 'qp', deterministic: true },
      sink,
    );
    expect(stm.list).not.toHaveBeenCalled();
    expect(result.manifest.counts.shortTerm).toBe(0);
  });

  it('includes STM when includeStm is set, tagging TTL non-preservation', async () => {
    const ltm = makeLtm([ltmMem({ id: 'claaa1' })]);
    const stm = makeStm([stmMem({ id: 'clstm1' })]);
    const sink = new InMemorySink();
    const result = await svc(ltm, stm).export(
      { userId: 'qp', includeStm: true, deterministic: true },
      sink,
    );
    expect(stm.list).toHaveBeenCalledTimes(1);
    expect(result.manifest.counts.shortTerm).toBe(1);
    expect(sink.files.has('memories/memory-clstm1--clstm1.md')).toBe(true);
    const doc = sink.files.get('memories/memory-clstm1--clstm1.md') as string;
    expect(doc).toContain('type: short-term');
    expect(doc).toContain('expiresAt:');
    expect(result.manifest.notes.join(' ')).toContain('TTL');
  });
});

describe('MemoryExportService resilience + sanitization', () => {
  it('counts and skips a memory that fails to serialize, never aborting', async () => {
    const broken = ltmMem({ id: 'clbroke' });
    (broken as { createdAt: unknown }).createdAt = null; // toISOString() throws
    const ltm = makeLtm([ltmMem({ id: 'claaa1' }), broken]);
    const sink = new InMemorySink();
    const result = await svc(ltm).export(
      { userId: 'qp', deterministic: true },
      sink,
    );
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.id).toBe('clbroke');
    expect(sink.files.has('memories/memory-claaa1--claaa1.md')).toBe(true);
    const manifest = JSON.parse(sink.files.get('manifest.json') as string);
    expect(manifest.counts.failed).toBe(1);
    expect(manifest.failedIds).toEqual(['clbroke']);
  });

  it('single mode writes one memories.md and no per-memory files', async () => {
    const ltm = makeLtm([ltmMem({ id: 'claaa1' }), ltmMem({ id: 'clbbb2' })]);
    const sink = new InMemorySink();
    const result = await svc(ltm).export(
      { userId: 'qp', mode: 'single', deterministic: true },
      sink,
    );
    expect([...sink.files.keys()].sort()).toEqual([
      'manifest.json',
      'memories.md',
    ]);
    expect(result.fileCount).toBe(1);
    const doc = sink.files.get('memories.md') as string;
    expect(doc).toContain('<a id="mem-claaa1"></a>');
    expect(doc).toContain('<a id="mem-clbbb2"></a>');
  });
});

describe('MemoryExportService history sidecars (G5)', () => {
  it('omits _history sidecars and the historyFiles count by default', async () => {
    const ltm = makeLtm([ltmMem({ id: 'claaa1' })]);
    const audit = makeAudit({ claaa1: [auditRow()] });
    const sink = new InMemorySink();
    await svc(ltm, undefined, audit).export(
      { userId: 'qp', deterministic: true },
      sink,
    );
    // Default: the audit trail is never read and no sidecar is written.
    expect(audit.list).not.toHaveBeenCalled();
    expect([...sink.files.keys()].some((p) => p.startsWith('_history/'))).toBe(
      false,
    );
    const manifest = JSON.parse(sink.files.get('manifest.json') as string);
    expect(manifest.counts.historyFiles).toBeUndefined();
  });

  it('writes _history/<id>.json for memories with audit rows when includeHistory', async () => {
    const ltm = makeLtm([ltmMem({ id: 'claaa1' }), ltmMem({ id: 'clbbb2' })]);
    const audit = makeAudit({
      claaa1: [auditRow('update'), auditRow('delete')],
      clbbb2: [], // no history ⇒ no sidecar
    });
    const sink = new InMemorySink();
    const result = await svc(ltm, undefined, audit).export(
      { userId: 'qp', includeHistory: true, deterministic: true },
      sink,
    );
    expect(sink.files.has('_history/claaa1.json')).toBe(true);
    expect(sink.files.has('_history/clbbb2.json')).toBe(false); // empty ⇒ skipped
    const sidecar = JSON.parse(
      sink.files.get('_history/claaa1.json') as string,
    );
    expect(sidecar.memoryId).toBe('claaa1');
    expect(sidecar.entries).toHaveLength(2);
    expect(sidecar.entries[0].action).toBe('update');
    expect(result.manifest.counts.historyFiles).toBe(1);
    expect(result.manifest.notes.join(' ')).toContain('Audit history');
  });

  it('gracefully skips history when the audit service is unavailable', async () => {
    const ltm = makeLtm([ltmMem({ id: 'claaa1' })]);
    const sink = new InMemorySink();
    const result = await svc(ltm, undefined, undefined).export(
      { userId: 'qp', includeHistory: true, deterministic: true },
      sink,
    );
    expect([...sink.files.keys()].some((p) => p.startsWith('_history/'))).toBe(
      false,
    );
    expect(result.manifest.counts.historyFiles).toBe(0);
  });

  it('skips a memory whose history read throws, still writing the others', async () => {
    const ltm = makeLtm([ltmMem({ id: 'claaa1' }), ltmMem({ id: 'clbbb2' })]);
    const audit = {
      list: jest.fn((_userId: string, memoryId: string) => {
        if (memoryId === 'claaa1') throw new Error('audit read failed');
        return [auditRow()];
      }),
    };
    const sink = new InMemorySink();
    const result = await svc(ltm, undefined, audit).export(
      { userId: 'qp', includeHistory: true, deterministic: true },
      sink,
    );
    expect(sink.files.has('_history/claaa1.json')).toBe(false); // threw ⇒ skipped
    expect(sink.files.has('_history/clbbb2.json')).toBe(true);
    expect(result.manifest.counts.historyFiles).toBe(1);
    // The memory files themselves are unaffected by a history failure.
    expect(sink.files.has('memories/memory-claaa1--claaa1.md')).toBe(true);
  });
});

describe('sanitizeMetadata', () => {
  it('strips relationship + volatile keys, keeps custom keys', () => {
    expect(
      sanitizeMetadata({
        source: 'notes',
        importance: 5,
        duplicateMatches: [{ memoryId: 'x' }],
        insightId: 'i',
        status: 'superseded',
        pinned: true,
      }),
    ).toEqual({ source: 'notes' });
  });

  it('returns undefined when nothing survives', () => {
    expect(sanitizeMetadata({ importance: 1, accessCount: 2 })).toBeUndefined();
    expect(sanitizeMetadata(null)).toBeUndefined();
  });
});
