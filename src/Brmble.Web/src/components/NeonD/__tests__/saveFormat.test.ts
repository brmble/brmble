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

  it('round-trips valid progression state while preserving fractional cash, Respect, stock, and earnings', () => {
    const state = createState({
      cash: 1234.56,
      runEarnings: 7890.12,
      respect: 345.67,
      unlockedProducts: ['weed', 'mushrooms'],
      production: {
        ...createState().production,
        weed: {
          stock: 12.34,
          producersOwned: 2,
          purchasedUpgradeIds: ['fertilizer'],
        },
        mushrooms: {
          stock: 5.67,
          producersOwned: 1,
          purchasedUpgradeIds: ['autoHygrometer'],
        },
      },
      muscleOwned: {
        ...createState().muscleOwned,
        hoodRat: 2,
      },
      territoryLevel: 1,
      discountLevel: 2,
      kingpins: 1,
    });

    expect(parseNeonDSave(serializeNeonDSave(state))).toEqual(state);
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
    ['out-of-order unlocked products', JSON.stringify({
      format: NEON_D_SAVE_FORMAT,
      version: NEON_D_SAVE_VERSION,
      state: createState({ unlockedProducts: ['weed', 'meth'] as GameState['unlockedProducts'] }),
    })],
    ['out-of-order purchased upgrades', JSON.stringify({
      format: NEON_D_SAVE_FORMAT,
      version: NEON_D_SAVE_VERSION,
      state: createState({
        production: {
          ...createState().production,
          weed: {
            ...createState().production.weed,
            purchasedUpgradeIds: ['hydroponics'],
          },
        },
      }),
    })],
    ['negative producer ownership', JSON.stringify({
      format: NEON_D_SAVE_FORMAT,
      version: NEON_D_SAVE_VERSION,
      state: createState({
        production: {
          ...createState().production,
          weed: {
            ...createState().production.weed,
            producersOwned: -1,
          },
        },
      }),
    })],
    ['fractional muscle ownership', JSON.stringify({
      format: NEON_D_SAVE_FORMAT,
      version: NEON_D_SAVE_VERSION,
      state: createState({
        muscleOwned: {
          ...createState().muscleOwned,
          hoodRat: 1.5,
        },
      }),
    })],
    ['negative territory level', JSON.stringify({
      format: NEON_D_SAVE_FORMAT,
      version: NEON_D_SAVE_VERSION,
      state: createState({ territoryLevel: -1 }),
    })],
    ['fractional kingpins', JSON.stringify({
      format: NEON_D_SAVE_FORMAT,
      version: NEON_D_SAVE_VERSION,
      state: createState({ kingpins: 0.5 }),
    })],
  ])('rejects %s', (_name, text) => {
    expect(() => parseNeonDSave(text)).toThrow();
  });
});
