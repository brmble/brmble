import {
  BAIL_EARNINGS_SECONDS,
  AUTO_BULK_RETAIN_STOCK,
  BULK_VISIBLE_EARNINGS,
  CAPTAIN_COST_INCREMENT,
  CAPTAIN_COSTS,
  CAPTAIN_EQUIPMENT_PRICE_MULTIPLIER,
  CAPTAIN_LEVEL_THRESHOLDS,
  CAPTAIN_VISIBLE_EARNINGS,
  DISCOUNT_BASE_COST,
  DISCOUNT_GROWTH,
  DISCOUNT_PRICE_MULTIPLIER,
  EQUIPMENT_CATALOG,
  MUSCLE_CATALOG,
  PRODUCT_CATALOG,
  RECRUITMENT_BASE_REFRESH_MS,
  RECRUITMENT_KINGPIN_REDUCTION_MS,
  RECRUITMENT_MIN_REFRESH_MS,
  RESEARCH_REVEAL_RATIO,
  TERRITORY_BASE_COST,
  TERRITORY_GROWTH,
  ZONE_UNLOCK_BASE_COST,
  ZONE_UNLOCK_GROWTH,
} from './constants';
import type { Captain, EquipmentId, GameState, MuscleWorkerId, ProductDefinition, ProductId } from './types';
import { getActiveCaptainEntries, getAssignedCaptainIds } from './zones';
import { hasZoneBulkSaleTalent } from './talents';

export const getProductDefinition = (productId: ProductId): ProductDefinition => {
  const definition = PRODUCT_CATALOG.find((product) => product.id === productId);
  if (!definition) throw new Error(`Unknown Neon-D product: ${productId}`);
  return definition;
};

const getEquipmentDefinition = (equipmentId: EquipmentId) => {
  const definition = EQUIPMENT_CATALOG.find((item) => item.id === equipmentId);
  if (!definition) throw new Error(`Unknown Neon-D equipment: ${equipmentId}`);
  return definition;
};

const getMuscleDefinition = (workerId: MuscleWorkerId) => {
  const definition = MUSCLE_CATALOG.find((worker) => worker.id === workerId);
  if (!definition) throw new Error(`Unknown Neon-D Muscle worker: ${workerId}`);
  return definition;
};

export const getDiscountMultiplier = (discountLevel: number) => Math.pow(DISCOUNT_PRICE_MULTIPLIER, discountLevel);

export const getProducerCost = (productId: ProductId, owned: number, discountLevel: number) => {
  const product = getProductDefinition(productId);
  return product.producer.baseCost * Math.pow(product.producer.growth, owned) * getDiscountMultiplier(discountLevel);
};

export const getProductUpgradeCost = (productId: ProductId, upgradeId: string, discountLevel: number) => {
  const upgrade = getProductDefinition(productId).upgrades.find((item) => item.id === upgradeId);
  if (!upgrade) throw new Error(`Unknown ${productId} upgrade: ${upgradeId}`);
  return upgrade.baseCost * getDiscountMultiplier(discountLevel);
};

export const getProductProductionRate = (state: GameState, productId: ProductId) => {
  const definition = getProductDefinition(productId);
  const productState = state.production[productId];
  const upgradeMultiplier = definition.upgrades
    .filter((upgrade) => productState.purchasedUpgradeIds.includes(upgrade.id))
    .reduce((multiplier, upgrade) => multiplier * (1 + upgrade.productionBonus), 1);
  return productState.producersOwned * definition.producer.baseRate * upgradeMultiplier * (1 + state.kingpins);
};

export const isProductFullyUpgraded = (
  state: Pick<GameState, 'production'>,
  productId: ProductId,
) => {
  const product = getProductDefinition(productId);
  const purchased = state.production[productId].purchasedUpgradeIds;
  return product.upgrades.every((upgrade) => purchased.includes(upgrade.id));
};

export const getVisibleProductIds = (state: GameState): ProductId[] => {
  const next = PRODUCT_CATALOG[state.unlockedProducts.length];
  if (!next) return [...state.unlockedProducts];
  return state.runEarnings >= next.researchCost * RESEARCH_REVEAL_RATIO
    ? [...state.unlockedProducts, next.id]
    : [...state.unlockedProducts];
};

export const getTerritoryCost = (level: number) => TERRITORY_BASE_COST * Math.pow(TERRITORY_GROWTH, level);
export const getDealerCapacityCost = (purchases: number) => getTerritoryCost(purchases);
export const getZoneUnlockCost = (state: Pick<GameState, 'zones'>) => {
  const additionalZonesAlreadyOpen = Math.max(0, state.zones.length - 1);
  return ZONE_UNLOCK_BASE_COST * Math.pow(ZONE_UNLOCK_GROWTH, additionalZonesAlreadyOpen);
};
export const getCaptainZoneBulkRemainingMs = (
  captain: Pick<Captain, 'zoneBulkSellAvailableAt'>,
  now: number,
) => Math.max(0, captain.zoneBulkSellAvailableAt - now);

export const canCaptainZoneBulkSell = (
  state: GameState,
  captainId: string,
  now: number,
) => {
  if (!getAssignedCaptainIds(state).has(captainId)) return false;
  const captain = state.captains.find((candidate) => candidate.id === captainId);
  if (!captain || !hasZoneBulkSaleTalent(captain)) return false;
  if (getCaptainZoneBulkRemainingMs(captain, now) > 0) return false;
  return state.production[captain.selling].stock > AUTO_BULK_RETAIN_STOCK;
};
export const getDiscountCost = (level: number) => DISCOUNT_BASE_COST * Math.pow(DISCOUNT_GROWTH, level);

