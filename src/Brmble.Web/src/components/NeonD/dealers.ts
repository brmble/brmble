import {
  CAPTAIN_BASE_MARGIN_MULTIPLIER,
  CAPTAIN_BASE_VOLUME_MULTIPLIER,
  EQUIPMENT_CATALOG,
  MAIN_SALE_UNITS_PER_VOLUME,
  NORMAL_DEALER_MAX_MULTIPLIER,
  NORMAL_DEALER_MIN_MULTIPLIER,
} from './constants';
import type { Captain, Dealer, EquipmentDefinition, EquipmentId, GameState, ProductId, SellerBonuses } from './types';
import { getTalentBonus } from './talents';

const DEALER_FIRST_NAMES = [
  'Thomas', 'Dutch', 'Belgian', 'Chemist', 'Slick', 'Vito', 'Snake',
  'Mick', 'Jack', 'Dave', 'Miller', 'Bob', 'Ghost',
] as const;

const DEALER_LAST_NAMES = [
  'Palmer', 'Dave', 'Bob', 'Carlos', 'Snake', 'Miller',
  'The Fixer', 'The Ghost', 'Slick',
] as const;

const pick = <T,>(items: readonly T[], rng: () => number): T =>
  items[Math.min(items.length - 1, Math.floor(rng() * items.length))];

const generateDealerName = (rng: () => number) => {
  const first = pick(DEALER_FIRST_NAMES, rng);
  let last = pick(DEALER_LAST_NAMES, rng);
  if (first === last) last = 'The Fixer';
  return `${first} "${last}"`;
};

const rollMultiplier = (rng: () => number) =>
  NORMAL_DEALER_MIN_MULTIPLIER +
  rng() * (NORMAL_DEALER_MAX_MULTIPLIER - NORMAL_DEALER_MIN_MULTIPLIER);

export const getSellerEquipmentBonuses = (equipmentIds: EquipmentId[]): SellerBonuses =>
  equipmentIds.reduce(
    (totals, equipmentId) => {
      const item = EQUIPMENT_CATALOG.find((entry) => entry.id === equipmentId);
      if (!item) return totals;
      const effect = item.effect as EquipmentDefinition['effect'];
      return {
        volumeBonus: totals.volumeBonus + (effect.volumeBonus ?? 0),
        marginBonus: totals.marginBonus + (effect.marginBonus ?? 0),
        secondarySalesBonus:
          totals.secondarySalesBonus + (effect.secondarySalesBonus ?? 0),
      };
    },
    { volumeBonus: 0, marginBonus: 0, secondarySalesBonus: 0 } satisfies SellerBonuses,
  );

export const getCaptainBonuses = (captain: Captain): SellerBonuses =>
  getTalentBonus(captain.talentRanks);

export const getCaptainMainSaleRate = (captain: Captain) =>
  CAPTAIN_BASE_VOLUME_MULTIPLIER * (1 + getCaptainBonuses(captain).volumeBonus) * MAIN_SALE_UNITS_PER_VOLUME;

export const getCaptainMarginMultiplier = (captain: Captain) =>
  CAPTAIN_BASE_MARGIN_MULTIPLIER * (1 + getCaptainBonuses(captain).marginBonus);

export const getNormalDealerMainSaleRate = (
  dealer: Dealer,
  leadership: SellerBonuses = { marginBonus: 0, volumeBonus: 0, secondarySalesBonus: 0 },
) => {
  const bonuses = getSellerEquipmentBonuses(dealer.equipmentIds);
  return dealer.volumeMultiplier *
    (1 + bonuses.volumeBonus + leadership.volumeBonus) *
    MAIN_SALE_UNITS_PER_VOLUME;
};

export const getDealerMarginMultiplier = (
  dealer: Dealer,
  leadership: SellerBonuses = { marginBonus: 0, volumeBonus: 0, secondarySalesBonus: 0 },
) => {
  const bonuses = getSellerEquipmentBonuses(dealer.equipmentIds);
  return dealer.marginMultiplier *
    (1 + bonuses.marginBonus + leadership.marginBonus);
};

export const buildSecondaryDemands = (
  mainRate: number,
  secondarySalesBonus: number,
  primary: ProductId,
  unlockedProducts: ProductId[],
) => {
  const secondaryProducts = unlockedProducts.filter((id) => id !== primary);
  const result = new Map<ProductId, number>();
  if (secondaryProducts.length === 0 || secondarySalesBonus <= 0) return result;

  const ratePerProduct = mainRate * secondarySalesBonus / secondaryProducts.length;
  secondaryProducts.forEach((id) => result.set(id, ratePerProduct));
  return result;
};

export const generateNormalDealer = (
  unlockedProducts: ProductId[],
  rng: () => number = Math.random,
): Dealer => ({
  id: crypto.randomUUID(),
  name: generateDealerName(rng),
  selling: pick(unlockedProducts.length > 0 ? unlockedProducts : ['weed'], rng),
  volumeMultiplier: rollMultiplier(rng),
  marginMultiplier: rollMultiplier(rng),
  equipmentIds: [],
  isProtected: false,
  isArrested: false,
  earningsPerSecondAtArrest: 0,
});

export const getCaptainDefaultName = (index: number) => `Captain ${index}`;

export const createCaptain = (
  index: number,
  name: string = getCaptainDefaultName(index),
): Captain => ({
  id: crypto.randomUUID(),
  name,
  selling: 'weed',
  equipmentIds: [],
  personalEarnings: 0,
  lastLevelUpEarnings: 0,
  level: 0,
  talentPoints: 0,
  talentRanks: { red: [0, 0, 0], yellow: [0, 0, 0], blue: [0, 0, 0] },
  ledgerUnlocked: false,
  kingpinAvailable: false,
  zoneBulkSellAvailableAt: 0,
});

export const generateCandidatePool = (
  unlockedProducts: ProductId[],
  rng: () => number = Math.random,
) => Array.from({ length: 3 }, () => generateNormalDealer(unlockedProducts, rng));

export const applyRecruitmentClock = (
  state: GameState,
  _now: number,
): GameState => state;
