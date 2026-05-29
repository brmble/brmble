import type { Dealer, DealerUpgrade, DealerUpgradeRarity, OperationUpgradeId } from './types';

type RollArgs = {
  dealer: Dealer;
  unlockedProduction: string[];
  operationUpgrades: Record<OperationUpgradeId, number>;
  random?: () => number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const rollRange = (min: number, max: number, random: () => number) =>
  min + random() * (max - min);

const percent = (value: number) => `${value >= 0 ? '+' : '-'}${Math.round(Math.abs(value) * 100)}%`;

const getTrainingRange = (level: number): [number, number] => {
  if (level >= 3) return [0.15, 0.25];
  if (level === 2) return [0.10, 0.20];
  if (level === 1) return [0.075, 0.175];
  return [0.05, 0.15];
};

const rollRarity = (random: () => number): DealerUpgradeRarity => {
  const roll = random();
  if (roll < 0.65) return 'COMMON';
  if (roll < 0.90) return 'UNCOMMON';
  if (roll < 0.98) return 'RARE';
  return 'JACKPOT';
};

const RARITY_VALUE_MULTIPLIER: Record<DealerUpgradeRarity, number> = {
  COMMON: 1,
  UNCOMMON: 1.15,
  RARE: 1.35,
  JACKPOT: 1.75,
};

const applyRarityValue = (value: number, rarity: DealerUpgradeRarity, cap = 0.9) =>
  clamp(value * RARITY_VALUE_MULTIPLIER[rarity], 0, cap);

const buildVolumeUpgrade = (value: number, rarity: DealerUpgradeRarity): DealerUpgrade => ({
  type: 'VOLUME',
  rarity,
  tone: 'POSITIVE',
  label: 'Street Runners',
  description: `Volume ${percent(value)}`,
  value,
  effects: [{ stat: 'volumeBonus', value, label: `${percent(value)} volume` }],
});

const buildMarginUpgrade = (value: number, rarity: DealerUpgradeRarity): DealerUpgrade => ({
  type: 'MARGIN',
  rarity,
  tone: 'POSITIVE',
  label: 'Ferrari',
  description: `Margin ${percent(value)}`,
  value,
  effects: [{ stat: 'marginBonus', value, label: `${percent(value)} margin` }],
});

const buildRiskReductionUpgrade = (value: number, rarity: DealerUpgradeRarity): DealerUpgrade => ({
  type: 'RISK_REDUCTION',
  rarity,
  tone: 'POSITIVE',
  label: 'Clean Route',
  description: `Arrest risk ${percent(-value)}`,
  value,
  riskReduction: value,
  effects: [{ stat: 'riskBonus', value: -value, label: `${percent(-value)} arrest risk` }],
});

const buildBulkUpgrade = (value: number, rarity: DealerUpgradeRarity): DealerUpgrade => ({
  type: 'BULK',
  rarity,
  tone: 'POSITIVE',
  label: rarity === 'JACKPOT' ? 'Black Market Network' : 'Bulk Contacts',
  description: `Bulk sales at ${Math.round(value * 100)}% street value`,
  value,
  bulkStreetValue: value,
  effects: [{ stat: 'bulkStreetValue', value, label: `${Math.round(value * 100)}% bulk street value` }],
});

const buildSideHustleUpgrade = (
  value: number,
  rarity: DealerUpgradeRarity,
  sideProductId: string,
): DealerUpgrade => ({
  type: 'SIDE_HUSTLE',
  rarity,
  tone: 'POSITIVE',
  label: 'Side Hustle',
  description: `Side volume ${percent(value)}`,
  value,
  sideVolumeValue: value,
  sideProductId,
  effects: [{ stat: 'sideVolume', value, label: `${percent(value)} side volume` }],
});

const buildMixedUpgrade = (rarity: DealerUpgradeRarity, random: () => number): DealerUpgrade => {
  const value = applyRarityValue(rollRange(0.20, 0.25, random), rarity, 0.5);
  return {
    type: 'VOLUME',
    rarity,
    tone: 'MIXED',
    label: 'Reckless Crew',
    description: `Volume ${percent(value)}, arrest risk +5%`,
    value,
    riskPenalty: 0.05,
    effects: [
      { stat: 'volumeBonus', value, label: `${percent(value)} volume` },
      { stat: 'riskBonus', value: 0.05, label: '+5% arrest risk', isNegative: true },
    ],
  };
};

export const getDealerEquipmentUpgradeCost = (equipmentCount: number) =>
  500 * Math.pow(2.5, equipmentCount);

export const getDealerSlotUnlockCost = (maxEquipmentSlots: number) => {
  const costs: Record<number, number> = { 3: 25_000, 4: 250_000 };
  return costs[maxEquipmentSlots] ?? Number.POSITIVE_INFINITY;
};

export const canRollDealerUpgrade = (dealer: Dealer) =>
  dealer.equipmentCount < dealer.maxEquipmentSlots;

export const rollDealerUpgradeOptions = ({
  dealer,
  unlockedProduction,
  operationUpgrades,
  random = Math.random,
}: RollArgs): DealerUpgrade[] => {
  const sideHustleProducts = unlockedProduction.filter(id => id !== dealer.selling);
  const options: DealerUpgrade[] = [];

  for (let i = 0; i < 3; i += 1) {
    const rarity = rollRarity(random);
    const typeRoll = random();
    const mixedRoll = random();

    if (mixedRoll < 0.20 && rarity !== 'COMMON') {
      options.push(buildMixedUpgrade(rarity, random));
      continue;
    }

    if (typeRoll < 0.20) {
      const [min, max] = getTrainingRange(operationUpgrades.betterVolumeTraining);
      options.push(buildVolumeUpgrade(applyRarityValue(rollRange(min, max, random), rarity), rarity));
    } else if (typeRoll < 0.40) {
      const [min, max] = getTrainingRange(operationUpgrades.betterMarginTraining);
      options.push(buildMarginUpgrade(applyRarityValue(rollRange(min, max, random), rarity), rarity));
    } else if (typeRoll < 0.60) {
      const saferBonus = operationUpgrades.saferOperations * 0.01;
      options.push(buildRiskReductionUpgrade(applyRarityValue(rollRange(0.03 + saferBonus, 0.08 + saferBonus, random), rarity), rarity));
    } else if (typeRoll < 0.80 && operationUpgrades.bulkNetwork > 0) {
      options.push(buildBulkUpgrade(applyRarityValue(rollRange(0.10, 0.25 + operationUpgrades.bulkNetwork * 0.05, random), rarity), rarity));
    } else if (sideHustleProducts.length > 0) {
      const sideProductId = sideHustleProducts[Math.floor(random() * sideHustleProducts.length)] ?? sideHustleProducts[0];
      options.push(buildSideHustleUpgrade(applyRarityValue(rollRange(0.05, 0.10, random), rarity), rarity, sideProductId));
    } else {
      const value = applyRarityValue(rollRange(0.03, 0.08, random), rarity);
      options.push({
        type: 'ALL_AROUNDER',
        rarity,
        tone: 'POSITIVE',
        label: 'All-Arounder',
        description: `Volume ${percent(value)}, margin ${percent(value)}`,
        value,
        effects: [
          { stat: 'volumeBonus', value, label: `${percent(value)} volume` },
          { stat: 'marginBonus', value, label: `${percent(value)} margin` },
        ],
      });
    }
  }

  return options;
};

export const applyDealerUpgrade = (dealer: Dealer, upgrade: DealerUpgrade): Dealer => {
  const nextDealer = {
    ...dealer,
    equipmentCount: dealer.equipmentCount + 1,
    hasPendingUpgrade: false,
    pendingUpgradeOptions: [],
  };

  upgrade.effects.forEach(effect => {
    if (effect.stat === 'volumeBonus') {
      nextDealer.volumeBonus += effect.value;
    }
    if (effect.stat === 'marginBonus') {
      nextDealer.marginBonus += effect.value;
    }
    if (effect.stat === 'sideVolume') {
      nextDealer.sideVolume += effect.value;
    }
    if (effect.stat === 'riskBonus') {
      nextDealer.riskBonus = clamp(nextDealer.riskBonus + effect.value, -0.9, 0.9);
    }
    if (effect.stat === 'bulkStreetValue') {
      nextDealer.bulkStreetValue = Math.max(nextDealer.bulkStreetValue, effect.value);
    }
  });

  return nextDealer;
};

export const upgradeMatches = (a: DealerUpgrade, b: DealerUpgrade) =>
  a.type === b.type &&
  a.label === b.label &&
  a.description === b.description &&
  a.value === b.value &&
  a.rarity === b.rarity &&
  a.tone === b.tone;