export const getMuscleWorkerCost = (workerId: MuscleWorkerId, owned: number, discountLevel: number) => {
  const worker = getMuscleDefinition(workerId);
  return worker.baseCost * Math.pow(worker.growth, owned) * getDiscountMultiplier(discountLevel);
};

export const getCaptainEligibleLevel = (personalEarnings: number) =>
  CAPTAIN_LEVEL_THRESHOLDS.filter((threshold) => personalEarnings >= threshold).length;

const getCaptainCumulativeThreshold = (level: number) =>
  level === 0 ? 0 : CAPTAIN_LEVEL_THRESHOLDS[level - 1];

export const getCaptainLevelRequirement = (level: number) => {
  const nextThreshold = CAPTAIN_LEVEL_THRESHOLDS[level];
  const currentThreshold = getCaptainCumulativeThreshold(level);
  return nextThreshold === undefined || currentThreshold === undefined
    ? null
    : nextThreshold - currentThreshold;
};

export const getCaptainLevelProgress = (
  level: number,
  personalEarnings: number,
  lastLevelUpEarnings: number,
) => {
  const requirement = getCaptainLevelRequirement(level);
  if (requirement === null) return null;
  return Math.min(requirement, Math.max(0, personalEarnings - lastLevelUpEarnings));
};

export const isCaptainLevelUpAvailable = (
  level: number,
  personalEarnings: number,
  lastLevelUpEarnings: number,
) => {
  const requirement = getCaptainLevelRequirement(level);
  const progress = getCaptainLevelProgress(level, personalEarnings, lastLevelUpEarnings);
  return requirement !== null && progress !== null && progress >= requirement;
};

export const getCaptainRemainingThreshold = (
  level: number,
  personalEarnings: number,
  lastLevelUpEarnings: number,
) => {
  const requirement = getCaptainLevelRequirement(level);
  const progress = getCaptainLevelProgress(level, personalEarnings, lastLevelUpEarnings);
  return requirement === null || progress === null ? null : requirement - progress;
};

/** @deprecated Use getCaptainEligibleLevel for earnings-based eligibility. */
export const getCaptainLevel = getCaptainEligibleLevel;

export const getRespectMultiplier = (state: GameState) => {
  const assigned = state.zones.length === 0
    ? new Set(getActiveCaptainEntries(state).map(({ captain }) => captain.id))
    : getAssignedCaptainIds(state);
  const captainBonus = state.captains
    .filter((captain) => assigned.has(captain.id))
    .reduce(
    (sum, captain) => sum + 1 + captain.level * 0.5,
    0,
  );
  return 1 + captainBonus + state.kingpins;
};

export const getRespectPerSecond = (state: GameState) => {
  const baseRate = MUSCLE_CATALOG.reduce(
    (sum, worker) => sum + state.muscleOwned[worker.id] * worker.respectPerSecond,
    0,
  );
  return baseRate * getRespectMultiplier(state);
};

export const getEquipmentCost = (equipmentId: EquipmentId, sellerKind: 'dealer' | 'captain', discountLevel: number) => {
  const sellerMultiplier = sellerKind === 'captain' ? CAPTAIN_EQUIPMENT_PRICE_MULTIPLIER : 1;
  return getEquipmentDefinition(equipmentId).baseCost * sellerMultiplier * getDiscountMultiplier(discountLevel);
};

export const getCaptainCost = (state: Pick<GameState, 'captains'>) => {
  const captainCount = state.captains.length;
  const baseCost = captainCount < CAPTAIN_COSTS.length
    ? CAPTAIN_COSTS[captainCount]
    : CAPTAIN_COSTS[CAPTAIN_COSTS.length - 1]
      + (captainCount - CAPTAIN_COSTS.length + 1) * CAPTAIN_COST_INCREMENT;
  return baseCost;
};

export const getRecruitmentRefreshMs = (kingpins: number) => Math.max(
  RECRUITMENT_MIN_REFRESH_MS,
  RECRUITMENT_BASE_REFRESH_MS - kingpins * RECRUITMENT_KINGPIN_REDUCTION_MS,
);

export const getRecruitmentRefreshRemainingMs = (
  state: Pick<GameState, 'kingpins' | 'lastDealerRefreshAt'>,
  now: number,
) => Math.max(0, state.lastDealerRefreshAt + getRecruitmentRefreshMs(state.kingpins) - now);

export const getBailCost = (earningsPerSecondAtArrest: number) => earningsPerSecondAtArrest * BAIL_EARNINGS_SECONDS;

export const getEffectiveStreetValue = (state: Pick<GameState, 'activeMarketEvent'>, productId: ProductId) => {
  const base = getProductDefinition(productId).streetValue;
  return state.activeMarketEvent?.productId === productId ? base * state.activeMarketEvent.multiplier : base;
};

export const isRiskActive = (state: Pick<GameState, 'runEarnings'>) => state.runEarnings >= 30_000;
export const isBulkSellingVisible = (state: Pick<GameState, 'runEarnings'>) => state.runEarnings >= BULK_VISIBLE_EARNINGS;
export const isCaptainVisible = (state: Pick<GameState, 'runEarnings' | 'captains'>) =>
  state.runEarnings >= CAPTAIN_VISIBLE_EARNINGS || state.captains.length > 0;
