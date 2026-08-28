import { describe, expect, it } from 'vitest';
import { GAME_TYPES, isGameType } from './gameTypes';

describe('gameTypes', () => {
  it('recognises every shipped game type', () => {
    expect(isGameType('deathroll')).toBe(true);
    expect(isGameType('rps')).toBe(true);
  });

  it('rejects unknown, empty and absent types', () => {
    expect(isGameType('arena-knockoff')).toBe(false);
    expect(isGameType('')).toBe(false);
    expect(isGameType(undefined)).toBe(false);
    expect(isGameType(null)).toBe(false);
  });

  it('exposes the union as a readonly tuple so a new type is one edit', () => {
    expect([...GAME_TYPES]).toEqual(['deathroll', 'rps']);
  });
});
