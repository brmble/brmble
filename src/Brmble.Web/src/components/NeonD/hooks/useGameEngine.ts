import { useCallback, useEffect, useRef } from 'react';
import { useInterval } from './useInterval';
import { usePersistedGameState } from './usePersistedGameState';
import type {
  ActiveSeller,
  Captain,
  DealerSlotTarget,
  EquipmentId,
  GameState,
  MuscleWorkerId,
  ProductId,
  TalentPathId,
  ZoneCityId,
} from '../types';
import {
  BULK_UNLOCK_COST,
  createBaseGameState,
  NEON_D_SAVE_KEY,
  OFFLINE_CAP_MS,
  PRODUCT_CATALOG,
  RESEARCH_REVEAL_RATIO,
  ZONE_CITY_CATALOG,
} from '../constants';
import {
  getProductDefinition,
  getProductProductionRate,
  getProductUpgradeCost,
  getDiscountCost,
  getEquipmentCost,
  getBailCost,
  getCaptainCost,
  getDealerCapacityCost,
  getMuscleWorkerCost,
  getProducerCost,
  getTerritoryCost,
  getZoneUnlockCost,
  getRecruitmentRefreshMs,
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
  sellCaptainZoneBulkOverflow,
  sellBulkOverflow,
} from '../simulation';
import { migrateNeonDState } from '../saveFormat';
import { applyDueRiskCheck } from '../simulation';
import { canPurchaseTalent } from '../talents';
import { resolveDueDealerTransfers, startDealerTransfer } from '../transfers';
import { getAssignedCaptainIds as getAssignedCaptainSlotIds } from '../sellers';
import {
  createAmsterdamZone,
  findActiveDealer,
  getAssignedCaptainIds,
  removeActiveDealer,
  updateActiveDealer,
} from '../zones';
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
): GameState => {
  const base = createBaseGameState(now);
  const resetCaptains = captains.map((captain) => ({
    ...captain,
    selling: 'weed' as const,
  }));

  if (resetCaptains.length === 0) {
    return {
      ...base,
      captains: [],
      kingpins,
      availableDealers: generateCandidatePool(['weed']),
    };
  }

  const needsCaptainChoice = resetCaptains.length > 1;

  return {
    ...base,
    captains: resetCaptains,
    kingpins,
    activeDealers: [],
    zones: [
      createAmsterdamZone(
        needsCaptainChoice ? null : resetCaptains[0].id,
        1,
      ),
    ],
    dealerTransfers: [],
    pendingAmsterdamCaptainSelection: needsCaptainChoice,
    availableDealers: generateCandidatePool(['weed']),
  };
};

const replenishDealerPool = (state: GameState, dealerId: string): GameState => {
  const remaining = state.availableDealers.filter((dealer) => dealer.id !== dealerId);
  return {
    ...state,
    availableDealers: [
      ...remaining,
      generateNormalDealer(state.unlockedProducts),
    ].slice(0, 3),
  };
};

