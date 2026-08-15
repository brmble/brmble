import { useCallback, useEffect, useRef } from 'react';
import { useInterval } from './useInterval';
import { usePersistedGameState } from './usePersistedGameState';
import type { Captain, Dealer, EquipmentId, GameState, MuscleWorkerId, ProductId, TalentPathId } from '../types';
import {
  BULK_UNLOCK_COST,
  createBaseGameState,
  NEON_D_SAVE_KEY,
  OFFLINE_CAP_MS,
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
  getCaptainCost,
  getMuscleWorkerCost,
  getProducerCost,
  getTerritoryCost,
  isProductFullyUpgraded,
  isCaptainVisible,
  isCaptainLevelUpAvailable,
} from '../economy';
import {
  applyRecruitmentClock,
  createCaptain,
  generateCandidatePool,
  generateNormalDealer,
} from '../dealers';
import {
  applyOfflineProgress,
  advanceDeterministicState,
  applyMarketClock,
  getProductSalesRates,
  sellBulkOverflow,
} from '../simulation';
import { migrateNeonDState } from '../saveFormat';
import { applyDueRiskCheck } from '../simulation';
import { canPurchaseTalent } from '../talents';
import { NEON_D_CARD_PREFERENCES_KEY } from './usePersistedCardPreferences';

const createInitialGameState = (): GameState => {
  const now = Date.now();
  return {
    ...createBaseGameState(now),
    availableDealers: generateCandidatePool(['weed']),
  };
};

const resetRunPreservingPrestige = (
  captains: Captain[],
  kingpins: number,
  now: number,
): GameState => ({
  ...createBaseGameState(now),
  captains: captains.map((captain) => ({ ...captain, selling: 'weed' })),
  kingpins,
  availableDealers: generateCandidatePool(['weed']),
});

const advanceThroughTick = (state: GameState, elapsedMs: number, now: number): GameState => {
  let remainingMs = Math.min(Math.max(0, elapsedMs), OFFLINE_CAP_MS);
  let cursor = now - remainingMs;
  let advanced = state;

  do {
    const stepMs = Math.min(1_000, remainingMs);
    cursor += stepMs;
    advanced = advanceDeterministicState(advanced, stepMs / 1_000, cursor);
    advanced = applyRecruitmentClock(advanced, cursor);
    advanced = applyMarketClock(advanced, cursor);
    advanced = applyDueRiskCheck(advanced, cursor);
    remainingMs -= stepMs;
  } while (remainingMs > 0);

  return advanced;
};

export const useGameEngine = () => {
  const [state, setState, clearStorage] = usePersistedGameState<GameState>(
    NEON_D_SAVE_KEY,
    createInitialGameState,
    migrateNeonDState,
  );
  const hasInitializedOfflineProgress = useRef(false);

  const tick = () => {
    setState((prev) => {
      const now = Date.now();
      const elapsedMs = Math.max(0, now - prev.lastTickAt);
      return advanceThroughTick(prev, elapsedMs, now);
    });
  };

  useEffect(() => {
    if (hasInitializedOfflineProgress.current) return;
    hasInitializedOfflineProgress.current = true;
    setState((prev) => applyOfflineProgress(prev, Date.now()));
  }, [setState]);

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

  const unlockBulkSelling = (productId: ProductId) => {
    setState((prev) => {
      if (!prev.unlockedProducts.includes(productId)) return prev;
      if (prev.bulkUnlockedProductIds.includes(productId)) return prev;
      if (!isProductFullyUpgraded(prev, productId)) return prev;
      if (prev.cash < BULK_UNLOCK_COST) return prev;

      return {
        ...prev,
        cash: prev.cash - BULK_UNLOCK_COST,
        bulkUnlockedProductIds: [...prev.bulkUnlockedProductIds, productId],
      };
    });
  };

  const bulkSellProduct = (productId: ProductId) => {
    setState((prev) => sellBulkOverflow(prev, productId, Date.now()));
  };

  const dismissOfflineEarningsSummary = () => {
    setState((prev) => ({
      ...prev,
      offlineEarningsSummary: null,
    }));
  };

  const buyCaptain = () => {
    setState((prev) => {
      if (!isCaptainVisible(prev)) return prev;

      const cost = getCaptainCost(prev);
      if (prev.cash < cost) return prev;

      const captain = createCaptain(prev.captains.length + prev.kingpins + 1);
      return resetRunPreservingPrestige(
        [...prev.captains, captain],
        prev.kingpins,
        Date.now(),
      );
    });
  };

  const claimCaptainLevel = (captainId: string) => {
    setState((prev) => ({
      ...prev,
      captains: prev.captains.map((captain) => {
        if (captain.id !== captainId) return captain;
        if (captain.level >= 28 || !isCaptainLevelUpAvailable(
          captain.level,
          captain.personalEarnings,
          captain.lastLevelUpEarnings,
        )) return captain;
        const level = captain.level + 1;
        const laneComplete = Object.values(captain.talentRanks).some((ranks) => ranks[2] === 4);
        return {
          ...captain,
          level,
          lastLevelUpEarnings: captain.personalEarnings,
          talentPoints: captain.talentPoints + 1,
          ledgerUnlocked: true,
          kingpinAvailable: captain.kingpinAvailable || (level >= 10 && laneComplete),
        };
      }),
    }));
  };

  const purchaseCaptainTalent = (captainId: string, path: TalentPathId, row: 0 | 1 | 2) => {
    setState((prev) => ({
      ...prev,
      captains: prev.captains.map((captain) => {
        if (captain.id !== captainId || !canPurchaseTalent(captain, path, row)) return captain;
        const talentRanks = {
          ...captain.talentRanks,
          [path]: captain.talentRanks[path].map((rank, index) =>
            index === row ? rank + 1 : rank,
          ) as [number, number, number],
        };
        return {
          ...captain,
          talentRanks,
          talentPoints: captain.talentPoints - 1,
          kingpinAvailable: captain.kingpinAvailable
            || (captain.level >= 10 && talentRanks[path][2] === 4),
        };
      }),
    }));
  };

  const promoteCaptain = (captainId: string) => {
    setState((prev) => {
      const captain = prev.captains.find((item) => item.id === captainId);
      if (!captain || !captain.kingpinAvailable || captain.talentPoints < 1) return prev;

      return {
        ...prev,
        captains: prev.captains.filter((item) => item.id !== captainId),
        kingpins: prev.kingpins + 1,
      };
    });
  };

  const resetGame = useCallback(() => {
    clearStorage();
    try {
      localStorage.removeItem(NEON_D_CARD_PREFERENCES_KEY);
    } catch {
      // Preferences are best effort and must not affect resetting the game.
    }
    setState(createInitialGameState());
  }, [clearStorage, setState]);

  const importGame = useCallback((importedState: GameState) => {
    setState(applyOfflineProgress(importedState, Date.now()));
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
    dismissOfflineEarningsSummary,
    buyCaptain,
    claimCaptainLevel,
    purchaseCaptainTalent,
    promoteCaptain,
    resetGame,
    importGame,
    getProductProductionRate: (productId: ProductId) => getProductProductionRate(state, productId),
    getProductSalesRates: () => getProductSalesRates(state),
  };
};
