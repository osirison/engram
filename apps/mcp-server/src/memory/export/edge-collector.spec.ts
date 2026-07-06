import type { MemoryEdge } from '@engram/memory-interchange';
import {
  collectEdges,
  type CollectableMemory,
  type CollectableMemoryLink,
} from './edge-collector';

const mem = (
  id: string,
  metadata?: Record<string, unknown> | null,
): CollectableMemory => ({
  id,
  metadata: metadata ?? null,
});

const edgesOf = (
  result: ReturnType<typeof collectEdges>,
  id: string,
): MemoryEdge[] => result.byMemory.get(id) ?? [];

const find = (
  edges: MemoryEdge[],
  rel: string,
  target: string,
): MemoryEdge | undefined =>
  edges.find((e) => e.rel === rel && e.target === target);

describe('collectEdges — metadata edge kinds', () => {
  it('duplicate-of (derived) with symmetric inverse and score', () => {
    const res = collectEdges([
      mem('A', {
        duplicateMatches: [{ memoryId: 'B', score: 0.97, detectedAt: 'x' }],
      }),
      mem('B'),
    ]);
    expect(find(edgesOf(res, 'A'), 'duplicate-of', 'B')).toEqual({
      rel: 'duplicate-of',
      target: 'B',
      origin: 'derived',
      score: 0.97,
    });
    expect(find(edgesOf(res, 'B'), 'duplicate-of', 'A')).toEqual({
      rel: 'duplicate-of',
      target: 'A',
      origin: 'derived',
      score: 0.97,
    });
    expect(res.danglingTargets).toEqual([]);
  });

  it('contradicts (derived) carries reason as note on the direct edge only', () => {
    const res = collectEdges([
      mem('A', {
        contradictionMatches: [
          { memoryId: 'B', score: 0.6, reason: 'negates prior claim' },
        ],
      }),
      mem('B'),
    ]);
    expect(find(edgesOf(res, 'A'), 'contradicts', 'B')).toEqual({
      rel: 'contradicts',
      target: 'B',
      origin: 'derived',
      score: 0.6,
      note: 'negates prior claim',
    });
    const inverse = find(edgesOf(res, 'B'), 'contradicts', 'A');
    expect(inverse).toMatchObject({
      rel: 'contradicts',
      target: 'A',
      origin: 'derived',
      score: 0.6,
    });
    expect(inverse?.note).toBeUndefined();
  });

  it('superseded-by (derived) on old memory ⇒ supersedes on new memory', () => {
    const res = collectEdges([
      mem('OLD', {
        status: 'superseded',
        supersededBy: 'NEW',
        supersededReason: 'stale',
      }),
      mem('NEW'),
    ]);
    expect(find(edgesOf(res, 'OLD'), 'superseded-by', 'NEW')).toEqual({
      rel: 'superseded-by',
      target: 'NEW',
      origin: 'derived',
      note: 'stale',
    });
    expect(find(edgesOf(res, 'NEW'), 'supersedes', 'OLD')).toEqual({
      rel: 'supersedes',
      target: 'OLD',
      origin: 'derived',
    });
  });

  it('insight derived-from sources (durable) ⇒ source-of on each source', () => {
    const res = collectEdges([
      mem('INS', {
        isInsight: true,
        topic: 'architecture',
        sourceMemoryIds: ['S1', 'S2'],
        clusterSize: 2,
      }),
      mem('S1'),
      mem('S2'),
    ]);
    expect(find(edgesOf(res, 'INS'), 'derived-from', 'S1')).toEqual({
      rel: 'derived-from',
      target: 'S1',
      origin: 'durable',
      note: 'insight cluster: architecture',
    });
    expect(find(edgesOf(res, 'S1'), 'source-of', 'INS')).toEqual({
      rel: 'source-of',
      target: 'INS',
      origin: 'durable',
    });
    expect(find(edgesOf(res, 'S2'), 'source-of', 'INS')).toBeDefined();
  });

  it('source back-ref (insightId) converges with the insight fan-out — no doubling', () => {
    const res = collectEdges([
      mem('INS', {
        isInsight: true,
        topic: 'architecture',
        sourceMemoryIds: ['S1'],
      }),
      mem('S1', { insightId: 'INS', clusteredAt: 'x' }),
    ]);
    // S1 has exactly one edge to INS (source-of), not also a spurious derived-from
    const s1 = edgesOf(res, 'S1').filter((e) => e.target === 'INS');
    expect(s1).toHaveLength(1);
    expect(s1[0]).toMatchObject({ rel: 'source-of', target: 'INS' });
    // INS has exactly one edge to S1 (derived-from), retaining the topic note
    const ins = edgesOf(res, 'INS').filter((e) => e.target === 'S1');
    expect(ins).toHaveLength(1);
    expect(ins[0]).toMatchObject({
      rel: 'derived-from',
      target: 'S1',
      note: 'insight cluster: architecture',
    });
  });
});

