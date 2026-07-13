import { describe, it, expect } from 'vitest';
import { memoryIdSchema, userIdSchema } from './types';

/**
 * Memory ids come in three formats: legacy CUID and CUID2 (LTM rows minted by
 * Prisma) plus UUID (the STM tier mints `randomUUID()` ids). All three must
 * pass `memoryIdSchema`, or every by-id MCP tool (get/update/delete/promote/
 * reembed) is unable to address a short-term memory (#233).
 */
describe('memoryIdSchema', () => {
  it('accepts a legacy CUID (LTM)', () => {
    expect(memoryIdSchema.safeParse('cjld2cjxh0000qzrmn831i7rn').success).toBe(true);
  });

  it('accepts a CUID2 (LTM)', () => {
    expect(memoryIdSchema.safeParse('tz4a98xxat96iws9zmbrgj3a').success).toBe(true);
  });

  it('accepts a UUID (STM mints randomUUID ids)', () => {
    expect(memoryIdSchema.safeParse('9f4b7a52-8c3d-4e21-b9a0-6f5d2c1e8b37').success).toBe(true);
  });

  it('rejects arbitrary non-id strings', () => {
    for (const bad of ['', 'not an id', 'DROP TABLE memories;', '../../etc/passwd']) {
      expect(memoryIdSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('userIdSchema', () => {
  it('still rejects UUIDs (user ids are CUID/CUID2 only)', () => {
    expect(userIdSchema.safeParse('9f4b7a52-8c3d-4e21-b9a0-6f5d2c1e8b37').success).toBe(false);
  });

  it('accepts a CUID2', () => {
    expect(userIdSchema.safeParse('tz4a98xxat96iws9zmbrgj3a').success).toBe(true);
  });
});
