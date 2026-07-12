import {
  EXPECTED_VERSION_REQUIRED_MESSAGE,
  updateMemoryToolSchema,
} from './update-memory.dto';

/** G4-T2 (docs/concurrency-policy.md) — `expectedVersion` is the tool's
 *  optimistic-concurrency guard and is REQUIRED: a blind (versionless) agent
 *  update must be rejected with a conflict-class, actionable message so the
 *  agent knows to re-read (get_memory) and retry with the version it read. */
describe('updateMemoryToolSchema (G4-T2)', () => {
  const userId = 'clm0000000000000000000000';
  const memoryId = 'clm1111111111111111111111';
  const base = { userId, memoryId, content: 'new content', expectedVersion: 3 };

  it('accepts an update carrying expectedVersion', () => {
    const parsed = updateMemoryToolSchema.parse(base);
    expect(parsed.expectedVersion).toBe(3);
  });

  it('rejects a blind update (missing expectedVersion) with the actionable CONFLICT message', () => {
    const blind = { userId, memoryId, content: 'new content' };
    const result = updateMemoryToolSchema.safeParse(blind);

    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((issue) => issue.message) ?? [];
    expect(messages).toContain(EXPECTED_VERSION_REQUIRED_MESSAGE);
    // The recovery path must be spelled out for the agent: conflict-class
    // marker, the missing field, and the re-read tool to call.
    expect(EXPECTED_VERSION_REQUIRED_MESSAGE).toMatch(/^CONFLICT: /);
    expect(EXPECTED_VERSION_REQUIRED_MESSAGE).toContain('expectedVersion');
    expect(EXPECTED_VERSION_REQUIRED_MESSAGE).toContain('get_memory');
    expect(EXPECTED_VERSION_REQUIRED_MESSAGE).toContain('retry');
  });

  it('uses the same actionable message for a non-numeric expectedVersion', () => {
    const result = updateMemoryToolSchema.safeParse({
      ...base,
      expectedVersion: 'not-a-version',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      EXPECTED_VERSION_REQUIRED_MESSAGE,
    );
  });

  it('coerces a numeric string version (transport-friendly)', () => {
    const parsed = updateMemoryToolSchema.parse({
      ...base,
      expectedVersion: '7',
    });
    expect(parsed.expectedVersion).toBe(7);
  });

  it('rejects expectedVersion below 1 (versions start at 1)', () => {
    expect(() =>
      updateMemoryToolSchema.parse({ ...base, expectedVersion: 0 }),
    ).toThrow();
  });

  it('rejects a non-integer expectedVersion', () => {
    expect(() =>
      updateMemoryToolSchema.parse({ ...base, expectedVersion: 1.5 }),
    ).toThrow();
  });

  it('rejects unknown keys (.strict)', () => {
    expect(() =>
      updateMemoryToolSchema.parse({ ...base, surprise: true }),
    ).toThrow();
  });

  it('still carries the optional locator/audit fields alongside the version', () => {
    const parsed = updateMemoryToolSchema.parse({
      ...base,
      scope: 'project:engram',
      actorLabel: 'op@example.com',
      ttl: 3600,
    });
    expect(parsed.scope).toBe('project:engram');
    expect(parsed.actorLabel).toBe('op@example.com');
    expect(parsed.ttl).toBe(3600);
  });
});
