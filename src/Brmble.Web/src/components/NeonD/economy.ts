import { BAIL_BASE_FLOOR, BAIL_INCOME_MULTIPLIER } from './constants';

export const getCurrentTotalIncomePerSecond = (earnings: Record<string, number>) =>
  Object.values(earnings).reduce((sum, value) => sum + value, 0);

export const getBailCost = (earnings: Record<string, number>) =>
  Math.max(BAIL_BASE_FLOOR, getCurrentTotalIncomePerSecond(earnings) * BAIL_INCOME_MULTIPLIER);
