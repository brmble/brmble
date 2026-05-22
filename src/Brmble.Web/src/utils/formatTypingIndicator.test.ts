import { describe, expect, it } from 'vitest';
import { formatTypingIndicator } from './formatTypingIndicator';

describe('formatTypingIndicator', () => {
  it('returns the approved strings for one, two, and many typers', () => {
    expect(formatTypingIndicator([])).toBeNull();
    expect(formatTypingIndicator(['Alice'])).toBe('Alice is typing...');
    expect(formatTypingIndicator(['Alice', 'Bob'])).toBe('Alice and Bob are typing...');
    expect(formatTypingIndicator(['Alice', 'Bob', 'Carol'])).toBe('Alice, Bob, and others are typing...');
  });

  it('keeps the incoming order unchanged so disambiguated names stay deterministic', () => {
    expect(formatTypingIndicator(['Alice', 'Alice (mobile)', 'Bob']))
      .toBe('Alice, Alice (mobile), and others are typing...');
  });
});
