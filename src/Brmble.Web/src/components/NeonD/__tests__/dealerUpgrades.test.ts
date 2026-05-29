import { describe, expect, it } from 'vitest';
import type { Dealer, OperationUpgradeId } from '../types';
import {
  applyDealerUpgrade,
  canRollDealerUpgrade,
  getDealerEquipmentUpgradeCost,
  getDealerSlotUnlockCost,
  rollDealerUpgradeOptions,
} from '../dealerUpgrades';

const makeDealer = (overrides: Partial<Dealer> = {}): Dealer => ({
  id: 'dealer-1',
  name: 'Dealer One',
  selling: 'weed',
  volume: 1,
  margin: 1,
  volumeBonus: 0,
  marginBonus: 0,
  sideVolume: 0,
  equipmentCount: 0,
  maxEquipmentSlots: 3,
  riskBonus: 0,
  bulkStreetValue: 0,
  baseVolumeGps: 1,
  baseMarginMult: 1,
  volumeStars: 3,
  marginStars: 3,
  isProtected: false,
  isArrested: false,
  nextArrestCheckAt: Date.now() + 60_000,
  hasPendingUpgrade: false,
  pendingUpgradeOptions: [],
  ...overrides,
});

const noOps: Record<OperationUpgradeId, number> = {
  betterVolumeTraining: 0,
  betterMarginTraining: 0,
  saferOperations: 0,
  bulkNetwork: 0,
};

describe('dealerUpgrades', () => {
  it('blocks upgrade rolls when dealer has filled their personal equipment slots', () => {
    expect(canRollDealerUpgrade(makeDealer({ equipmentCount: 3, maxEquipmentSlots: 3 }))).toBe(false);
    expect(canRollDealerUpgrade(makeDealer({ equipmentCount: 3, maxEquipmentSlots: 4 }))).toBe(true);
  });

  it('rolls exactly 3 upgrade options with value ranges and effect rows', () => {
    const options = rollDealerUpgradeOptions({
      dealer: makeDealer(),
      unlockedProduction: ['weed', 'mushrooms'],
      operationUpgrades: noOps,
      random: () => 0.5,
    });

    expect(options).toHaveLength(3);
    expect(options[0].effects.length).toBeGreaterThan(0);
    expect(options[0].value).toBeGreaterThanOrEqual(0.05);
    expect(options[0].value).toBeLessThanOrEqual(0.15);
  });

  it('higher volume training improves volume roll ranges', () => {
    const options = rollDealerUpgradeOptions({
      dealer: makeDealer(),
      unlockedProduction: ['weed'],
      operationUpgrades: { ...noOps, betterVolumeTraining: 1 },
      random: () => 0,
    });

    expect(options[0].type).toBe('VOLUME');
    expect(options[0].value).toBeGreaterThan(0.05);
  });

  it('rarity changes upgrade value instead of being only cosmetic', () => {
    const common = rollDealerUpgradeOptions({
      dealer: makeDealer(),
      unlockedProduction: ['weed'],
      operationUpgrades: noOps,
      random: () => 0,
    })[0];
    const jackpot = rollDealerUpgradeOptions({
      dealer: makeDealer(),
      unlockedProduction: ['weed'],
      operationUpgrades: noOps,
      random: () => 0.99,
    })[0];

    expect(jackpot.value).toBeGreaterThan(common.value);
  });

  it('applies mixed upgrades with positive and negative effects', () => {
    const dealer = applyDealerUpgrade(makeDealer(), {
      type: 'VOLUME',
      rarity: 'RARE',
      tone: 'MIXED',
      label: 'Reckless Crew',
      description: 'Volume +25%, arrest risk +5%',
      value: 0.25,
      effects: [
        { stat: 'volumeBonus', value: 0.25, label: '+25% volume' },
        { stat: 'riskBonus', value: 0.05, label: '+5% arrest risk', isNegative: true },
      ],
    });

    expect(dealer.volumeBonus).toBeCloseTo(0.25, 5);
    expect(dealer.riskBonus).toBeCloseTo(0.05, 5);
    expect(dealer.equipmentCount).toBe(1);
  });

  it('applies risk reduction and clamps effective risk bonus from going below -90%', () => {
    const dealer = applyDealerUpgrade(makeDealer({ riskBonus: -0.88 }), {
      type: 'RISK_REDUCTION',
      rarity: 'UNCOMMON',
      tone: 'POSITIVE',
      label: 'Clean Route',
      description: 'Arrest risk -8%',
      value: 0.08,
      effects: [{ stat: 'riskBonus', value: -0.08, label: '-8% arrest risk' }],
    });

    expect(dealer.riskBonus).toBeCloseTo(-0.9, 5);
  });

  it('bulk upgrades only affect bulk street value, not normal volume', () => {
    const dealer = applyDealerUpgrade(makeDealer(), {
      type: 'BULK',
      rarity: 'UNCOMMON',
      tone: 'POSITIVE',
      label: 'Bulk Contacts',
      description: 'Bulk sales at 20% street value',
      value: 0.20,
      effects: [{ stat: 'bulkStreetValue', value: 0.20, label: '20% bulk street value' }],
    });

    expect(dealer.volumeBonus).toBe(0);
    expect(dealer.bulkStreetValue).toBeCloseTo(0.20, 5);
  });

  it('scales equipment upgrade cost by existing equipment count', () => {
    expect(getDealerEquipmentUpgradeCost(0)).toBe(500);
    expect(getDealerEquipmentUpgradeCost(1)).toBe(1250);
  });

  it('exposes slot unlock costs for engine and UI from one source of truth', () => {
    expect(getDealerSlotUnlockCost(3)).toBe(25_000);
    expect(getDealerSlotUnlockCost(4)).toBe(250_000);
    expect(getDealerSlotUnlockCost(5)).toBe(Number.POSITIVE_INFINITY);
  });
});
