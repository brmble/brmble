import { describe, it, expect } from 'vitest';
import { formatIdleDuration } from './formatIdleDuration';

describe('formatIdleDuration', () => {
  it('renders sub-minute as "<1 min"', () => {
    expect(formatIdleDuration(0)).toBe('AFK voor <1 min');
    expect(formatIdleDuration(45)).toBe('AFK voor <1 min');
    expect(formatIdleDuration(59)).toBe('AFK voor <1 min');
  });

  it('renders sub-hour as minutes', () => {
    expect(formatIdleDuration(60)).toBe('AFK voor 1 min');
    expect(formatIdleDuration(599)).toBe('AFK voor 9 min');
    expect(formatIdleDuration(600)).toBe('AFK voor 10 min');
    expect(formatIdleDuration(3599)).toBe('AFK voor 59 min');
  });

  it('renders sub-day as hours+minutes', () => {
    expect(formatIdleDuration(3600)).toBe('AFK voor 1u 0m');
    expect(formatIdleDuration(3660)).toBe('AFK voor 1u 1m');
    expect(formatIdleDuration(5000)).toBe('AFK voor 1u 23m');
    expect(formatIdleDuration(86_399)).toBe('AFK voor 23u 59m');
  });

  it('renders days as singular or plural', () => {
    expect(formatIdleDuration(86_400)).toBe('AFK voor 1 dag');
    expect(formatIdleDuration(172_799)).toBe('AFK voor 1 dag');
    expect(formatIdleDuration(172_800)).toBe('AFK voor 2 dagen');
    expect(formatIdleDuration(604_800)).toBe('AFK voor 7 dagen');
  });
});
