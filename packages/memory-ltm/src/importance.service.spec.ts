import { describe, expect, it } from 'vitest';
import { ImportanceScoringService } from './importance.service';

describe('ImportanceScoringService', () => {
  const service = new ImportanceScoringService();
  const now = new Date('2026-06-15T00:00:00Z');

  it('boosts decisions and access-heavy memories', () => {
    const result = service.score(
      {
        content: 'Decision: switch to pgvector after the incident review',
        accessCount: 8,
        createdAt: new Date('2026-06-10T00:00:00Z'),
        lastAccessedAt: new Date('2026-06-14T00:00:00Z'),
        tags: ['important'],
      },
      now
    );

    expect(result.score).toBeGreaterThan(0.5);
    expect(result.reasons).toContain('decision cue');
    expect(result.reasons).toContain('reinforced by access');
  });

  it('pins critical memories above the decay floor', () => {
    const result = service.score(
      {
        content: 'Old but pinned',
        pinned: true,
        createdAt: new Date('2025-01-01T00:00:00Z'),
      },
      now
    );

    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.status).toBe('pinned');
  });

  it('marks old weak memories as archived', () => {
    const result = service.score(
      {
        content: 'misc note',
        createdAt: new Date('2025-01-01T00:00:00Z'),
      },
      now
    );

    expect(result.status).toBe('archived');
    expect(result.score).toBeLessThan(0.15);
  });
});
