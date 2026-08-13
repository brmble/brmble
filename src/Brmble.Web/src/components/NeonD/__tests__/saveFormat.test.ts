import { describe, expect, it } from 'vitest';
import { createBaseGameState } from '../constants';
import type { GameState } from '../types';
import { makeReferenceCaptain, makeReferenceDealer } from './testFixtures';
import {
  NEON_D_SAVE_FORMAT,
  NEON_D_SAVE_VERSION,
  parseNeonDSave,
  serializeNeonDSave,
} from '../saveFormat';

function createState(overrides: Partial<GameState> = {}): GameState {
  const base = {
    ...JSON.parse(JSON.stringify(createBaseGameState(0))) as GameState,
    availableDealers: [
      makeReferenceDealer({ id: 'candidate-1' }),
      makeReferenceDealer({ id: 'candidate-2', name: 'Candidate Two', volumeMultiplier: 0.85 }),
      makeReferenceDealer({ id: 'candidate-3', name: 'Candidate Three', marginMultiplier: 1.15 }),
    ],
  } satisfies GameState;

  return {
    ...base,
    ...overrides,
  };
}

function createEnvelope(state: GameState): string {
  return JSON.stringify({
    format: NEON_D_SAVE_FORMAT,
    version: NEON_D_SAVE_VERSION,
    state,
  });
}

