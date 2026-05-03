import { describe, it, expect } from 'vitest';
import { formatIdleDuration } from './formatIdleDuration';

describe('formatIdleDuration', () => {
  it('renders sub-minute as "<1 min"', () => {
    expect(formatIdleDuration(0)).toBe('Idle for <1 min');
    expect(formatIdleDuration(45)).toBe('Idle for <1 min');
    expect(formatIdleDuration(59)).toBe('Idle for <1 min');
  });

  it('renders sub-hour as minutes', () => {
    expect(formatIdleDuration(60)).toBe('Idle for 1 min');
    expect(formatIdleDuration(599)).toBe('Idle for 9 min');
    expect(formatIdleDuration(600)).toBe('Idle for 10 min');
    expect(formatIdleDuration(3599)).toBe('Idle for 59 min');
  });

  it('renders sub-day as hours+minutes', () => {
    expect(formatIdleDuration(3600)).toBe('Idle for 1h 0m');
    expect(formatIdleDuration(3660)).toBe('Idle for 1h 1m');
    expect(formatIdleDuration(5000)).toBe('Idle for 1h 23m');
    expect(formatIdleDuration(86_399)).toBe('Idle for 23h 59m');
  });

  it('renders days as singular or plural', () => {
    expect(formatIdleDuration(86_400)).toBe('Idle for 1 day');
    expect(formatIdleDuration(172_799)).toBe('Idle for 1 day');
    expect(formatIdleDuration(172_800)).toBe('Idle for 2 days');
    expect(formatIdleDuration(604_800)).toBe('Idle for 7 days');
  });
});
