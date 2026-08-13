import { describe, expect, it } from 'vitest';
import { createBaseGameState } from '../constants';
import {
  getBailCost,
  getCaptainCost,
  getCaptainLevel,
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
  getVisibleProductIds,
  isBulkSellingVisible,
  isCaptainVisible,
  isProductFullyUpgraded,
  isRiskActive,
} from '../economy';

describe('Neon-D economy formulas', () => {
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

  it('applies Captain and Kingpin Respect bonuses', () => {
    const state = createBaseGameState(0);
    state.muscleOwned.hoodRat = 1;
    expect(getRespectPerSecond(state)).toBeCloseTo(1);
    state.captains.push({ id: 'captain-1', name: 'Captain One', selling: 'weed', equipmentIds: [], personalEarnings: 0 });
    expect(getRespectPerSecond(state)).toBeCloseTo(2);
    state.captains[0].personalEarnings = 161_340_000;
    expect(getRespectPerSecond(state)).toBeCloseTo(7);
    state.kingpins = 1;
    expect(getRespectPerSecond(state)).toBeCloseTo(8);
  });

  it('prices Captain equipment at four times normal base price before discount', () => {
    expect(getEquipmentCost('baseballBat', 'dealer', 0)).toBe(150);
    expect(getEquipmentCost('baseballBat', 'captain', 0)).toBe(600);
    expect(getEquipmentCost('baseballBat', 'captain', 1)).toBeCloseTo(540);
  });

  it('uses exact Captain thresholds and cost growth', () => {
    const state = createBaseGameState(0);
    expect(getCaptainCost(state)).toBe(5_000_000);
    state.captains.push({ id: 'captain-1', name: 'Captain One', selling: 'weed', equipmentIds: [], personalEarnings: 500_000 });
    expect(getCaptainLevel(499_999)).toBe(0);
    expect(getCaptainLevel(500_000)).toBe(1);
    expect(getCaptainCost(state)).toBeCloseTo(5_000_000 * 1.18);
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
