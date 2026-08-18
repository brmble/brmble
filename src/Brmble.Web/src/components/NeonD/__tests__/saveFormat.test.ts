import { describe, expect, it } from 'vitest';
import { createBaseGameState } from '../constants';
import { createAmsterdamZone } from '../zones';
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

function createCaptainCorruptEnvelope(mutator: (state: GameState) => void): string {
  const state = createState({ captains: [makeReferenceCaptain()] });
  mutator(state);
  return createEnvelope(state);
}

function createTwoZoneState(): GameState {
  const amsterdamCaptain = makeReferenceCaptain({ id: 'captain-amsterdam' });
  const parisCaptain = makeReferenceCaptain({ id: 'captain-paris' });
  return createState({
    territoryLevel: 1,
    captains: [amsterdamCaptain, parisCaptain],
    activeDealers: [],
    zones: [
      createAmsterdamZone(amsterdamCaptain.id),
      {
        id: 'paris',
        displayName: 'Paris',
        captainId: parisCaptain.id,
        dealerSlots: [{ id: 'paris-slot-0', dealer: null, reservedTransferId: null }],
        perkIds: [],
      },
    ],
  });
}

function createTransferState(): GameState {
  const state = createTwoZoneState();
  const transferId = 'transfer-1';
  state.zones[0].dealerSlots[0].reservedTransferId = transferId;
  state.zones[1].dealerSlots[0].reservedTransferId = transferId;
  state.dealerTransfers = [{
    id: transferId,
    dealer: makeReferenceDealer({ id: 'travelling-dealer' }),
    sourceZoneId: 'amsterdam',
    sourceSlotId: 'amsterdam-slot-0',
    destinationZoneId: 'paris',
    destinationSlotId: 'paris-slot-0',
    completesAt: 1_000,
    riskResolved: false,
  }];
  return state;
}

