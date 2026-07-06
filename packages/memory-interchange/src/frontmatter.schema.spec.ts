import { describe, it, expect } from 'vitest';
import { frontmatterSchema, type Frontmatter } from './frontmatter.schema.js';
import { MEMORY_INTERCHANGE_VERSION } from './version.js';

/** A canonical, fully-populated frontmatter object matching WP3 PLAN §4.2. */
function validFrontmatter(): Frontmatter {
  return {
    schemaVersion: MEMORY_INTERCHANGE_VERSION,
    id: 'cly3k9m0a0000abcd1234',
    type: 'long-term',
    userId: 'qp',
    scope: 'project:engram',
    organizationId: 'org_abc123',
    tags: ['architecture', 'decision'],
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-02T12:30:00.000Z',
    expiresAt: null,
    aliases: ['cly3k9m0a0000abcd1234'],
    links: [
      {
        rel: 'derived-from',
        target: 'clx0000insightsrc01',
        origin: 'durable',
        note: 'insight cluster: architecture',
      },
      {
        rel: 'duplicate-of',
        target: 'clw0000dupmemory02',
        origin: 'derived',
        score: 0.981,
      },
    ],
    metadata: { source: 'meeting-notes' },
    provenance: { source: 'engram', importedFrom: null },
  };
}

describe('frontmatterSchema', () => {
  it('parses a canonical fully-populated object', () => {
    const parsed = frontmatterSchema.parse(validFrontmatter());
    expect(parsed).toEqual(validFrontmatter());
  });

  it('parses a minimal LTM object with optional keys omitted', () => {
    const minimal = {
      schemaVersion: MEMORY_INTERCHANGE_VERSION,
      id: 'clminimal0000000000000',
      type: 'long-term' as const,
      userId: 'qp',
      tags: [],
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z',
      aliases: ['clminimal0000000000000'],
      links: [],
      provenance: { source: 'engram', importedFrom: null },
    };
    expect(() => frontmatterSchema.parse(minimal)).not.toThrow();
  });

  it('rejects an unknown top-level key (.strict())', () => {
    const bad = { ...validFrontmatter(), exportedAt: '2026-07-06T00:00:00.000Z' };
    expect(frontmatterSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown key inside a link entry (nested .strict())', () => {
    const fm = validFrontmatter();
    const bad = {
      ...fm,
      links: [{ ...fm.links[0], bogus: true }],
    };
    expect(frontmatterSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown key inside provenance (nested .strict())', () => {
    const bad = {
      ...validFrontmatter(),
      provenance: { source: 'engram', importedFrom: null, extra: 1 },
    };
    expect(frontmatterSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an out-of-vocabulary edge rel', () => {
    const fm = validFrontmatter();
    const bad = { ...fm, links: [{ ...fm.links[0], rel: 'mentions' }] };
    expect(frontmatterSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an out-of-vocabulary edge origin', () => {
    const fm = validFrontmatter();
    const bad = { ...fm, links: [{ ...fm.links[0], origin: 'authored' }] };
    expect(frontmatterSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an invalid memory type', () => {
    const bad = { ...validFrontmatter(), type: 'medium-term' };
    expect(frontmatterSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-ISO timestamp', () => {
    const bad = { ...validFrontmatter(), createdAt: '2026-06-01 10:00:00' };
    expect(frontmatterSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a nullable expiresAt for STM', () => {
    const stm = {
      ...validFrontmatter(),
      type: 'short-term' as const,
      expiresAt: '2026-06-01T11:00:00.000Z',
    };
    expect(frontmatterSchema.safeParse(stm).success).toBe(true);
  });
});
