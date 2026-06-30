import { describe, expect, it } from 'vitest';

import { activeFilterCount, DEFAULT_FILTERS, rangeToDateFrom } from './memory-filters';

describe('rangeToDateFrom', () => {
  const now = Date.UTC(2026, 5, 30, 12, 0, 0); // 2026-06-30T12:00:00Z

  it('returns undefined for "all"', () => {
    expect(rangeToDateFrom('all', now)).toBeUndefined();
  });

  it('subtracts the right number of days', () => {
    expect(rangeToDateFrom('24h', now)).toBe(new Date(now - 86_400_000).toISOString());
    expect(rangeToDateFrom('7d', now)).toBe(new Date(now - 7 * 86_400_000).toISOString());
    expect(rangeToDateFrom('30d', now)).toBe(new Date(now - 30 * 86_400_000).toISOString());
  });
});

describe('activeFilterCount', () => {
  it('counts only narrowing filters, not the search query', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, q: 'hello' })).toBe(0);
    expect(
      activeFilterCount({
        ...DEFAULT_FILTERS,
        type: 'long-term',
        scope: 'session:1',
        range: '7d',
        tags: ['a', 'b'],
      })
    ).toBe(5);
  });
});
