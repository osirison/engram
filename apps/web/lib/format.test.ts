import { describe, expect, it } from 'vitest';

import {
  formatCountdown,
  formatNumber,
  formatPercent,
  formatUptime,
  initials,
  memoryTypeLabel,
  secondsUntil,
  truncate,
} from './format';

describe('formatCountdown (WP2 T3)', () => {
  const now = Date.parse('2026-07-01T00:00:00.000Z');
  it('humanises the remaining time to an expiry instant', () => {
    expect(formatCountdown('2026-07-01T03:12:00.000Z', now)).toBe('expires in 3h 12m');
    expect(formatCountdown('2026-07-01T00:00:45.000Z', now)).toBe('expires in 45s');
    expect(formatCountdown('2026-07-03T04:00:00.000Z', now)).toBe('expires in 2d 4h');
  });
  it('reports "expired" once past and "—" for absent/invalid input', () => {
    expect(formatCountdown('2026-06-30T23:59:59.000Z', now)).toBe('expired');
    expect(formatCountdown(null, now)).toBe('—');
    expect(formatCountdown('not-a-date', now)).toBe('—');
  });
});

describe('secondsUntil (WP2 T3)', () => {
  const now = Date.parse('2026-07-01T00:00:00.000Z');
  it('returns signed seconds to the instant, or null when absent', () => {
    expect(secondsUntil('2026-07-01T00:10:00.000Z', now)).toBe(600);
    expect(secondsUntil('2026-06-30T23:50:00.000Z', now)).toBe(-600);
    expect(secondsUntil(null, now)).toBeNull();
  });
});

describe('formatNumber', () => {
  it('formats integers with separators and handles nullish', () => {
    expect(formatNumber(1234567)).toBe(new Intl.NumberFormat().format(1234567));
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('renders a ratio as a percentage', () => {
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(0.1234, 1)).toBe('12.3%');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatUptime', () => {
  it('humanises seconds into the largest two units', () => {
    expect(formatUptime(45)).toBe('45s');
    expect(formatUptime(125)).toBe('2m');
    expect(formatUptime(3 * 3600 + 5 * 60)).toBe('3h 5m');
    expect(formatUptime(2 * 86400 + 3 * 3600)).toBe('2d 3h');
    expect(formatUptime(null)).toBe('—');
  });
});

describe('memoryTypeLabel', () => {
  it('title-cases the known memory tiers', () => {
    expect(memoryTypeLabel('short-term')).toBe('Short-term');
    expect(memoryTypeLabel('long-term')).toBe('Long-term');
    expect(memoryTypeLabel('other')).toBe('other');
  });
});

describe('truncate', () => {
  it('adds an ellipsis only when over the limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello world', 5)).toBe('hello…');
  });
});

describe('initials', () => {
  it('derives initials from names and emails', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('ada@example.com')).toBe('AD');
    expect(initials('mononym')).toBe('MO');
    expect(initials(null)).toBe('?');
  });
});
