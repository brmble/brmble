import { describe, expect, it } from 'vitest';
import { formatBroadcastSummary } from './formatBroadcastSummary';

describe('formatBroadcastSummary', () => {
  it('formats a standard resolution with fps', () => {
    expect(formatBroadcastSummary('1080p', 30)).toBe('1080p 30fps');
  });

  it('formats 720p and 1440p unchanged', () => {
    expect(formatBroadcastSummary('720p', 15)).toBe('720p 15fps');
    expect(formatBroadcastSummary('1440p', 60)).toBe('1440p 60fps');
  });

  it('uppercases the 4k label to 4K for display consistency', () => {
    expect(formatBroadcastSummary('4k', 30)).toBe('4K 30fps');
  });

  it('falls back to the raw resolution string when unmapped', () => {
    expect(formatBroadcastSummary('8k', 30)).toBe('8k 30fps');
  });
});