describe('collectEdges — dangling (filtered export)', () => {
  it('flags a direct edge whose target is outside the set and emits no inverse', () => {
    const res = collectEdges([
      mem('A', { duplicateMatches: [{ memoryId: 'GONE', score: 0.9 }] }),
    ]);
    expect(find(edgesOf(res, 'A'), 'duplicate-of', 'GONE')).toEqual({
      rel: 'duplicate-of',
      target: 'GONE',
      origin: 'derived',
      score: 0.9,
      dangling: true,
    });
    expect(res.byMemory.has('GONE')).toBe(false);
    expect(res.danglingTargets).toEqual(['GONE']);
  });
});

describe('collectEdges — MemoryLink rows (SHARED-1, additive)', () => {
  const memories = [mem('A'), mem('B')];

  it('is a no-op when no links are supplied', () => {
    const res = collectEdges(memories);
    expect(edgesOf(res, 'A')).toEqual([]);
  });

  it('maps authored → durable and emits the typed inverse', () => {
    const links: CollectableMemoryLink[] = [
      {
        sourceMemoryId: 'A',
        targetMemoryId: 'B',
        targetLocator: 'id:B',
        relType: 'relates-to',
        origin: 'authored',
        note: 'see also',
      },
    ];
    const res = collectEdges(memories, links);
    expect(find(edgesOf(res, 'A'), 'relates-to', 'B')).toEqual({
      rel: 'relates-to',
      target: 'B',
      origin: 'durable',
      note: 'see also',
    });
    expect(find(edgesOf(res, 'B'), 'relates-to', 'A')).toMatchObject({
      rel: 'relates-to',
      target: 'A',
      origin: 'durable',
    });
  });

  it('keeps origin=derived and resolves target via locator when id is null', () => {
    const links: CollectableMemoryLink[] = [
      {
        sourceMemoryId: 'A',
        targetMemoryId: null,
        targetLocator: 'id:B',
        relType: 'derived-from',
        origin: 'derived',
        score: 0.5,
      },
    ];
    const res = collectEdges(memories, links);
    expect(find(edgesOf(res, 'A'), 'derived-from', 'B')).toMatchObject({
      rel: 'derived-from',
      target: 'B',
      origin: 'derived',
      score: 0.5,
    });
    expect(find(edgesOf(res, 'B'), 'source-of', 'A')).toBeDefined();
  });

  it('skips out-of-vocabulary relTypes and links whose source is not exported', () => {
    const links: CollectableMemoryLink[] = [
      {
        sourceMemoryId: 'A',
        targetMemoryId: 'B',
        targetLocator: 'id:B',
        relType: 'mentions',
        origin: 'authored',
      },
      {
        sourceMemoryId: 'OUTSIDE',
        targetMemoryId: 'B',
        targetLocator: 'id:B',
        relType: 'relates-to',
        origin: 'authored',
      },
    ];
    const res = collectEdges(memories, links);
    expect(edgesOf(res, 'A')).toEqual([]);
    expect(edgesOf(res, 'B')).toEqual([]);
  });

  it('flags a MemoryLink whose target is outside the export set as dangling', () => {
    const links: CollectableMemoryLink[] = [
      {
        sourceMemoryId: 'A',
        targetMemoryId: 'GONE',
        targetLocator: 'id:GONE',
        relType: 'relates-to',
        origin: 'authored',
      },
    ];
    const res = collectEdges([mem('A')], links);
    expect(find(edgesOf(res, 'A'), 'relates-to', 'GONE')).toMatchObject({
      dangling: true,
    });
    expect(res.danglingTargets).toEqual(['GONE']);
  });
});

describe('collectEdges — mixed fixture', () => {
  it('collects every kind together without cross-contamination', () => {
    const res = collectEdges([
      mem('A', {
        duplicateMatches: [{ memoryId: 'B', score: 0.99 }],
        contradictionMatches: [{ memoryId: 'C', reason: 'conflict' }],
      }),
      mem('B'),
      mem('C'),
      mem('INS', { isInsight: true, topic: 't', sourceMemoryIds: ['A'] }),
    ]);
    const a = edgesOf(res, 'A');
    expect(find(a, 'duplicate-of', 'B')).toBeDefined();
    expect(find(a, 'contradicts', 'C')).toBeDefined();
    expect(find(a, 'source-of', 'INS')).toBeDefined(); // inverse of INS derived-from A
    expect(find(edgesOf(res, 'INS'), 'derived-from', 'A')).toBeDefined();
    expect(res.danglingTargets).toEqual([]);
  });
});
