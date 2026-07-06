import { describe, it, expect } from 'vitest';
import {
  serializeMemory,
  parseDocument,
  durableProjection,
  durableProjectionOfDocument,
  type CanonicalMemory,
  type MemoryEdge,
} from '@engram/memory-interchange';
import { buildFacts } from './adapters/adapter-utils.js';
import { extractLinks } from './parse/links.js';

/**
 * WP3↔WP4 round-trip contract (T15 / G6). A memory exported by WP3
 * (`serializeMemory`) and re-imported by WP4 (the shared fact-assembly used by
 * the markdown adapter) must reproduce the DURABLE projection — same content,
 * tags, and durable link topology (by target id + rel) — even though ids may
 * differ across a fresh import. The canonical `## Related` mirror must NOT
 * double-count as extra links.
 */

const ISO = '2026-06-01T10:00:00.000Z';

function mem(id: string, content: string, tags: string[]): CanonicalMemory {
  return { id, type: 'long-term', userId: 'qp', tags, createdAt: ISO, updatedAt: ISO, content };
}

describe('export → import round-trip', () => {
  const alpha = mem('mem-alpha', 'Alpha decision: always use a dedicated worktree.', ['decision']);
  const beta = mem('mem-beta', 'Beta rule: write tests at both service and wiring level.', [
    'rule',
  ]);
  const alphaEdges: MemoryEdge[] = [{ rel: 'relates-to', target: 'mem-beta', origin: 'durable' }];
  const betaEdges: MemoryEdge[] = [{ rel: 'relates-to', target: 'mem-alpha', origin: 'durable' }];

  const docAlpha = serializeMemory({ memory: alpha, edges: alphaEdges, mode: 'multi' });
  const docBeta = serializeMemory({ memory: beta, edges: betaEdges, mode: 'multi' });

  it('re-imports the durable typed edges as frontmatter-ref id: links', () => {
    const [factAlpha] = buildFacts({
      content: docAlpha,
      sourcePath: 'alpha--mem-alpha.md',
      sourceTool: 'markdown',
      tags: ['markdown'],
      chunkMode: 'atomic',
    });
    // Exactly one link — the frontmatter edge — NOT also a `## Related` wikilink.
    expect(factAlpha?.links).toEqual([
      {
        kind: 'frontmatter-ref',
        rawTarget: 'mem-beta',
        targetLocator: 'id:mem-beta',
        relType: 'relates-to',
      },
    ]);
  });

  it('preserves the durable projection (content + tags + durable links)', () => {
    const original = durableProjection({
      id: alpha.id,
      type: alpha.type,
      scope: null,
      tags: alpha.tags,
      content: alpha.content,
      links: alphaEdges,
    });
    const reimported = durableProjectionOfDocument(parseDocument(docAlpha));
    expect(reimported.content).toBe(original.content);
    expect(reimported.tags).toEqual(original.tags);
    expect(reimported.durableLinks).toEqual(original.durableLinks);
  });

  it('round-trips a two-note graph symmetric edge set', () => {
    const betaFact = buildFacts({
      content: docBeta,
      sourcePath: 'beta--mem-beta.md',
      sourceTool: 'markdown',
      tags: ['markdown'],
      chunkMode: 'atomic',
    })[0];
    expect(betaFact?.links.map((l) => l.targetLocator)).toEqual(['id:mem-alpha']);
  });

  it('still extracts inline wikilinks for NON-canonical docs (no schemaVersion)', () => {
    // A plain Claude/Obsidian note (no frontmatter schemaVersion) keeps its
    // inline [[wikilinks]] — the canonical-mirror suppression must not leak.
    const links = extractLinks('See [[other-note]].', 'note.md', { name: 'note' });
    expect(links.map((l) => l.targetLocator)).toEqual(['slug:other-note']);
  });
});
