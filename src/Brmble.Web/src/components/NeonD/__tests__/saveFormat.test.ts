import { describe, expect, it } from 'vitest';
import { createBaseGameState } from '../constants';
import type { GameState } from '../types';
import {
  NEON_D_SAVE_FORMAT,
  NEON_D_SAVE_VERSION,
  parseNeonDSave,
  serializeNeonDSave,
} from '../saveFormat';

function createState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...JSON.parse(JSON.stringify(createBaseGameState(0))) as GameState,
    ...overrides,
  };
}

describe('Neon-D save format', () => {
  it('serializes and parses a versioned save envelope', () => {
    const state = createState({ cash: 1234.5 });

    const json = serializeNeonDSave(state);

    expect(JSON.parse(json)).toEqual({
      format: NEON_D_SAVE_FORMAT,
      version: NEON_D_SAVE_VERSION,
      state,
    });
    expect(parseNeonDSave(json)).toEqual(state);
  });

  it('serializes the v2 schema without restoring v1-only fields', () => {
    const state = createState({
      schemaVersion: 2,
      offlineEarningsSummary: {
        actualAwayMs: 60_000,
        simulatedMs: 30_000,
        cashEarned: 250,
        respectEarned: 12,
      },
    });

    const json = serializeNeonDSave(state);
    const parsed = JSON.parse(json);
    const legacyResearchField = ['research', 'Speed'].join('');

    expect(parsed.state.schemaVersion).toBe(2);
    expect(parsed.state).not.toHaveProperty('money');
    expect(parsed.state).not.toHaveProperty(legacyResearchField);
    expect(parsed.state).not.toHaveProperty('unlockedProduction');
    expect(parsed.state.offlineEarningsSummary).toEqual(state.offlineEarningsSummary);
  });

  it.each([
    ['invalid JSON', 'not json'],
    ['wrong format', JSON.stringify({ format: 'other-game', version: NEON_D_SAVE_VERSION, state: createState() })],
    ['unsupported version', JSON.stringify({ format: NEON_D_SAVE_FORMAT, version: NEON_D_SAVE_VERSION + 1, state: createState() })],
    ['missing state', JSON.stringify({ format: NEON_D_SAVE_FORMAT, version: NEON_D_SAVE_VERSION })],
    ['non-object state', JSON.stringify({ format: NEON_D_SAVE_FORMAT, version: NEON_D_SAVE_VERSION, state: null })],
    ['invalid numeric state field', JSON.stringify({ format: NEON_D_SAVE_FORMAT, version: NEON_D_SAVE_VERSION, state: createState({ cash: 'rich' as unknown as number }) })],
    ['wrong schema version in state', JSON.stringify({ format: NEON_D_SAVE_FORMAT, version: NEON_D_SAVE_VERSION, state: { ...createState(), schemaVersion: 1 } })],
    ['legacy offline summary shape', JSON.stringify({
      format: NEON_D_SAVE_FORMAT,
      version: NEON_D_SAVE_VERSION,
      state: createState({
        offlineEarningsSummary: { awayMs: 60_000, earned: 250 } as unknown as GameState['offlineEarningsSummary'],
      }),
    })],
  ])('rejects %s', (_name, text) => {
    expect(() => parseNeonDSave(text)).toThrow();
  });
});