function createCorruptEnvelope(mutator: (state: GameState) => void): string {
  const state = createState();
  mutator(state);
  return createEnvelope(state);
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

  it('serializes the v4 schema without restoring v1-only fields', () => {
    const state = createState({
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

    expect(parsed.state.schemaVersion).toBe(4);
    expect(parsed.state).not.toHaveProperty('money');
    expect(parsed.state).not.toHaveProperty(legacyResearchField);
    expect(parsed.state).not.toHaveProperty('unlockedProduction');
    expect(parsed.state.offlineEarningsSummary).toEqual(state.offlineEarningsSummary);
  });

  it('round-trips valid v4 progression state while preserving fractional cash, Respect, stock, and earnings', () => {
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
      activeDealers: [
        makeReferenceDealer({
          id: 'dealer-a',
          selling: 'mushrooms',
          volumeMultiplier: 0.75,
          marginMultiplier: 1.25,
          equipmentIds: ['baseballBat', 'bicycle'],
          earningsPerSecondAtArrest: 4.75,
        }),
        null,
      ],
      availableDealers: [
        makeReferenceDealer({ id: 'candidate-a', volumeMultiplier: 0.5, marginMultiplier: 1.5 }),
        makeReferenceDealer({ id: 'candidate-b', selling: 'mushrooms', volumeMultiplier: 0.9, marginMultiplier: 1.1 }),
        makeReferenceDealer({ id: 'candidate-c', volumeMultiplier: 1.4, marginMultiplier: 0.6 }),
      ],
      lastDealerRefreshAt: 1_500,
      captains: [
        makeReferenceCaptain({
          id: 'captain-a',
          selling: 'mushrooms',
          equipmentIds: ['personalAssistant'],
          personalEarnings: 567_890.12,
        }),
      ],
      kingpins: 1,
      bulkUnlockedProductIds: ['weed', 'mushrooms'],
      lastBulkSellAt: 1_000,
      activeMarketEvent: {
        productId: 'mushrooms',
        multiplier: 3.25,
        endsAt: 12_345,
      },
      nextMarketCheckAt: 13_000,
      nextRiskCheckAt: 14_000,
      lastEarningsPerSeller: {
        'dealer-a': 8.25,
        'captain-a': 17.5,
      },
      lastTickAt: 2_000,
      offlineEarningsSummary: {
        actualAwayMs: 90_000,
        simulatedMs: 90_000,
        cashEarned: 4321.09,
        respectEarned: 76.54,
      },
    });

    expect(parseNeonDSave(serializeNeonDSave(state))).toEqual(state);
  });

  it('migrates an older save to per-product bulk selling with no active cooldown', () => {
    const v3State = { ...createState() };
    delete (v3State as Partial<GameState>).lastBulkSellAt;
    const legacyState = {
      ...v3State,
      schemaVersion: 2,
      autoBulkEnabled: true,
    } as unknown as GameState & { autoBulkEnabled: boolean };
    const parsed = parseNeonDSave(JSON.stringify({
      format: NEON_D_SAVE_FORMAT,
      version: 2,
      state: legacyState,
    }));

    expect(parsed.schemaVersion).toBe(4);
    expect(parsed.lastBulkSellAt).toBe(0);
    expect(parsed.bulkUnlockedProductIds).toEqual([]);
    expect(parsed).not.toHaveProperty('autoBulkEnabled');
  });

  it('preserves only explicitly purchased product IDs during a v4 round trip', () => {
    const state = createState({ bulkUnlockedProductIds: ['weed'] });

    expect(parseNeonDSave(serializeNeonDSave(state)).bulkUnlockedProductIds).toEqual(['weed']);
  });

  it.each([
    ['invalid JSON', 'not json'],
    ['wrong format', JSON.stringify({ format: 'other-game', version: NEON_D_SAVE_VERSION, state: createState() })],
    ['unsupported version', JSON.stringify({ format: NEON_D_SAVE_FORMAT, version: NEON_D_SAVE_VERSION + 1, state: createState() })],
    ['missing state', JSON.stringify({ format: NEON_D_SAVE_FORMAT, version: NEON_D_SAVE_VERSION })],
    ['unknown top-level state field', createCorruptEnvelope((state) => {
      (state as GameState & { money?: number }).money = 123;
    })],
    ['unknown product state field', createCorruptEnvelope((state) => {
      (state.production.weed as GameState['production']['weed'] & { legacyRate?: number }).legacyRate = 1;
    })],
    ['non-object state', JSON.stringify({ format: NEON_D_SAVE_FORMAT, version: NEON_D_SAVE_VERSION, state: null })],
    ['invalid numeric state field', JSON.stringify({ format: NEON_D_SAVE_FORMAT, version: NEON_D_SAVE_VERSION, state: createState({ cash: 'rich' as unknown as number }) })],
    ['wrong schema version in state', JSON.stringify({ format: NEON_D_SAVE_FORMAT, version: NEON_D_SAVE_VERSION, state: { ...createState(), schemaVersion: 1 } })],
    ['legacy offline summary shape', createCorruptEnvelope((state) => {
      state.offlineEarningsSummary = { awayMs: 60_000, earned: 250 } as unknown as GameState['offlineEarningsSummary'];
    })],
    ['unknown bulk product ID', createCorruptEnvelope((state) => {
      state.bulkUnlockedProductIds = ['not-a-product' as GameState['bulkUnlockedProductIds'][number]];
    })],
    ['duplicate bulk product ID', createCorruptEnvelope((state) => {
      state.bulkUnlockedProductIds = ['weed', 'weed'];
    })],
    ['non-array bulk product IDs', createCorruptEnvelope((state) => {
      (state as unknown as { bulkUnlockedProductIds: unknown }).bulkUnlockedProductIds = 'weed';
    })],
    ['negative cash', createCorruptEnvelope((state) => {
      state.cash = -0.01;
    })],
    ['negative run earnings', createCorruptEnvelope((state) => {
      state.runEarnings = -1;
    })],
    ['negative respect', createCorruptEnvelope((state) => {
      state.respect = -0.5;
    })],
    ['negative product stock', createCorruptEnvelope((state) => {
      state.production.weed.stock = -1;
    })],
    ['empty unlocked products', createCorruptEnvelope((state) => {
      state.unlockedProducts = [] as GameState['unlockedProducts'];
    })],
    ['out-of-order unlocked products', createEnvelope(createState({
      unlockedProducts: ['weed', 'meth'] as GameState['unlockedProducts'],
    }))],
    ['locked dealer selling', createCorruptEnvelope((state) => {
      state.activeDealers = [makeReferenceDealer({ id: 'dealer-locked', selling: 'mushrooms' })];
    })],
    ['locked captain selling', createCorruptEnvelope((state) => {
      state.captains = [makeReferenceCaptain({ id: 'captain-locked', selling: 'mushrooms' })];
    })],
    ['out-of-order purchased upgrades', createCorruptEnvelope((state) => {
      state.production.weed.purchasedUpgradeIds = ['hydroponics'];
    })],
    ['unknown purchased upgrades', createCorruptEnvelope((state) => {
      state.production.weed.purchasedUpgradeIds = ['fertilizer', 'bogus'] as GameState['production']['weed']['purchasedUpgradeIds'];
    })],
    ['negative producer ownership', createCorruptEnvelope((state) => {
      state.production.weed.producersOwned = -1;
    })],
    ['fractional muscle ownership', createCorruptEnvelope((state) => {
      state.muscleOwned.hoodRat = 1.5;
    })],
    ['negative territory level', createCorruptEnvelope((state) => {
      state.territoryLevel = -1;
    })],
    ['fractional kingpins', createCorruptEnvelope((state) => {
      state.kingpins = 0.5;
    })],
    ['active dealer slots that exceed territory capacity', createCorruptEnvelope((state) => {
      state.territoryLevel = 0;
      state.activeDealers = [null, null];
    })],
    ['candidate pool not exactly three dealers', createCorruptEnvelope((state) => {
      state.availableDealers = [makeReferenceDealer({ id: 'candidate-a' }), makeReferenceDealer({ id: 'candidate-b' })];
    })],
    ['candidate pool with duplicate ids', createCorruptEnvelope((state) => {
      state.availableDealers = [
        makeReferenceDealer({ id: 'candidate-a' }),
        makeReferenceDealer({ id: 'candidate-a', name: 'Duplicate Candidate' }),
        makeReferenceDealer({ id: 'candidate-c' }),
      ];
    })],
    ['captains with duplicate ids', createCorruptEnvelope((state) => {
      state.captains = [
        makeReferenceCaptain({ id: 'captain-a' }),
        makeReferenceCaptain({ id: 'captain-a', name: 'Duplicate Captain' }),
      ];
    })],
    ['captain and active dealer with the same id', createCorruptEnvelope((state) => {
      state.activeDealers = [makeReferenceDealer({ id: 'shared-seller-id' })];
      state.captains = [makeReferenceCaptain({ id: 'shared-seller-id' })];
    })],
    ['active dealer and candidate with the same id', createCorruptEnvelope((state) => {
      state.activeDealers = [makeReferenceDealer({ id: 'shared-seller-id' })];
      state.availableDealers = [
        makeReferenceDealer({ id: 'shared-seller-id' }),
        makeReferenceDealer({ id: 'candidate-b' }),
        makeReferenceDealer({ id: 'candidate-c' }),
      ];
    })],
    ['market event multiplier above the generated maximum', createCorruptEnvelope((state) => {
      state.activeMarketEvent = {
        productId: 'weed',
        multiplier: 1e308,
        endsAt: 60_000,
      };
    })],
    ['dealer equipment ids must be unique', createCorruptEnvelope((state) => {
      state.activeDealers = [
        makeReferenceDealer({
          id: 'dealer-dupe-equip',
          equipmentIds: ['baseballBat', 'baseballBat'],
        }),
      ];
    })],
    ['captain equipment ids must be unique', createCorruptEnvelope((state) => {
      state.unlockedProducts = ['weed', 'mushrooms'];
      state.captains = [
        makeReferenceCaptain({
          id: 'captain-dupe-equip',
          selling: 'mushrooms',
          equipmentIds: ['personalAssistant', 'personalAssistant'],
        }),
      ];
    })],
    ['dealer volume below minimum', createCorruptEnvelope((state) => {
      state.activeDealers = [makeReferenceDealer({ id: 'dealer-low-volume', volumeMultiplier: 0.49 })];
    })],
    ['dealer margin above maximum', createCorruptEnvelope((state) => {
      state.activeDealers = [makeReferenceDealer({ id: 'dealer-high-margin', marginMultiplier: 1.51 })];
    })],
    ['negative last bulk sale timestamp', createCorruptEnvelope((state) => {
      state.lastBulkSellAt = -1;
    })],
    ['negative last earnings per seller', createCorruptEnvelope((state) => {
      state.lastEarningsPerSeller = { dealer: -0.01 };
    })],
    ['negative timestamp', createCorruptEnvelope((state) => {
      state.lastTickAt = -1;
    })],
    ['offline summary with simulated time above actual time', createCorruptEnvelope((state) => {
      state.offlineEarningsSummary = {
        actualAwayMs: 30_000,
        simulatedMs: 30_001,
        cashEarned: 100,
        respectEarned: 10,
      };
    })],
  ])('rejects %s', (_name, text) => {
    expect(() => parseNeonDSave(text)).toThrow();
  });
});
