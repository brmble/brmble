import { useCallback, useEffect } from 'react';
import { useInterval } from './useInterval';
import { usePersistedGameState } from './usePersistedGameState';
import type { GameState, MuscleWorkerId, ProductId } from '../types';
import {
  createBaseGameState,
  NEON_D_SAVE_KEY,
  PRODUCT_CATALOG,
  RESEARCH_REVEAL_RATIO,
} from '../constants';
import {
  getProductDefinition,
  getProductProductionRate,
  getProductUpgradeCost,
  getDiscountCost,
  getMuscleWorkerCost,
  getProducerCost,
  getTerritoryCost,
} from '../economy';
import { advanceDeterministicState } from '../simulation';

const createInitialGameState = (): GameState => createBaseGameState(Date.now());

export const useGameEngine = () => {
  const [state, setState, clearStorage] = usePersistedGameState<GameState>(
    NEON_D_SAVE_KEY,
    createInitialGameState,
  );

  const tick = () => {
    setState((prev) => {
      const elapsedSeconds = Math.max(0, (Date.now() - prev.lastTickAt) / 1000);
      return advanceDeterministicState(prev, elapsedSeconds, Date.now());
    });
  };

  useEffect(() => {
    tick();
  }, []);

  const buyProducer = (productId: ProductId) => {
    setState((prev) => {
      if (!prev.unlockedProducts.includes(productId)) return prev;
      const owned = prev.production[productId].producersOwned;
      const cost = getProducerCost(productId, owned, prev.discountLevel);
      if (prev.cash < cost) return prev;

      return {
        ...prev,
        cash: prev.cash - cost,
        production: {
          ...prev.production,
          [productId]: {
            ...prev.production[productId],
            producersOwned: owned + 1,
          },
        },
      };
    });
  };

  const researchProduct = (productId: ProductId) => {
    setState((prev) => {
      const nextDefinition = PRODUCT_CATALOG[prev.unlockedProducts.length];
      if (!nextDefinition || nextDefinition.id !== productId) return prev;
      if (prev.runEarnings < nextDefinition.researchCost * RESEARCH_REVEAL_RATIO) return prev;
      if (prev.cash < nextDefinition.researchCost) return prev;

      return {
        ...prev,
        cash: prev.cash - nextDefinition.researchCost,
        unlockedProducts: [...prev.unlockedProducts, productId],
      };
    });
  };

  const buyProductUpgrade = (productId: ProductId, upgradeId: string) => {
    setState((prev) => {
      if (!prev.unlockedProducts.includes(productId)) return prev;
      const product = getProductDefinition(productId);
      const productState = prev.production[productId];
      const nextUpgrade = product.upgrades[productState.purchasedUpgradeIds.length];
      if (!nextUpgrade || nextUpgrade.id !== upgradeId) return prev;

      const cost = getProductUpgradeCost(productId, upgradeId, prev.discountLevel);
      if (prev.cash < cost) return prev;

      return {
        ...prev,
        cash: prev.cash - cost,
        production: {
          ...prev.production,
          [productId]: {
            ...productState,
            purchasedUpgradeIds: [...productState.purchasedUpgradeIds, upgradeId],
          },
        },
      };
    });
  };

  const buyMuscleWorker = (workerId: MuscleWorkerId) => {
    setState((prev) => {
      const owned = prev.muscleOwned[workerId];
      const cost = getMuscleWorkerCost(workerId, owned, prev.discountLevel);
      if (prev.cash < cost) return prev;

      return {
        ...prev,
        cash: prev.cash - cost,
        muscleOwned: {
          ...prev.muscleOwned,
          [workerId]: owned + 1,
        },
      };
    });
  };

  const buyTerritory = () => {
    setState((prev) => {
      const cost = getTerritoryCost(prev.territoryLevel);
      if (prev.respect < cost) return prev;

      return {
        ...prev,
        respect: prev.respect - cost,
        territoryLevel: prev.territoryLevel + 1,
        activeDealers: [...prev.activeDealers, null],
      };
    });
  };

  const buyDiscount = () => {
    setState((prev) => {
      const cost = getDiscountCost(prev.discountLevel);
      if (prev.respect < cost) return prev;

      return {
        ...prev,
        respect: prev.respect - cost,
        discountLevel: prev.discountLevel + 1,
      };
    });
  };

  const resetGame = useCallback(() => {
    clearStorage();
    setState(createInitialGameState());
  }, [clearStorage, setState]);

  const importGame = useCallback((importedState: GameState) => {
    setState(importedState);
  }, [setState]);

  useInterval(tick, 1000);

  return {
    state,
    buyProducer,
    researchProduct,
    buyProductUpgrade,
    buyMuscleWorker,
    buyTerritory,
    buyDiscount,
    resetGame,
    importGame,
    getProductProductionRate: (productId: ProductId) => getProductProductionRate(state, productId),
  };
};
