import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatDateSeparator } from './formatDateSeparator';

describe('formatDateSeparator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Today" for today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-06T15:00:00'));
    expect(formatDateSeparator(new Date('2026-03-06T10:00:00'))).toBe('Today');
  });

  it('returns "Yesterday" for yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-06T15:00:00'));
    expect(formatDateSeparator(new Date('2026-03-05T22:00:00'))).toBe('Yesterday');
  });

  it('returns weekday name for dates within last 7 days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-06T15:00:00')); // Friday
    const result = formatDateSeparator(new Date('2026-03-02T10:00:00')); // Monday
    expect(result).toBe('Monday');
  });

  it('returns full date for older dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-06T15:00:00'));
    const result = formatDateSeparator(new Date('2026-02-20T10:00:00'));
    expect(result).toBe('Friday, February 20, 2026');
  });
});
