import { describe, expect, it } from 'vitest';
import {
  createDefaultProductUpgradeState,
  getProductDistributionMultiplier,
  getProductPriceMultiplier,
  getProductProductionMultiplier,
  getProductRiskMultiplier,
  getProductUpgradeCost,
  upgradeProductTrack,
} from '../productUpgrades';

describe('productUpgrades', () => {
  it('creates default tracks for MVP product upgrade categories', () => {
    const state = createDefaultProductUpgradeState(['weed']);

    expect(state.weed.PURITY.level).toBe(0);
    expect(state.weed.AUTOMATION.maxLevel).toBe(3);
    expect(state.weed.CONCEALMENT.maxLevel).toBe(3);
    expect(state.weed.DISTRIBUTION.maxLevel).toBe(2);
  });

  it('scales upgrade cost by category and current level', () => {
    expect(getProductUpgradeCost('PURITY', 0)).toBe(1_000);
    expect(getProductUpgradeCost('PURITY', 1)).toBe(4_000);
    expect(getProductUpgradeCost('DISTRIBUTION', 0)).toBe(5_000);
  });

  it('increments a product track without mutating the original state', () => {
    const state = createDefaultProductUpgradeState(['weed']);
    const next = upgradeProductTrack(state, 'weed', 'PURITY');

    expect(state.weed.PURITY.level).toBe(0);
    expect(next.weed.PURITY.level).toBe(1);
  });

  it('applies product modifiers from upgraded tracks', () => {
    const state = upgradeProductTrack(
      upgradeProductTrack(
        upgradeProductTrack(
          upgradeProductTrack(createDefaultProductUpgradeState(['weed']), 'weed', 'PURITY'),
          'weed',
          'AUTOMATION',
        ),
        'weed',
        'CONCEALMENT',
      ),
      'weed',
      'DISTRIBUTION',
    );

    expect(getProductPriceMultiplier(state, 'weed')).toBeCloseTo(1.12, 5);
    expect(getProductProductionMultiplier(state, 'weed')).toBeCloseTo(1.2, 5);
    expect(getProductRiskMultiplier(state, 'weed')).toBeCloseTo(0.9, 5);
    expect(getProductDistributionMultiplier(state, 'weed')).toBeCloseTo(1.15, 5);
  });
});
