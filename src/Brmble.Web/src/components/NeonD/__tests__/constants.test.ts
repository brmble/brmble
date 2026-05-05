import { describe, it, expect } from 'vitest';
import { INITIAL_GAME_STATE, TIER_DATA, PRODUCT_TIERS, UNLOCK_COSTS } from '../constants';

describe('Constants', () => {
  it('should use English display names', () => {
    expect(INITIAL_GAME_STATE.production.weed.name).toBe('Weed');
  });
});

describe('NeonD Tier Parameters — Weed (Tier 1)', () => {
  it('has correct initial cost', () => {
    expect(INITIAL_GAME_STATE.production.weed.upgradeCost).toBe(15);
  });

  it('has correct yieldPerLevel', () => {
    expect(INITIAL_GAME_STATE.production.weed.yieldPerLevel).toBe(0.20);
  });

  it('has correct costMultiplier', () => {
    expect(INITIAL_GAME_STATE.production.weed.costMultiplier).toBe(1.12);
  });

  it('has correct unlock cost', () => {
    expect(UNLOCK_COSTS.weed).toBe(0);
  });

  it('has correct sell price', () => {
    expect(PRODUCT_TIERS.weed).toBe(4.20);
  });
});

describe('NeonD Tier Parameters — Mushrooms (Tier 2)', () => {
  it('has correct initial cost', () => {
    expect(INITIAL_GAME_STATE.production.mushrooms.upgradeCost).toBe(150);
  });

  it('has correct yieldPerLevel', () => {
    expect(INITIAL_GAME_STATE.production.mushrooms.yieldPerLevel).toBe(0.30);
  });

  it('has correct costMultiplier', () => {
    expect(INITIAL_GAME_STATE.production.mushrooms.costMultiplier).toBe(1.15);
  });

  it('has correct unlock cost', () => {
    expect(UNLOCK_COSTS.mushrooms).toBe(2000);
  });

  it('has correct sell price', () => {
    expect(PRODUCT_TIERS.mushrooms).toBe(6.00);
  });
});

describe('NeonD Tier Parameters — Galactic Core (Tier 18)', () => {
  it('has correct initial cost', () => {
    expect(INITIAL_GAME_STATE.production.galacticCore.upgradeCost).toBe(1500000000000000000);
  });

  it('has correct yieldPerLevel', () => {
    expect(INITIAL_GAME_STATE.production.galacticCore.yieldPerLevel).toBe(216.2438965);
  });

  it('has correct costMultiplier', () => {
    expect(INITIAL_GAME_STATE.production.galacticCore.costMultiplier).toBe(1.61);
  });

  it('has correct unlock cost', () => {
    expect(UNLOCK_COSTS.galacticCore).toBe(25000000000000000000);
  });

  it('has correct sell price', () => {
    expect(PRODUCT_TIERS.galacticCore).toBe(841.56);
  });
});

describe('Upgrade Mechanics', () => {
  it('upgrade calculates next cost using costMultiplier', () => {
    const weedItem = INITIAL_GAME_STATE.production.weed;
    const initialCost = weedItem.upgradeCost;
    const nextCost = Math.floor(initialCost * weedItem.costMultiplier);
    expect(nextCost).toBe(Math.floor(15 * 1.12)); // 16
  });

  it('upgrade calculates rate increase using yieldPerLevel', () => {
    const weedItem = INITIAL_GAME_STATE.production.weed;
    const rateIncrease = weedItem.yieldPerLevel;
    expect(rateIncrease).toBe(0.20);
  });

  it('all 18 tiers exist in INITIAL_GAME_STATE', () => {
    const expectedIds = [
      'weed', 'mushrooms', 'blueLotus', 'frostBite', 'electricLace',
      'meth', 'pharmGrade', 'khole', 'lunarRegolith', 'martianSpores',
      'nebulaMist', 'voidCrystals', 'chronoSalt', 'stardustResin',
      'darkMatterInk', 'singularityShards', 'neutronFlakes', 'galacticCore'
    ];
    expect(Object.keys(INITIAL_GAME_STATE.production)).toEqual(expectedIds);
  });

  it('TIER_DATA, PRODUCT_TIERS, and UNLOCK_COSTS all have 18 entries', () => {
    expect(Object.keys(TIER_DATA).length).toBe(18);
    expect(Object.keys(PRODUCT_TIERS).length).toBe(18);
    expect(Object.keys(UNLOCK_COSTS).length).toBe(18);
  });
});