import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor, keysetWhere } from './cursor';

describe('cursor encode/decode', () => {
  it('round-trips a cursor through an opaque token', () => {
    const cursor = { v: 1_700_000_000_000, id: 'clabc123' };
    const token = encodeCursor(cursor);
    // Opaque: not the raw JSON, URL-safe base64.
    expect(token).not.toContain('{');
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(token)).toEqual(cursor);
  });

  it('returns null for empty/absent input (first page)', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null for a legacy numeric offset cursor', () => {
    expect(decodeCursor('25')).toBeNull();
    expect(decodeCursor('0')).toBeNull();
  });

  it('returns null for tampered / malformed tokens instead of throwing', () => {
    expect(decodeCursor('not-base64-$$$')).toBeNull();
    // Valid base64 of a non-cursor object.
    expect(decodeCursor(Buffer.from('{"foo":1}', 'utf8').toString('base64url'))).toBeNull();
    // Missing id.
    expect(decodeCursor(Buffer.from('{"v":1}', 'utf8').toString('base64url'))).toBeNull();
    // Non-finite v.
    expect(
      decodeCursor(Buffer.from('{"v":null,"id":"x"}', 'utf8').toString('base64url'))
    ).toBeNull();
  });
});

describe('keysetWhere direction', () => {
  const value = new Date('2026-06-01T00:00:00.000Z');
  const v = value.getTime();

  it('desc seeks strictly-before rows (lt), with an id tiebreak', () => {
    expect(keysetWhere('createdAt', 'desc', { v, id: 'm5' })).toEqual({
      OR: [{ createdAt: { lt: value } }, { createdAt: value, id: { lt: 'm5' } }],
    });
  });

  it('asc seeks strictly-after rows (gt), with an id tiebreak', () => {
    expect(keysetWhere('updatedAt', 'asc', { v, id: 'm5' })).toEqual({
      OR: [{ updatedAt: { gt: value } }, { updatedAt: value, id: { gt: 'm5' } }],
    });
  });
});
