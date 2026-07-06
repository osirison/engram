import { describe, it, expect } from 'vitest';
import {
  serializeMemory,
  buildFrontmatter,
  normalizeContent,
  RELATED_MARKER,
  type CanonicalMemory,
} from './serialize.js';
import { parseDocument } from './parse.js';
import type { MemoryEdge } from './edge-types.js';

function memory(overrides: Partial<CanonicalMemory> = {}): CanonicalMemory {
  return {
    id: 'cly3k9m0a0000abcd1234',
    type: 'long-term',
    userId: 'qp',
    scope: 'project:engram',
    organizationId: 'org_abc123',
    tags: ['architecture', 'decision'],
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-02T12:30:00.000Z',
    metadata: { source: 'meeting-notes' },
    content: 'We chose pgvector over Qdrant\n\nRationale: one datastore, native SQL filtering.',
    ...overrides,
  };
}

function edges(): MemoryEdge[] {
  return [
    { rel: 'duplicate-of', target: 'clw0000dupmemory02', origin: 'derived', score: 0.981 },
    {
      rel: 'derived-from',
      target: 'clx0000insightsrc01',
      origin: 'durable',
      note: 'insight cluster: architecture',
    },
  ];
}

const display = (id: string): string | undefined =>
  ({
    clw0000dupmemory02: 'We chose pgvector',
    clx0000insightsrc01: 'Architecture insight: prefer pgvector',
  })[id];

describe('serializeMemory (multi mode)', () => {
  it('emits a golden Obsidian note (frontmatter + body + Related)', () => {
    const doc = serializeMemory({ memory: memory(), edges: edges(), linkDisplay: display });
    expect(doc).toMatchInlineSnapshot(`
      "---
      schemaVersion: "1.0"
      id: cly3k9m0a0000abcd1234
      type: long-term
      userId: qp
      scope: project:engram
      organizationId: org_abc123
      tags:
        - architecture
        - decision
      createdAt: 2026-06-01T10:00:00.000Z
      updatedAt: 2026-06-02T12:30:00.000Z
      aliases:
        - cly3k9m0a0000abcd1234
      links:
        - rel: derived-from
          target: clx0000insightsrc01
          origin: durable
          note: "insight cluster: architecture"
        - rel: duplicate-of
          target: clw0000dupmemory02
          origin: derived
          score: 0.981
      metadata:
        source: meeting-notes
      provenance:
        source: engram
        importedFrom: null
      ---

      We chose pgvector over Qdrant

      Rationale: one datastore, native SQL filtering.

      <!-- engram:links -->

      ## Related

      - **derived-from** [[clx0000insightsrc01|Architecture insight: prefer pgvector]]
      - **duplicate-of** [[clw0000dupmemory02|We chose pgvector]] (0.98)
      "
    `);
  });

  it('is byte-stable across repeated calls', () => {
    const a = serializeMemory({ memory: memory(), edges: edges(), linkDisplay: display });
    const b = serializeMemory({ memory: memory(), edges: edges(), linkDisplay: display });
    expect(a).toBe(b);
  });

  it('sorts edges by (rel, target) regardless of input order', () => {
    const doc = serializeMemory({
      memory: memory(),
      edges: edges().reverse(),
      linkDisplay: display,
    });
    const derivedIdx = doc.indexOf('rel: derived-from');
    const dupIdx = doc.indexOf('rel: duplicate-of');
    expect(derivedIdx).toBeGreaterThan(-1);
    expect(derivedIdx).toBeLessThan(dupIdx); // 'derived-from' < 'duplicate-of'
  });
});

describe('round-trip: parseDocument(serializeMemory(x))', () => {
  it('reproduces the frontmatter projection exactly', () => {
    const m = memory();
    const e = edges();
    const parsed = parseDocument(serializeMemory({ memory: m, edges: e, linkDisplay: display }));
    expect(parsed.frontmatter).toEqual(buildFrontmatter(m, e));
  });

  it('reproduces canonical content exactly', () => {
    const m = memory();
    const parsed = parseDocument(serializeMemory({ memory: m, edges: edges() }));
    expect(parsed.body).toBe(normalizeContent(m.content));
  });

  it('survives content containing a leading ---, code fences, and [[x]]', () => {
    const content =
      '---\nnot frontmatter\n---\n\n```md\nfenced\n```\n\nA wikilink-ish [[x|y]] and array arr[[0]] end';
    const m = memory({ content });
    const doc = serializeMemory({ memory: m, edges: edges(), linkDisplay: display });
    // the content's literal [[x|y]] must be escaped, not left as a live wikilink
    expect(doc).not.toContain('[[x|y]]');
    expect(doc).toContain('\\[\\[x|y\\]\\]');
    const parsed = parseDocument(doc);
    expect(parsed.body).toBe(normalizeContent(content));
  });

  it('reproduces content that itself contains a ## Related heading (sentinel split)', () => {
    const content = 'Body text\n\n## Related\n\nthis heading is part of the content';
    const m = memory({ content });
    const parsed = parseDocument(serializeMemory({ memory: m, edges: edges() }));
    expect(parsed.body).toBe(normalizeContent(content));
  });
});

describe('serializeMemory omissions + optionals', () => {
  it('omits empty metadata, scope, org, and the Related section', () => {
    const m = memory({ metadata: {}, scope: null, organizationId: null });
    const doc = serializeMemory({ memory: m, edges: [] });
    expect(doc).not.toContain('metadata:');
    expect(doc).not.toContain('scope:');
    expect(doc).not.toContain('organizationId:');
    expect(doc).not.toContain('## Related');
    expect(doc).not.toContain(RELATED_MARKER);
  });

  it('omits expiresAt for LTM but includes it for STM', () => {
    const ltm = serializeMemory({ memory: memory(), edges: [] });
    expect(ltm).not.toContain('expiresAt:');
    const stm = serializeMemory({
      memory: memory({ type: 'short-term', expiresAt: '2026-06-01T11:00:00.000Z' }),
      edges: [],
    });
    expect(stm).toContain('expiresAt: ');
    expect(stm).toContain('type: short-term');
  });

  it('renders a dangling edge as plain text but keeps it in frontmatter links', () => {
    const dangling: MemoryEdge = {
      rel: 'contradicts',
      target: 'clGONE00000000000000zz',
      origin: 'derived',
      dangling: true,
    };
    const doc = serializeMemory({ memory: memory(), edges: [dangling] });
    expect(doc).toContain('clGONE00000000000000zz (not in export)');
    expect(doc).not.toContain('[[clGONE');
    const parsed = parseDocument(doc);
    expect(parsed.frontmatter.links).toEqual([
      { rel: 'contradicts', target: 'clGONE00000000000000zz', origin: 'derived', dangling: true },
    ]);
  });
});

describe('serializeMemory (single mode)', () => {
  it('emits an anchor and intra-doc [[#mem-<id>]] links', () => {
    const doc = serializeMemory({
      memory: memory(),
      edges: edges(),
      mode: 'single',
      linkDisplay: display,
    });
    expect(doc).toContain('<a id="mem-cly3k9m0a0000abcd1234"></a>');
    expect(doc).toContain('[[#mem-clx0000insightsrc01|Architecture insight: prefer pgvector]]');
    expect(doc).toContain('```yaml');
    expect(doc).not.toMatch(/^---\n/); // no top-level frontmatter fence in single mode
  });
});