const advanceThroughTick = (state: GameState, elapsedMs: number, now: number): GameState => {
  let remainingMs = Math.min(Math.max(0, elapsedMs), OFFLINE_CAP_MS);
  let cursor = now - remainingMs;
  let advanced = state;

  do {
    const stepMs = Math.min(1_000, remainingMs);
    cursor += stepMs;
    advanced = advanceDeterministicState(advanced, stepMs / 1_000, cursor);
    advanced = resolveDueDealerTransfers(advanced, cursor);
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
      if (prev.zones.length > 0) return prev;
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

  const unlockZone = (cityId: ZoneCityId, captainId: string) => {
    setState((prev) => {
      if (prev.zones.length === 0 || prev.pendingAmsterdamCaptainSelection) return prev;
      if (prev.zones.some((zone) => zone.id === cityId)) return prev;

      const city = ZONE_CITY_CATALOG.find((candidate) => candidate.id === cityId);
      if (!city) return prev;

      const assigned = getAssignedCaptainIds(prev);
      if (assigned.has(captainId)) return prev;
      if (!prev.captains.some((captain) => captain.id === captainId)) return prev;

      const cost = getZoneUnlockCost(prev);
      if (prev.respect < cost) return prev;

      return {
        ...prev,
        respect: prev.respect - cost,
        zones: [
          ...prev.zones,
          {
            id: city.id,
            displayName: city.name,
            captainId,
            dealerSlots: [],
            perkIds: [],
          },
        ],
      };
    });
  };

  const buyDealerCapacity = (zoneId: ZoneCityId) => {
    setState((prev) => {
      if (prev.zones.length === 0) return prev;
      const cost = getDealerCapacityCost(prev.territoryLevel);
      if (prev.respect < cost) return prev;

      const zone = prev.zones.find((candidate) => candidate.id === zoneId);
      if (!zone) return prev;

      const nextSlotIndex = zone.dealerSlots.length;
      return {
        ...prev,
        respect: prev.respect - cost,
        territoryLevel: prev.territoryLevel + 1,
        zones: prev.zones.map((candidate) =>
          candidate.id === zoneId
            ? {
              ...candidate,
              dealerSlots: [
                ...candidate.dealerSlots,
                {
                  id: `${zoneId}-slot-${nextSlotIndex}`,
                  dealer: null,
                  reservedTransferId: null,
                },
              ],
            }
            : candidate,
        ),
      };
    });
  };

  const hireDealer = (dealerId: string, target: DealerSlotTarget | number) => {
    const resolvedTarget: DealerSlotTarget = typeof target === 'number'
      ? { kind: 'legacy', slotIndex: target }
      : target;

    setState((prev) => {
      const dealer = prev.availableDealers.find((candidate) => candidate.id === dealerId);
      if (!dealer) return prev;

      if (resolvedTarget.kind === 'legacy') {
        if (prev.zones.length > 0) return prev;
        if (resolvedTarget.slotIndex < 0 || resolvedTarget.slotIndex >= prev.activeDealers.length) return prev;
        if (prev.activeDealers[resolvedTarget.slotIndex] !== null) return prev;

        const activeDealers = [...prev.activeDealers];
        activeDealers[resolvedTarget.slotIndex] = dealer;
        return replenishDealerPool({ ...prev, activeDealers }, dealerId);
      }

      if (prev.zones.length === 0) return prev;
      const targetZone = prev.zones.find((zone) => zone.id === resolvedTarget.zoneId);
      const targetSlot = targetZone?.dealerSlots.find((slot) => slot.id === resolvedTarget.slotId);
      if (!targetSlot || targetSlot.dealer || targetSlot.reservedTransferId) return prev;

      const zones = prev.zones.map((zone) =>
        zone.id !== resolvedTarget.zoneId
          ? zone
          : {
            ...zone,
            dealerSlots: zone.dealerSlots.map((slot) =>
              slot.id === resolvedTarget.slotId ? { ...slot, dealer } : slot,
            ),
          },
      );

      return replenishDealerPool({ ...prev, zones }, dealerId);
    });
  };

  const hireSeller = (sellerId: string, slotIndex: number, sellerKind: 'dealer' | 'captain') => {
    if (sellerKind === 'dealer') {
      hireDealer(sellerId, { kind: 'legacy', slotIndex });
      return;
    }

    setState((prev) => {
      if (slotIndex < 0 || slotIndex >= prev.activeDealers.length) return prev;
      if (prev.activeDealers[slotIndex] !== null) return prev;

      const assignedCaptainIds = getAssignedCaptainSlotIds(prev.activeDealers);
      if (assignedCaptainIds.has(sellerId)) return prev;
      const seller: ActiveSeller | null = prev.captains.find((captain) => captain.id === sellerId) ?? null;
      if (!seller) return prev;

      const activeDealers = [...prev.activeDealers];
      activeDealers[slotIndex] = seller;
      return { ...prev, activeDealers };
    });
  };

  const refreshDealers = () => {
    setState((prev) => {
      const now = Date.now();
      if (now - prev.lastDealerRefreshAt < getRecruitmentRefreshMs(prev.kingpins)) return prev;
      return {
        ...prev,
        lastDealerRefreshAt: now,
        availableDealers: generateCandidatePool(prev.unlockedProducts),
      };
    });
  };

  const renameCaptain = (captainId: string, name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setState((prev) => {
      return {
        ...prev,
        captains: prev.captains.map((captain) =>
          captain.id === captainId ? { ...captain, name: trimmedName } : captain,
        ),
      };
    });
  };

  const fireDealer = (dealerId: string) => {
    setState((prev) => ({ ...prev, ...removeActiveDealer(prev, dealerId) }));
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
          ...updateActiveDealer(prev, sellerId, (dealer) => ({ ...dealer, selling: productId })),
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
        ? findActiveDealer(prev, sellerId)
        : prev.captains.find((captain) => captain.id === sellerId) ?? null;

      if (!seller || seller.equipmentIds.includes(equipmentId)) return prev;

      const cost = getEquipmentCost(equipmentId, sellerKind, prev.discountLevel);
      if (prev.cash < cost) return prev;

      if (sellerKind === 'dealer') {
        return {
          ...prev,
          cash: prev.cash - cost,
          ...updateActiveDealer(prev, sellerId, (dealer) => ({
            ...dealer,
            equipmentIds: [...dealer.equipmentIds, equipmentId],
          })),
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
      ...updateActiveDealer(prev, dealerId, (dealer) => ({
        ...dealer,
        isProtected: !dealer.isProtected,
      })),
    }));
  };

  const payDealerBail = (dealerId: string) => {
    setState((prev) => {
      const dealer = findActiveDealer(prev, dealerId);
      if (!dealer || !dealer.isArrested) return prev;

      const cost = getBailCost(dealer.earningsPerSecondAtArrest);
      if (prev.cash < cost) return prev;

      return {
        ...prev,
        cash: prev.cash - cost,
        ...updateActiveDealer(prev, dealerId, (candidate) => ({
          ...candidate,
          isArrested: false,
          isProtected: false,
          earningsPerSecondAtArrest: 0,
        })),
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

  const captainZoneBulkSell = (captainId: string) => {
    setState((prev) => sellCaptainZoneBulkOverflow(prev, captainId, Date.now()));
  };

  const transferDealer = (
    dealerId: string,
    destinationZoneId: ZoneCityId,
    destinationSlotId: string,
  ) => {
    setState((prev) => startDealerTransfer(
      prev,
      dealerId,
      destinationZoneId,
      destinationSlotId,
      Date.now(),
    ));
  };

  const dismissOfflineEarningsSummary = () => {
    setState((prev) => ({
      ...prev,
      offlineEarningsSummary: null,
    }));
  };

  const buyCaptain = (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setState((prev) => {
      if (!isCaptainVisible(prev)) return prev;

      const cost = getCaptainCost(prev);
      if (prev.cash < cost) return prev;

      const captain = createCaptain(
        prev.captains.length + prev.kingpins + 1,
        trimmedName,
      );
      return resetRunPreservingPrestige(
        [...prev.captains, captain],
        prev.kingpins,
        Date.now(),
      );
    });
  };

  const assignAmsterdamCaptain = (captainId: string) => {
    setState((prev) => {
      if (!prev.pendingAmsterdamCaptainSelection) return prev;
      if (!prev.captains.some((captain) => captain.id === captainId)) return prev;

      return {
        ...prev,
        pendingAmsterdamCaptainSelection: false,
        zones: prev.zones.map((zone) =>
          zone.id === 'amsterdam'
            ? { ...zone, captainId }
            : zone,
        ),
      };
    });
  };

  const claimCaptainLevel = (captainId: string) => {
    setState((prev) => {
      const captains = prev.captains.map((captain) => {
        if (captain.id !== captainId) return captain;
        if (!isCaptainLevelUpAvailable(
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
      });
      return {
        ...prev,
        captains,
      };
    });
  };

  const purchaseCaptainTalent = (captainId: string, path: TalentPathId, row: 0 | 1 | 2) => {
    setState((prev) => {
      const captains = prev.captains.map((captain) => {
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
      });
      return {
        ...prev,
        captains,
      };
    });
  };

  const promoteCaptain = (captainId: string) => {
    setState((prev) => {
      const captain = prev.captains.find((item) => item.id === captainId);
      if (!captain || !captain.kingpinAvailable || captain.talentPoints < 1) return prev;

      return resetRunPreservingPrestige([], prev.kingpins + 1, Date.now());
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
    unlockZone,
    buyDealerCapacity,
    buyDiscount,
    hireSeller,
    hireDealer,
    refreshDealers,
    renameCaptain,
    fireDealer,
    setSellerProduct,
    buySellerEquipment,
    toggleDealerProtection,
    payDealerBail,
    unlockBulkSelling,
    bulkSellProduct,
    captainZoneBulkSell,
    transferDealer,
    dismissOfflineEarningsSummary,
    buyCaptain,
    assignAmsterdamCaptain,
    claimCaptainLevel,
    purchaseCaptainTalent,
    promoteCaptain,
    resetGame,
    importGame,
    getProductProductionRate: (productId: ProductId) => getProductProductionRate(state, productId),
    getProductSalesRates: () => getProductSalesRates(state),
  };
};
