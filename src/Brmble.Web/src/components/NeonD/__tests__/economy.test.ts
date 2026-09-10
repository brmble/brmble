import { describe, expect, it } from 'vitest';
import { CAPTAIN_LEVEL_THRESHOLDS, createBaseGameState } from '../constants';
import {
  getBailCost,
  getCaptainCost,
  getCaptainEligibleLevel,
  getCaptainLevelProgress,
  getCaptainLevelRequirement,
  getCaptainRemainingThreshold,
  getCaptainZoneBulkRemainingMs,
  canCaptainZoneBulkSell,
  getDealerCapacityCost,
  getDiscountCost,
  getDiscountMultiplier,
  getEquipmentCost,
  getEffectiveStreetValue,
  getProducerCost,
  getProductProductionRate,
  getRecruitmentRefreshMs,
  getRecruitmentRefreshRemainingMs,
  getRespectPerSecond,
  getTerritoryCost,
  getZoneDealerCapacityQuote,
  getZoneUnlockCost,
  getVisibleProductIds,
  isBulkSellingVisible,
  isCaptainVisible,
  isCaptainLevelUpAvailable,
  isProductFullyUpgraded,
  isRiskActive,
} from '../economy';
import { makeReferenceCaptain } from './testFixtures';
import { createAmsterdamZone } from '../zones';
import type { Captain } from '../types';

