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

const svc = (ltm: unknown, stm?: unknown): MemoryExportService =>
  new MemoryExportService(ltm as never, stm as never);

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