describe('Neon-D save format', () => {
  it('migrates a schema-v5 Captain save into Amsterdam without losing capacity or dealers', () => {
    const captain = makeReferenceCaptain({ id: 'captain-1', name: 'Mika' });
    const dealer = makeReferenceDealer({
      id: 'dealer-1',
      name: 'Jeroen',
      selling: 'mushrooms',
      equipmentIds: ['bicycle'],
      isArrested: true,
      earningsPerSecondAtArrest: 25,
    });
    const legacy = {
      ...createState({
        territoryLevel: 1,
        unlockedProducts: ['weed', 'mushrooms'],
        activeDealers: [captain, dealer],
        captains: [captain, makeReferenceCaptain({ id: 'captain-2', name: 'Samira' })],
      }),
      schemaVersion: 5,
    };

    const migrated = parseNeonDSave(JSON.stringify({
      format: NEON_D_SAVE_FORMAT,
      version: 3,
      state: legacy,
    }));

    expect(migrated.schemaVersion).toBe(6);
    expect(migrated.activeDealers).toEqual([]);
    expect(migrated.zones).toHaveLength(1);
    expect(migrated.zones[0]).toMatchObject({
      id: 'amsterdam',
      displayName: 'Amsterdam',
      captainId: 'captain-1',
    });
    expect(migrated.zones[0].dealerSlots).toHaveLength(2);
    expect(migrated.zones[0].dealerSlots[1].dealer).toMatchObject({
      id: 'dealer-1',
      selling: 'mushrooms',
      equipmentIds: ['bicycle'],
      isArrested: true,
    });
    expect(migrated.captains[1].id).toBe('captain-2');
    expect(migrated.captains[1].zoneBulkSellAvailableAt).toBe(0);
  });

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

  it('round-trips a zero-Captain schema-v6 save in legacy dealer mode', () => {
    const state = createState({ activeDealers: [makeReferenceDealer({ id: 'legacy-dealer' })] });

    expect(parseNeonDSave(serializeNeonDSave(state))).toEqual(state);
  });

  it.each([
    ['a transfer without legacy reservation slots', () => {
      const state = createState();
      state.dealerTransfers = createTransferState().dealerTransfers;
      return state;
    }],
    ['a transfer dealer duplicated in legacy active slots', () => {
      const state = createState();
      const transfer = createTransferState().dealerTransfers[0];
      state.activeDealers = [transfer.dealer];
      state.dealerTransfers = [transfer];
      return state;
    }],
    ['a transfer dealer duplicated in the candidate pool', () => {
      const state = createState();
      const transfer = createTransferState().dealerTransfers[0];
      state.availableDealers[0] = transfer.dealer;
      state.dealerTransfers = [transfer];
      return state;
    }],
    ['a legacy active dealer duplicated in the candidate pool', () => {
      const state = createState();
      state.activeDealers = [state.availableDealers[0]];
      return state;
    }],
  ])('rejects %s in zero-zone legacy mode', (_name, createInvalidState) => {
    expect(() => parseNeonDSave(serializeNeonDSave(createInvalidState()))).toThrow();
  });

  it('round-trips an Amsterdam zone with an assigned Captain, dealer, and unassigned Captain', () => {
    const captain = makeReferenceCaptain({ id: 'captain-amsterdam' });
    const reserveCaptain = makeReferenceCaptain({ id: 'captain-reserve' });
    const dealer = makeReferenceDealer({ id: 'zone-dealer' });
    const state = createState({
      captains: [captain, reserveCaptain],
      activeDealers: [],
      zones: [createAmsterdamZone(captain.id, 1, [dealer])],
    });

    expect(parseNeonDSave(serializeNeonDSave(state))).toEqual(state);
  });

  it('round-trips a valid active transfer with its two matching reservations', () => {
    const state = createTransferState();

    expect(parseNeonDSave(serializeNeonDSave(state))).toEqual(state);
  });

  it('round-trips the exact post-reset pending Amsterdam selection form', () => {
    const firstCaptain = makeReferenceCaptain({ id: 'captain-one' });
    const secondCaptain = makeReferenceCaptain({ id: 'captain-two' });
    const state = createState({
      captains: [firstCaptain, secondCaptain],
      activeDealers: [],
      zones: [createAmsterdamZone(null)],
      pendingAmsterdamCaptainSelection: true,
    });

    expect(parseNeonDSave(serializeNeonDSave(state))).toEqual(state);
  });

  it.each([
    ['zero owned Captains', () => createState({ pendingAmsterdamCaptainSelection: true })],
    ['an assigned Amsterdam Captain', () => {
      const captain = makeReferenceCaptain({ id: 'captain-amsterdam' });
      return createState({
        captains: [captain],
        activeDealers: [],
        zones: [createAmsterdamZone(captain.id)],
        pendingAmsterdamCaptainSelection: true,
      });
    }],
    ['one owned Captain with Amsterdam unassigned', () => {
      const captain = makeReferenceCaptain({ id: 'captain-amsterdam' });
      return createState({
        captains: [captain],
        activeDealers: [],
        zones: [createAmsterdamZone(null)],
        pendingAmsterdamCaptainSelection: true,
      });
    }],
    ['another zone alongside unassigned Amsterdam', () => {
      const state = createTwoZoneState();
      state.zones[0].captainId = null;
      state.pendingAmsterdamCaptainSelection = true;
      return state;
    }],
  ])('rejects an invalid pending Amsterdam selection with %s', (_name, createInvalidState) => {
    expect(() => parseNeonDSave(serializeNeonDSave(createInvalidState()))).toThrow();
  });

  it.each([
    ['duplicate city IDs', () => {
      const state = createTwoZoneState();
      (state.zones[1] as unknown as { id: string }).id = 'amsterdam';
      return state;
    }],
    ['duplicate Captain assignments', () => {
      const state = createTwoZoneState();
      state.zones[1].captainId = state.zones[0].captainId;
      return state;
    }],
    ['a reserved slot without a transfer', () => {
      const state = createTwoZoneState();
      state.zones[0].dealerSlots[0].reservedTransferId = 'missing-transfer';
      return state;
    }],
    ['duplicate transfer IDs', () => {
      const state = createTransferState();
      state.dealerTransfers.push({ ...state.dealerTransfers[0] });
      return state;
    }],
    ['a missing source reservation', () => {
      const state = createTransferState();
      state.zones[0].dealerSlots[0].reservedTransferId = null;
      return state;
    }],
    ['a transfer reservation that points at another slot', () => {
      const state = createTransferState();
      state.territoryLevel = 2;
      state.zones[1].dealerSlots.push({ id: 'paris-slot-1', dealer: null, reservedTransferId: null });
      state.dealerTransfers[0].destinationSlotId = 'paris-slot-1';
      return state;
    }],
    ['a dealer left in a reserved slot', () => {
      const state = createTransferState();
      state.zones[0].dealerSlots[0].dealer = makeReferenceDealer({ id: 'stranded-dealer' });
      return state;
    }],
    ['a reservation that appears more than twice', () => {
      const state = createTransferState();
      state.territoryLevel = 2;
      state.zones[1].dealerSlots.push({ id: 'paris-slot-1', dealer: null, reservedTransferId: 'transfer-1' });
      return state;
    }],
    ['a dealer duplicated between a zone and the candidate pool', () => {
      const state = createTwoZoneState();
      state.zones[0].dealerSlots[0].dealer = state.availableDealers[0];
      return state;
    }],
    ['a dealer duplicated between a transfer and a zone', () => {
      const state = createTransferState();
      state.zones[0].dealerSlots[0].reservedTransferId = null;
      state.zones[1].dealerSlots[0].reservedTransferId = null;
      state.zones[0].dealerSlots[0].dealer = state.dealerTransfers[0].dealer;
      return state;
    }],
    ['a dealer duplicated between a transfer and the candidate pool', () => {
      const state = createTransferState();
      state.availableDealers[0] = state.dealerTransfers[0].dealer;
      return state;
    }],
    ['a zoned dealer sharing an owned Captain ID', () => {
      const state = createTwoZoneState();
      state.zones[0].dealerSlots[0].dealer = makeReferenceDealer({ id: state.captains[0].id });
      return state;
    }],
    ['a transfer dealer sharing an owned Captain ID', () => {
      const state = createTransferState();
      state.dealerTransfers[0].dealer = makeReferenceDealer({ id: state.captains[0].id });
      return state;
    }],
    ['a candidate dealer sharing an owned Captain ID', () => {
      const state = createTwoZoneState();
      state.availableDealers[0] = makeReferenceDealer({ id: state.captains[0].id });
      return state;
    }],
    ['zone capacity that no longer matches territory', () => {
      const state = createTwoZoneState();
      state.territoryLevel = 2;
      return state;
    }],
  ])('rejects %s', (_name, createInvalidState) => {
    expect(() => parseNeonDSave(serializeNeonDSave(createInvalidState()))).toThrow();
  });

  it('rejects a migrated legacy dealer sharing an owned Captain ID', () => {
    const captain = makeReferenceCaptain({ id: 'captain-one' });
    const legacyState = {
      ...createState({
        captains: [captain],
        activeDealers: [makeReferenceDealer({ id: captain.id })],
      }),
      schemaVersion: 5,
    };

    expect(() => parseNeonDSave(JSON.stringify({
      format: NEON_D_SAVE_FORMAT,
      version: 3,
      state: legacyState,
    }))).toThrow();
  });

  it('serializes the v6 schema without restoring legacy fields', () => {
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

    expect(parsed.state.schemaVersion).toBe(6);
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
          purchasedUpgradeIds: ['fertilizer', 'hydroponics'],
        },
        mushrooms: {
          stock: 5.67,
          producersOwned: 1,
          purchasedUpgradeIds: ['autoHygrometer', 'irrigationSystem'],
        },
      },
      muscleOwned: {
        ...createState().muscleOwned,
        hoodRat: 2,
      },
      territoryLevel: 1,
      discountLevel: 2,
      activeDealers: [],
      zones: [createAmsterdamZone('captain-a', 2, [
        makeReferenceDealer({
          id: 'dealer-a',
          selling: 'mushrooms',
          volumeMultiplier: 0.75,
          marginMultiplier: 1.25,
          equipmentIds: ['baseballBat', 'bicycle'],
          earningsPerSecondAtArrest: 4.75,
        }),
        null,
      ])],
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

  it('migrates a schema-v2 save through the current schema while preserving progression', () => {
    const v3State = { ...createState({ captains: [makeReferenceCaptain({ personalEarnings: 42_000 })] }) };
    delete (v3State as Partial<GameState>).lastBulkSellAt;
    const legacyState = {
      ...v3State,
      schemaVersion: 2,
      autoBulkEnabled: true,
    } as unknown as GameState & { autoBulkEnabled: boolean };
    const migrated = parseNeonDSave(JSON.stringify({
      format: NEON_D_SAVE_FORMAT,
      version: 2,
      state: legacyState,
    }));

    expect(migrated.schemaVersion).toBe(6);
    expect(migrated.cash).toBe(legacyState.cash);
    expect(migrated.production).toEqual(legacyState.production);
    expect(migrated.bulkUnlockedProductIds).toEqual([]);
    expect(migrated.lastBulkSellAt).toBe(0);
    expect(migrated.captains[0]).toMatchObject({
      personalEarnings: legacyState.captains[0].personalEarnings,
      level: 0,
      talentPoints: 0,
      talentRanks: { red: [0, 0, 0], yellow: [0, 0, 0], blue: [0, 0, 0] },
      ledgerUnlocked: false,
      kingpinAvailable: false,
    });
  });

  it('round-trips partial and fully developed Captain talent state', () => {
    const partialCaptain = makeReferenceCaptain({
      id: 'captain-partial',
      level: 5,
      talentPoints: 0,
      talentRanks: { red: [2, 3, 0], yellow: [0, 0, 0], blue: [0, 0, 0] },
      ledgerUnlocked: true,
      kingpinAvailable: false,
    });
    const fullCaptain = makeReferenceCaptain({
      id: 'captain-full',
      level: 27,
      talentPoints: 0,
      talentRanks: { red: [2, 3, 4], yellow: [2, 3, 4], blue: [2, 3, 4] },
      ledgerUnlocked: true,
      kingpinAvailable: true,
    });
    const state = createState({
      territoryLevel: 1,
      captains: [partialCaptain, fullCaptain],
      activeDealers: [],
      zones: [createAmsterdamZone(partialCaptain.id, 2)],
    });

    expect(parseNeonDSave(serializeNeonDSave(state))).toEqual(state);
  });

  it('round-trips an assigned Captain slot while retaining the owned Captain record', () => {
    const captain = makeReferenceCaptain({ id: 'captain-slot', name: 'Named Captain' });
    const state = createState({
      captains: [captain],
      activeDealers: [],
      zones: [createAmsterdamZone(captain.id)],
    });

    expect(parseNeonDSave(serializeNeonDSave(state))).toEqual(state);
  });

  it('round-trips the Captain level-up earnings baseline', () => {
    const captain = {
      ...makeReferenceCaptain({ personalEarnings: 1_000_000 }),
      lastLevelUpEarnings: 750_000,
    };
    const state = createState({
      captains: [captain],
      activeDealers: [],
      zones: [createAmsterdamZone(captain.id)],
    });

    expect(parseNeonDSave(serializeNeonDSave(state)).captains[0].lastLevelUpEarnings)
      .toBe(750_000);
  });

  it('normalizes a missing Captain baseline when importing a schema-v5 save', () => {
    const captain = makeReferenceCaptain({ personalEarnings: 750_000 });
    delete (captain as Partial<GameState['captains'][number]>).lastLevelUpEarnings;
    const state = {
      ...createState({ captains: [captain] }),
      schemaVersion: 5,
    } as unknown as GameState;

    const imported = parseNeonDSave(createEnvelope(state));

    expect(imported.captains[0].lastLevelUpEarnings).toBe(750_000);
  });

  it('preserves only explicitly purchased product IDs during a v4 round trip', () => {
    const baseState = createState();
    const state = createState({
      production: {
        ...baseState.production,
        weed: {
          ...baseState.production.weed,
          purchasedUpgradeIds: ['fertilizer', 'hydroponics'],
        },
      },
      bulkUnlockedProductIds: ['weed'],
    });

    expect(parseNeonDSave(serializeNeonDSave(state)).bulkUnlockedProductIds).toEqual(['weed']);
  });

  it('rejects a bulk unlock for an unlocked product that is not fully upgraded', () => {
    const baseState = createState();
    const state = createState({
      bulkUnlockedProductIds: ['weed'],
      production: {
        ...baseState.production,
        weed: {
          ...baseState.production.weed,
          purchasedUpgradeIds: ['fertilizer'],
        },
      },
    });

    expect(() => parseNeonDSave(createEnvelope(state))).toThrow();
  });

  it('rejects a bulk unlock for a product that is still locked', () => {
    const state = createState({ bulkUnlockedProductIds: ['mushrooms'] });

    expect(() => parseNeonDSave(createEnvelope(state))).toThrow();
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
    ['captain missing talent fields', createCaptainCorruptEnvelope((state) => {
      delete (state.captains[0] as unknown as Record<string, unknown>).talentRanks;
    })],
    ['captain with negative talent points', createCaptainCorruptEnvelope((state) => {
      state.captains[0].talentPoints = -1;
    })],
    ['captain with invalid level-up earnings baseline', createCaptainCorruptEnvelope((state) => {
      (state.captains[0] as unknown as Record<string, unknown>).lastLevelUpEarnings = -1;
    })],
    ['captain with fractional talent points', createCaptainCorruptEnvelope((state) => {
      state.captains[0].talentPoints = 0.5;
    })],
    ['captain with unknown talent path', createCaptainCorruptEnvelope((state) => {
      (state.captains[0].talentRanks as unknown as Record<string, unknown>).rogue = [0, 0, 0];
    })],
    ['captain with rank gap', createCaptainCorruptEnvelope((state) => {
      state.captains[0].level = 2;
      state.captains[0].talentPoints = 1;
      state.captains[0].talentRanks.red = [2, 1, 0];
    })],
    ['captain with mismatched point accounting', createCaptainCorruptEnvelope((state) => {
      state.captains[0].level = 1;
      state.captains[0].talentPoints = 0;
      state.captains[0].talentRanks.red = [1, 0, 0];
    })],
    ['captain with invalid ledger unlock flag', createCaptainCorruptEnvelope((state) => {
      state.captains[0].ledgerUnlocked = true;
    })],
    ['captain with out-of-range level', createCaptainCorruptEnvelope((state) => {
      state.captains[0].level = 29;
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
