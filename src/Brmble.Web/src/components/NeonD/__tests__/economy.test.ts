import { describe, expect, it } from 'vitest';
import { CAPTAIN_LEVEL_THRESHOLDS, createBaseGameState } from '../constants';
import {
  getBailCost,
  getCaptainCost,
  getCaptainEligibleLevel,
  getCaptainLevelProgress,
  getCaptainLevelRequirement,
  getCaptainRemainingThreshold,
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
  isCaptainLevelUpAvailable,
  isProductFullyUpgraded,
  isRiskActive,
} from '../economy';
import { makeReferenceCaptain } from './testFixtures';

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
    state.captains.push(makeReferenceCaptain({ id: 'captain-1' }));
    expect(getRespectPerSecond(state)).toBeCloseTo(2);
    state.captains[0].level = 10;
    expect(getRespectPerSecond(state)).toBeCloseTo(7);
    state.kingpins = 1;
    expect(getRespectPerSecond(state)).toBeCloseTo(8);
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
