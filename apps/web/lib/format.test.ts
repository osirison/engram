import { describe, expect, it } from 'vitest';

import {
  formatNumber,
  formatPercent,
  formatUptime,
  initials,
  memoryTypeLabel,
  truncate,
} from './format';

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
