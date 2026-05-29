import { BAIL_BASE_FLOOR, BAIL_INCOME_MULTIPLIER, PRODUCT_ARREST_RISK, PRODUCT_TIERS } from './constants';
import {
  getProductDistributionMultiplier,
  getProductPriceMultiplier,
  getProductProductionMultiplier,
  getProductRiskMultiplier,
} from './productUpgrades';
import type { GameState } from './types';

export const getCurrentTotalIncomePerSecond = (earnings: Record<string, number>) =>
  Object.values(earnings).reduce((sum, value) => sum + value, 0);

export const getBailCost = (earnings: Record<string, number>) =>
  Math.max(BAIL_BASE_FLOOR, getCurrentTotalIncomePerSecond(earnings) * BAIL_INCOME_MULTIPLIER);

export const getProductSellPrice = (state: GameState, productId: string) =>
  (PRODUCT_TIERS[productId] || 1) * getProductPriceMultiplier(state.productUpgrades, productId);

export const getProductProductionYield = (state: GameState, productId: string) => {
  const item = state.production[productId];
  if (!item) return 0;
  return item.yieldPerLevel * getProductProductionMultiplier(state.productUpgrades, productId);
};

export const getEffectiveDealerVolume = (state: GameState, productId: string, baseVolume: number, volumeBonus: number) =>
  baseVolume * (1 + volumeBonus) * getProductDistributionMultiplier(state.productUpgrades, productId);

export const getEffectiveProductRiskChance = (state: GameState, productId: string, dealerRiskBonus = 0) => {
  const baseRisk = PRODUCT_ARREST_RISK[productId]?.chance ?? 0.10;
  const productRisk = baseRisk * getProductRiskMultiplier(state.productUpgrades, productId);
  return Math.min(0.95, Math.max(0, productRisk * (1 + dealerRiskBonus)));
};
