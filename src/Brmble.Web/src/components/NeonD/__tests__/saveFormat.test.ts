import { describe, expect, it } from 'vitest';
import { INITIAL_GAME_STATE } from '../constants';
import type { GameState } from '../types';
import { parseNeonDSave, serializeNeonDSave } from '../saveFormat';

function createState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...JSON.parse(JSON.stringify(INITIAL_GAME_STATE)) as GameState,
    ...overrides,
  };
}

describe('Neon-D save format', () => {
  it('serializes and parses a versioned save envelope', () => {
    const state = createState({ money: 1234.5 });

    const json = serializeNeonDSave(state);

    expect(JSON.parse(json)).toEqual({
      format: 'brmble-neon-d-save',
      version: 1,
      state,
    });
    expect(parseNeonDSave(json)).toEqual(state);
  });

  it.each([
    ['invalid JSON', 'not json'],
    ['wrong format', JSON.stringify({ format: 'other-game', version: 1, state: createState() })],
    ['unsupported version', JSON.stringify({ format: 'brmble-neon-d-save', version: 2, state: createState() })],
    ['missing state', JSON.stringify({ format: 'brmble-neon-d-save', version: 1 })],
    ['non-object state', JSON.stringify({ format: 'brmble-neon-d-save', version: 1, state: null })],
    ['invalid numeric state field', JSON.stringify({ format: 'brmble-neon-d-save', version: 1, state: createState({ money: 'rich' as unknown as number }) })],
  ])('rejects %s', (_name, text) => {
    expect(() => parseNeonDSave(text)).toThrow();
  });
});
