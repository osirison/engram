import { bulkDeleteToolSchema } from './bulk-delete.dto';

/** WP2 T6/D9 — the batch bounds are the tool's safety envelope: the server must
 *  reject an empty or >100 batch and strip unknown keys (`.strict()`). */
describe('bulkDeleteToolSchema (WP2 T6/D9)', () => {
  const base = { userId: 'qp', memoryIds: ['a'] };

  it('accepts a valid single-id batch', () => {
    const parsed = bulkDeleteToolSchema.parse(base);
    expect(parsed.memoryIds).toEqual(['a']);
  });

  it('accepts a full batch of exactly 100 ids', () => {
    const memoryIds = Array.from({ length: 100 }, (_, i) => `id${i}`);
    expect(() =>
      bulkDeleteToolSchema.parse({ userId: 'qp', memoryIds }),
    ).not.toThrow();
  });

  it('rejects an empty id list (min 1)', () => {
    expect(() =>
      bulkDeleteToolSchema.parse({ userId: 'qp', memoryIds: [] }),
    ).toThrow();
  });

  it('rejects more than 100 ids (max 100)', () => {
    const memoryIds = Array.from({ length: 101 }, (_, i) => `id${i}`);
    expect(() =>
      bulkDeleteToolSchema.parse({ userId: 'qp', memoryIds }),
    ).toThrow();
  });

  it('rejects unknown keys (.strict)', () => {
    expect(() =>
      bulkDeleteToolSchema.parse({ ...base, surprise: true }),
    ).toThrow();
  });

  it('carries optional scope and actorLabel', () => {
    const parsed = bulkDeleteToolSchema.parse({
      ...base,
      scope: 'project:engram',
      actorLabel: 'op@example.com',
    });
    expect(parsed.scope).toBe('project:engram');
    expect(parsed.actorLabel).toBe('op@example.com');
  });

  it('rejects an actorLabel longer than 256 chars', () => {
    expect(() =>
      bulkDeleteToolSchema.parse({ ...base, actorLabel: 'x'.repeat(257) }),
    ).toThrow();
  });
});
