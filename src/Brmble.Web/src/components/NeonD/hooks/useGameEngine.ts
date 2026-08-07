import { useCallback, useEffect } from 'react';
import { useInterval } from './useInterval';
import { usePersistedGameState } from './usePersistedGameState';
import type { Dealer, EquipmentId, GameState, MuscleWorkerId, ProductId } from '../types';
import {
  BULK_UNLOCK_COST,
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
  getEquipmentCost,
  getBailCost,
  getMuscleWorkerCost,
  getProducerCost,
  getTerritoryCost,
  isBulkSellingVisible,
} from '../economy';
import {
  applyRecruitmentClock,
  generateCandidatePool,
  generateNormalDealer,
} from '../dealers';
import { advanceDeterministicState, sellBulkOverflow } from '../simulation';
import { applyDueRiskCheck } from '../simulation';

const createInitialGameState = (): GameState => {
  const now = Date.now();
  return {
    ...createBaseGameState(now),
    availableDealers: generateCandidatePool(['weed']),
  };
};

export const useGameEngine = () => {
  const [state, setState, clearStorage] = usePersistedGameState<GameState>(
    NEON_D_SAVE_KEY,
    createInitialGameState,
  );

  const tick = () => {
    setState((prev) => {
      const now = Date.now();
      const elapsedSeconds = Math.max(0, (now - prev.lastTickAt) / 1000);
      const advanced = applyRecruitmentClock(
        advanceDeterministicState(prev, elapsedSeconds, now),
        now,
      );
      return applyDueRiskCheck(advanced, now);
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

  const hireDealer = (dealerId: string, slotIndex: number) => {
    setState((prev) => {
      if (slotIndex < 0 || slotIndex >= prev.activeDealers.length) return prev;
      if (prev.activeDealers[slotIndex] !== null) return prev;

      const candidate = prev.availableDealers.find((dealer) => dealer.id === dealerId);
      if (!candidate) return prev;

      const activeDealers = [...prev.activeDealers];
      activeDealers[slotIndex] = candidate;
      const remaining = prev.availableDealers.filter((dealer) => dealer.id !== dealerId);

      return {
        ...prev,
        activeDealers,
        availableDealers: [
          ...remaining,
          generateNormalDealer(prev.unlockedProducts),
        ].slice(0, 3),
      };
    });
  };

  const fireDealer = (dealerId: string) => {
    setState((prev) => ({
      ...prev,
      activeDealers: prev.activeDealers.map((dealer) =>
        dealer?.id === dealerId ? null : dealer,
      ),
    }));
  };

  const setSellerProduct = (
    sellerId: string,
    productId: ProductId,
    sellerKind: 'dealer' | 'captain',
  ) => {
    setState((prev) => {
      if (!prev.unlockedProducts.includes(productId)) return prev;

      if (sellerKind === 'dealer') {
        return {
          ...prev,
          activeDealers: prev.activeDealers.map((dealer) =>
            dealer?.id === sellerId ? { ...dealer, selling: productId } : dealer,
          ),
        };
      }

      return {
        ...prev,
        captains: prev.captains.map((captain) =>
          captain.id === sellerId ? { ...captain, selling: productId } : captain,
        ),
      };
    });
  };

  const buySellerEquipment = (
    sellerId: string,
    equipmentId: EquipmentId,
    sellerKind: 'dealer' | 'captain',
  ) => {
    setState((prev) => {
      const seller = sellerKind === 'dealer'
        ? prev.activeDealers.find((dealer): dealer is Dealer => dealer?.id === sellerId) ?? null
        : prev.captains.find((captain) => captain.id === sellerId) ?? null;

      if (!seller || seller.equipmentIds.includes(equipmentId)) return prev;

      const cost = getEquipmentCost(equipmentId, sellerKind, prev.discountLevel);
      if (prev.cash < cost) return prev;

      if (sellerKind === 'dealer') {
        return {
          ...prev,
          cash: prev.cash - cost,
          activeDealers: prev.activeDealers.map((dealer) =>
            dealer?.id === sellerId
              ? { ...dealer, equipmentIds: [...dealer.equipmentIds, equipmentId] }
              : dealer,
          ),
        };
      }

      return {
        ...prev,
        cash: prev.cash - cost,
        captains: prev.captains.map((captain) =>
          captain.id === sellerId
            ? { ...captain, equipmentIds: [...captain.equipmentIds, equipmentId] }
            : captain,
        ),
      };
    });
  };

  const toggleDealerProtection = (dealerId: string) => {
    setState((prev) => ({
      ...prev,
      activeDealers: prev.activeDealers.map((dealer) =>
        dealer?.id === dealerId
          ? { ...dealer, isProtected: !dealer.isProtected }
          : dealer,
      ),
    }));
  };

  const payDealerBail = (dealerId: string) => {
    setState((prev) => {
      const dealer = prev.activeDealers.find((candidate): candidate is Dealer =>
        candidate?.id === dealerId,
      );
      if (!dealer || !dealer.isArrested) return prev;

      const cost = getBailCost(dealer.earningsPerSecondAtArrest);
      if (prev.cash < cost) return prev;

      return {
        ...prev,
        cash: prev.cash - cost,
        activeDealers: prev.activeDealers.map((candidate) =>
          candidate?.id === dealerId
            ? {
              ...candidate,
              isArrested: false,
              isProtected: false,
              earningsPerSecondAtArrest: 0,
            }
            : candidate,
        ),
      };
    });
  };

  const unlockBulkSelling = () => {
    setState((prev) => {
      if (prev.bulkUnlocked) return prev;
      if (!isBulkSellingVisible(prev)) return prev;
      if (prev.cash < BULK_UNLOCK_COST) return prev;

      return {
        ...prev,
        cash: prev.cash - BULK_UNLOCK_COST,
        bulkUnlocked: true,
      };
    });
  };

  const bulkSellProduct = (productId: ProductId) => {
    setState((prev) => sellBulkOverflow(prev, productId));
  };

  const setAutoBulkEnabled = (enabled: boolean) => {
    setState((prev) => prev.bulkUnlocked ? { ...prev, autoBulkEnabled: enabled } : prev);
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
    hireDealer,
    fireDealer,
    setSellerProduct,
    buySellerEquipment,
    toggleDealerProtection,
    payDealerBail,
    unlockBulkSelling,
    bulkSellProduct,
    setAutoBulkEnabled,
    resetGame,
    importGame,
    getProductProductionRate: (productId: ProductId) => getProductProductionRate(state, productId),
  };
};
