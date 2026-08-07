import { getProductProductionRate, getRespectPerSecond } from './economy';
import type { GameState } from './types';

export const advanceDeterministicState = (
  state: GameState,
  seconds: number,
  now: number,
): GameState => {
  if (seconds <= 0) return { ...state, lastTickAt: now };

  const production = { ...state.production };

  state.unlockedProducts.forEach((productId) => {
    production[productId] = {
      ...production[productId],
      stock: production[productId].stock + getProductProductionRate(state, productId) * seconds,
    };
  });

  return {
    ...state,
    production,
    respect: state.respect + getRespectPerSecond(state) * seconds,
    lastTickAt: now,
  };
};
