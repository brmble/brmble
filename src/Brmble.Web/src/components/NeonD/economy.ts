import {
  BAIL_EARNINGS_SECONDS,
  BULK_VISIBLE_EARNINGS,
  CAPTAIN_BASE_COST,
  CAPTAIN_COST_GROWTH,
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
} from './constants';
import type { EquipmentId, GameState, MuscleWorkerId, ProductDefinition, ProductId } from './types';

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

export const getVisibleProductIds = (state: GameState): ProductId[] => {
  const next = PRODUCT_CATALOG[state.unlockedProducts.length];
  if (!next) return [...state.unlockedProducts];
  return state.runEarnings >= next.researchCost * RESEARCH_REVEAL_RATIO
    ? [...state.unlockedProducts, next.id]
    : [...state.unlockedProducts];
};

export const getTerritoryCost = (level: number) => TERRITORY_BASE_COST * Math.pow(TERRITORY_GROWTH, level);
export const getDiscountCost = (level: number) => DISCOUNT_BASE_COST * Math.pow(DISCOUNT_GROWTH, level);

export const getMuscleWorkerCost = (workerId: MuscleWorkerId, owned: number, discountLevel: number) => {
  const worker = getMuscleDefinition(workerId);
  return worker.baseCost * Math.pow(worker.growth, owned) * getDiscountMultiplier(discountLevel);
};

export const getCaptainLevel = (personalEarnings: number) =>
  CAPTAIN_LEVEL_THRESHOLDS.filter((threshold) => personalEarnings >= threshold).length;

export const getRespectMultiplier = (state: GameState) => {
  const captainBonus = state.captains.reduce(
    (sum, captain) => sum + 1 + getCaptainLevel(captain.personalEarnings) * 0.5,
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

export const getCaptainCost = (state: Pick<GameState, 'captains' | 'kingpins' | 'discountLevel'>) =>
  CAPTAIN_BASE_COST * Math.pow(CAPTAIN_COST_GROWTH, state.captains.length + state.kingpins) * getDiscountMultiplier(state.discountLevel);

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
export const isCaptainVisible = (state: Pick<GameState, 'runEarnings'>) => state.runEarnings >= CAPTAIN_VISIBLE_EARNINGS;
