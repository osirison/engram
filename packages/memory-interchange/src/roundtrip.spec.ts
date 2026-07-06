import { describe, it, expect } from 'vitest';
import { serializeMemory, type CanonicalMemory } from './serialize.js';
import { parseDocument } from './parse.js';
import { durableProjection, durableProjectionOfDocument } from './roundtrip.js';
import type { MemoryEdge } from './edge-types.js';

/**
 * WP3 half of the G6 round-trip contract (PLAN §4.10). The DB-import half lives
 * in `apps/mcp-server/test/export-roundtrip.e2e-spec.ts` (todo until WP4). These
 * assertions document exactly what WP4's importer must reproduce.
 */

const durableEdge: MemoryEdge = {
  rel: 'derived-from',
  target: 'clsource000000000000001',
  origin: 'durable',
  note: 'insight cluster: architecture',
};
const derivedEdge: MemoryEdge = {
  rel: 'duplicate-of',
  target: 'cldup00000000000000000002',
  origin: 'derived',
  score: 0.981,
};

function ltm(overrides: Partial<CanonicalMemory> = {}): CanonicalMemory {
  return {
    id: 'clmemory0000000000000001',
    type: 'long-term',
    userId: 'qp',
    scope: 'project:engram',
    organizationId: null,
    tags: ['decision', 'architecture'],
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-02T12:30:00.000Z',
    metadata: { source: 'notes' },
    content: 'We chose pgvector over Qdrant.',
    ...overrides,
  };
}

/** Serialize → parse → project. */
function roundTrip(memory: CanonicalMemory, edges: MemoryEdge[]) {
  const parsed = parseDocument(serializeMemory({ memory, edges }));
  return durableProjectionOfDocument(parsed);
}

describe('round-trip durable projection (G6)', () => {
  it('reproduces id, type, scope, tags, content, and durable edges', () => {
    const memory = ltm();
    const edges = [durableEdge, derivedEdge];
    const expected = durableProjection({
      id: memory.id,
      type: memory.type,
      scope: memory.scope,
      tags: memory.tags,
      content: memory.content,
      links: edges,
    });
    expect(roundTrip(memory, edges)).toEqual(expected);
  });

  it('excludes derived edges — so re-import doubling them cannot fail the contract', () => {
    const projection = roundTrip(ltm(), [durableEdge, derivedEdge]);
    // only the durable derived-from survives into the compared projection
    expect(projection.durableLinks).toEqual([
      { rel: 'derived-from', target: 'clsource000000000000001', origin: 'durable' },
    ]);
    expect(projection.durableLinks.some((e) => e.origin === 'derived')).toBe(false);
  });

  it('is invariant to volatile fields (updatedAt / metadata) — does NOT require them', () => {
    const a = roundTrip(ltm({ updatedAt: '2026-06-02T12:30:00.000Z', metadata: { a: 1 } }), []);
    const b = roundTrip(ltm({ updatedAt: '2099-01-01T00:00:00.000Z', metadata: { b: 2 } }), []);
    expect(a).toEqual(b); // a deliberately volatile mismatch does not break the projection
  });

  it('preserves content containing --- and [[x]] through the round-trip', () => {
    const content = '---\nnot frontmatter\n---\n\nA [[wiki]] and arr[[0]] end';
    const memory = ltm({ content });
    expect(roundTrip(memory, []).content).toBe(
      '---\nnot frontmatter\n---\n\nA [[wiki]] and arr[[0]] end'
    );
  });

  it('round-trips an STM memory without requiring its (volatile) TTL', () => {
    const stm = ltm({
      id: 'clstm00000000000000000001',
      type: 'short-term',
      expiresAt: '2026-06-01T11:00:00.000Z',
      scope: null,
    });
    const projection = roundTrip(stm, [durableEdge]);
    expect(projection.type).toBe('short-term');
    expect(projection.scope).toBeNull();
    // expiresAt is intentionally absent from the durable projection (§4.6/§4.10)
    expect(projection).not.toHaveProperty('expiresAt');
    expect(projection.durableLinks).toHaveLength(1);
  });

  it('retains a dangling durable edge in the projection (graph identity, WP4 tolerates)', () => {
    const dangling: MemoryEdge = { ...durableEdge, dangling: true };
    const projection = roundTrip(ltm(), [dangling]);
    expect(projection.durableLinks).toEqual([
      { rel: 'derived-from', target: 'clsource000000000000001', origin: 'durable' },
    ]);
  });
});