describe('Neon-D economy formulas', () => {
  const getCapacityQuote = (
    captainCount: number,
    territoryLevel: number,
    slotCount: number,
  ) => {
    const state = createBaseGameState(0);
    state.territoryLevel = territoryLevel;
    state.captains = Array.from({ length: captainCount }, (_, index) =>
      makeReferenceCaptain({ id: `captain-${index + 1}` }),
    );

    return getZoneDealerCapacityQuote(
      state,
      createAmsterdamZone(state.captains[0]?.id ?? null, slotCount),
    );
  };

  it('prices producers with exponential ownership growth and global discount', () => {
    expect(getProducerCost('weed', 0, 0)).toBeCloseTo(15);
    expect(getProducerCost('weed', 1, 0)).toBeCloseTo(16.8);
    expect(getProducerCost('weed', 1, 2)).toBeCloseTo(16.8 * 0.9 * 0.9);
  });

  it('compounds product upgrades and Kingpin production', () => {
    const state = createBaseGameState(0);
    state.production.weed.producersOwned = 2;
    state.production.weed.purchasedUpgradeIds = ['fertilizer', 'hydroponics'];
    state.kingpins = 1;
    expect(getProductProductionRate(state, 'weed')).toBeCloseTo(2 * 0.20 * 1.30 * 1.50 * 2);
  });

  it('recognizes when every upgrade for a product has been purchased', () => {
    const state = createBaseGameState(0);

    expect(isProductFullyUpgraded(state, 'weed')).toBe(false);

    state.production.weed.purchasedUpgradeIds = ['fertilizer'];
    expect(isProductFullyUpgraded(state, 'weed')).toBe(false);

    state.production.weed.purchasedUpgradeIds = ['fertilizer', 'hydroponics'];
    expect(isProductFullyUpgraded(state, 'weed')).toBe(true);
  });

  it('reveals only the next product after 80 percent of its research cost', () => {
    const state = createBaseGameState(0);
    state.runEarnings = 1_599;
    expect(getVisibleProductIds(state)).toEqual(['weed']);
    state.runEarnings = 1_600;
    expect(getVisibleProductIds(state)).toEqual(['weed', 'mushrooms']);
    state.unlockedProducts.push('mushrooms');
    state.runEarnings = 5_600;
    expect(getVisibleProductIds(state)).toEqual(['weed', 'mushrooms', 'meth']);
  });

  it('uses the exact progression gates from the alignment spec', () => {
    const state = createBaseGameState(0);

    state.runEarnings = 1_599;
    expect(getVisibleProductIds(state)).toEqual(['weed']);
    state.runEarnings = 1_600;
    expect(getVisibleProductIds(state)).toContain('mushrooms');

    const gates = [
      { before: 29_999, at: 30_000, predicate: isRiskActive },
      { before: 212_387, at: 212_388, predicate: isBulkSellingVisible },
      { before: 7_499_999, at: 7_500_000, predicate: isCaptainVisible },
    ] as const;

    for (const gate of gates) {
      state.runEarnings = gate.before;
      expect(gate.predicate(state)).toBe(false);
      state.runEarnings = gate.at;
      expect(gate.predicate(state)).toBe(true);
    }
  });

  it('uses exact Respect progression formulas', () => {
    expect(getTerritoryCost(0)).toBe(500);
    expect(getTerritoryCost(1)).toBeCloseTo(2_600);
    expect(getDiscountCost(0)).toBe(1_000);
    expect(getDiscountCost(1)).toBeCloseTo(3_800);
    expect(getDiscountMultiplier(2)).toBeCloseTo(0.81);
  });

  it('prices additional zones only by expansion level', () => {
    const oneZone = createBaseGameState(0);
    oneZone.zones = [createAmsterdamZone('captain-1')];
    oneZone.activeDealers = [];

    const twoZones = {
      ...oneZone,
      zones: [
        ...oneZone.zones,
        { id: 'paris' as const, displayName: 'Paris', captainId: 'captain-2', dealerSlots: [], perkIds: [] },
      ],
    };

    expect(getZoneUnlockCost(oneZone)).toBe(1_500);
    expect(getZoneUnlockCost(twoZones)).toBe(7_800);
  });

  it('keeps dealer capacity pricing on the existing global territory curve', () => {
    expect(getDealerCapacityCost(0)).toBe(getTerritoryCost(0));
    expect(getDealerCapacityCost(3)).toBe(getTerritoryCost(3));
  });

  it('keeps the legacy global dealer-capacity curve unchanged', () => {
    expect(getDealerCapacityCost(0)).toBe(500);
    expect(getDealerCapacityCost(1)).toBeCloseTo(2_600);
    expect(getDealerCapacityCost(2)).toBeCloseTo(13_520);
    expect(getDealerCapacityCost(3)).toBeCloseTo(70_304);
  });

  it('keeps zero-Captain zones on the legacy global capacity curve', () => {
    const quote = getCapacityQuote(0, 2, 3);

    expect(quote.baseCost).toBeCloseTo(13_520);
    expect(quote.concentrationMultiplier).toBe(1);
    expect(quote.finalCost).toBeCloseTo(13_520);
    expect(quote.zoneDealerSlotCount).toBe(3);
  });

  it('keeps one-Captain Amsterdam on the normal global capacity curve', () => {
    const quote = getCapacityQuote(1, 2, 3);

    expect(quote.baseCost).toBeCloseTo(13_520);
    expect(quote.concentrationMultiplier).toBe(1);
    expect(quote.finalCost).toBeCloseTo(13_520);
    expect(quote.zoneDealerSlotCount).toBe(3);
  });

  it('keeps the first three slots normal for a multi-Captain zone', () => {
    for (const slotCount of [0, 1, 2]) {
      const quote = getCapacityQuote(2, 4, slotCount);
      expect(quote.baseCost).toBeCloseTo(getDealerCapacityCost(4));
      expect(quote.concentrationMultiplier).toBe(1);
      expect(quote.finalCost).toBeCloseTo(getDealerCapacityCost(4));
    }
  });

  it('applies the exact concentration multipliers from the fourth slot onward', () => {
    expect(getCapacityQuote(2, 2, 3).concentrationMultiplier).toBeCloseTo(2.5);
    expect(getCapacityQuote(2, 3, 4).concentrationMultiplier).toBeCloseTo(6.25);
    expect(getCapacityQuote(2, 4, 5).concentrationMultiplier).toBeCloseTo(15.625);
    expect(getCapacityQuote(2, 5, 6).concentrationMultiplier).toBeCloseTo(39.0625);
  });

  it('multiplies the current global base by only the expanded zone local surcharge', () => {
    const concentrated = getCapacityQuote(2, 2, 3);
    const freshZone = getCapacityQuote(2, 2, 0);

    expect(concentrated.finalCost).toBeCloseTo(13_520 * 2.5);
    expect(freshZone.finalCost).toBeCloseTo(13_520);
  });

  it('never counts a Captain position as a dealer slot', () => {
    const quote = getCapacityQuote(2, 2, 3);

    expect(quote.zoneDealerSlotCount).toBe(3);
    expect(quote.concentrationMultiplier).toBeCloseTo(2.5);
  });

  it('reports Captain zone bulk readiness and remaining cooldown', () => {
    const captain = makeReferenceCaptain({ id: 'bulk-ready', zoneBulkSellAvailableAt: 10_000 });
    const state = createBaseGameState(0);
    state.captains = [captain];
    state.zones = [createAmsterdamZone(captain.id)];
    state.production.weed.stock = 1_500;

    expect(getCaptainZoneBulkRemainingMs(captain, 4_000)).toBe(6_000);
    expect(getCaptainZoneBulkRemainingMs(captain, 10_000)).toBe(0);
    expect(canCaptainZoneBulkSell(state, captain.id, 4_000)).toBe(false);

    const readyCaptain: Captain = {
      ...captain,
      zoneBulkSellAvailableAt: 0,
      ledgerUnlocked: true,
      talentRanks: { red: [0, 0, 0], yellow: [2, 3, 4], blue: [0, 0, 0] },
    };
    state.captains[0] = readyCaptain;
    expect(canCaptainZoneBulkSell(state, captain.id, 4_000)).toBe(true);

    state.captains[0] = {
      ...readyCaptain,
      talentRanks: { red: [0, 0, 0], yellow: [2, 3, 3], blue: [0, 0, 0] },
    };
    expect(canCaptainZoneBulkSell(state, captain.id, 4_000)).toBe(false);

    state.captains[0] = readyCaptain;
    state.zones = [createAmsterdamZone(null)];
    expect(canCaptainZoneBulkSell(state, captain.id, 4_000)).toBe(false);
  });

  it('applies only assigned Captain and Kingpin Respect bonuses', () => {
    const state = createBaseGameState(0);
    state.muscleOwned.hoodRat = 1;
    expect(getRespectPerSecond(state)).toBeCloseTo(1);
    state.captains = [
      makeReferenceCaptain({ id: 'captain-assigned', level: 2 }),
      makeReferenceCaptain({ id: 'captain-unassigned', level: 10 }),
    ];
    state.zones = [createAmsterdamZone('captain-assigned')];
    state.activeDealers = [];
    expect(getRespectPerSecond(state)).toBeCloseTo(3);
    state.kingpins = 1;
    expect(getRespectPerSecond(state)).toBeCloseTo(4);
  });

  it('preserves legacy zero-zone active Captain Respect bonuses', () => {
    const state = createBaseGameState(0);
    const captain = makeReferenceCaptain({ id: 'legacy-captain', level: 2 });
    state.muscleOwned.hoodRat = 1;
    state.captains = [captain];
    state.activeDealers = [captain];

    expect(getRespectPerSecond(state)).toBeCloseTo(3);
  });

  it('ignores an owned but inactive Captain for zero-zone Respect', () => {
    const state = createBaseGameState(0);
    state.muscleOwned.hoodRat = 1;
    state.captains = [makeReferenceCaptain({ id: 'inactive-captain', level: 10 })];

    expect(getRespectPerSecond(state)).toBeCloseTo(1);
  });

  it('returns the amount still needed for the current Captain next level', () => {
    expect(getCaptainRemainingThreshold(0, 125_000, 0)).toBe(375_000);
  });

  it('clamps the remaining Captain threshold at zero after eligibility', () => {
    expect(getCaptainRemainingThreshold(0, 500_000, 0)).toBe(0);
  });

  it('returns null after the final Captain level', () => {
    expect(getCaptainRemainingThreshold(CAPTAIN_LEVEL_THRESHOLDS.length, 999_999_999, 0)).toBeNull();
  });

  it('starts the next level at zero until the current Captain level is claimed', () => {
    expect(getCaptainLevelRequirement(0)).toBe(500_000);
    expect(getCaptainLevelRequirement(1)).toBe(450_000);
    expect(getCaptainLevelProgress(0, 750_000, 0)).toBe(500_000);
    expect(getCaptainRemainingThreshold(0, 750_000, 0)).toBe(0);
    expect(isCaptainLevelUpAvailable(0, 750_000, 0)).toBe(true);

    expect(getCaptainLevelProgress(1, 750_000, 750_000)).toBe(0);
    expect(getCaptainRemainingThreshold(1, 750_000, 750_000)).toBe(450_000);
    expect(isCaptainLevelUpAvailable(1, 750_000, 750_000)).toBe(false);
  });

  it('counts only new earnings after a claimed level toward the next level', () => {
    expect(getCaptainLevelProgress(1, 1_000_000, 750_000)).toBe(250_000);
    expect(getCaptainRemainingThreshold(1, 1_000_000, 750_000)).toBe(200_000);
    expect(isCaptainLevelUpAvailable(1, 1_200_000, 750_000)).toBe(true);
  });

  it('prices Captain equipment at four times normal base price before discount', () => {
    expect(getEquipmentCost('baseballBat', 'dealer', 0)).toBe(150);
    expect(getEquipmentCost('baseballBat', 'captain', 0)).toBe(600);
    expect(getEquipmentCost('baseballBat', 'captain', 1)).toBeCloseTo(540);
  });

  it('prices Captains from owned count using the escalating recruitment schedule', () => {
    const state = createBaseGameState(0);
    const captain = (id: string) => makeReferenceCaptain({ id });

    expect(getCaptainCost(state)).toBe(7_500_000);
    state.captains.push(captain('captain-1'));
    expect(getCaptainEligibleLevel(499_999)).toBe(0);
    expect(getCaptainEligibleLevel(500_000)).toBe(1);
    expect(getCaptainCost(state)).toBe(10_000_000);
    state.captains.push(captain('captain-2'));
    expect(getCaptainCost(state)).toBe(15_000_000);
    state.captains.push(captain('captain-3'));
    expect(getCaptainCost(state)).toBe(20_000_000);
    state.captains.push(captain('captain-4'));
    expect(getCaptainCost(state)).toBe(25_000_000);
  });

  it('ignores Kingpins and discounts when pricing Captains', () => {
    const state = createBaseGameState(0);
    state.captains.push(makeReferenceCaptain({ id: 'captain-1' }));
    state.kingpins = 3;
    state.discountLevel = 1;

    expect(getCaptainCost(state)).toBe(10_000_000);
  });

  it('reduces recruitment refresh by one second per Kingpin to a one-second floor', () => {
    expect(getRecruitmentRefreshMs(0)).toBe(60_000);
    expect(getRecruitmentRefreshMs(10)).toBe(50_000);
    expect(getRecruitmentRefreshMs(100)).toBe(1_000);
    expect(getRecruitmentRefreshRemainingMs({ kingpins: 1, lastDealerRefreshAt: 10_000 }, 20_000)).toBe(49_000);
  });

  it('prices bail from the arrested dealer earnings snapshot only', () => {
    expect(getBailCost(0)).toBe(0);
    expect(getBailCost(12.5)).toBeCloseTo(1_187.5);
  });

  it('applies an active market multiplier only to its product street value', () => {
    const state = createBaseGameState(0);
    state.activeMarketEvent = { productId: 'weed', multiplier: 4, endsAt: 60_000 };

    expect(getEffectiveStreetValue(state, 'weed')).toBeCloseTo(4.2 * 4);
    expect(getEffectiveStreetValue(state, 'mushrooms')).toBeCloseTo(6);
  });
});
