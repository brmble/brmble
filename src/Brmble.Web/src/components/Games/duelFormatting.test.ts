import { describe, expect, it } from 'vitest';
import { ceilToSecondMs, estimateText, formatDuration, pairLabel } from './duelFormatting';
import { knownEstimate, unknownEstimate } from './duelTestHarness';

const resolveName = (sessionId: number) => `Session${sessionId}`;

describe('duelFormatting', () => {
  it('formats seconds, exact minutes, and mixed minutes', () => {
    expect(formatDuration(25_000)).toBe('25s');
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(65_000)).toBe('1m 5s');
  });

  it('rounds a partial second up so nothing renders as 0s', () => {
    expect(formatDuration(ceilToSecondMs(4_200))).toBe('5s');
    expect(formatDuration(ceilToSecondMs(1))).toBe('1s');
  });

  it('describes a known estimate with an approximation marker', () => {
    expect(estimateText(knownEstimate(25_000))).toBe('Estimated duration: ~25s');
  });

  it('describes an unknown estimate without inventing a value', () => {
    expect(estimateText(unknownEstimate)).toBe('Estimated duration: Unknown');
  });

  it('prefers the server display name and falls back to the resolver', () => {
    expect(pairLabel([
      { userId: 1, sessionId: 11, displayName: 'Qy', ready: false },
      { userId: 2, sessionId: 22, displayName: '  ', ready: false },
    ], resolveName)).toBe('Qy vs Session22');
  });

  it('falls back to the user id when there is no live session', () => {
    expect(pairLabel([
      { userId: 7, sessionId: 0, displayName: '', ready: false },
    ], resolveName)).toBe('Player 7');
  });
});
