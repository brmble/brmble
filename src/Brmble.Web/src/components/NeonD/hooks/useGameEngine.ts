import { useCallback, useEffect } from 'react';
import { useInterval } from './useInterval';
import { usePersistedGameState } from './usePersistedGameState';
import type { GameState, Dealer, DealerUpgrade, OperationUpgradeId, ProductUpgradeCategory } from '../types';
import {
  INITIAL_GAME_STATE,
  UNLOCK_COSTS,
  DEALER_FIRST_NAMES,
  DEALER_LAST_NAMES,
  SLOT_UNLOCK_COSTS,
  VOLUME_RANGES,
  MARGIN_RANGES,
  ARREST_CHECK_INTERVAL_MS,
  DEALER_PROTECTION_INCOME_MULTIPLIER,
  OPERATION_UPGRADE_DEFINITIONS,
} from '../constants';
import {
  getBailCost,
  getEffectiveDealerVolume,
  getEffectiveProductRiskChance,
  getProductProductionYield,
  getProductSellPrice,
} from '../economy';
import {
  applyDealerUpgrade,
  canRollDealerUpgrade,
  getDealerEquipmentUpgradeCost,
  getDealerSlotUnlockCost,
  rollDealerUpgradeOptions,
  upgradeMatches,
} from '../dealerUpgrades';
import { getBestBulkStreetValue, canUseBulkMarket, getBulkSaleConfig, sellBulkStock } from '../bulkMarket';
import { createDefaultProductUpgradeState, getProductUpgradeCost, upgradeProductTrack } from '../productUpgrades';

const OFFLINE_EARNINGS_POPUP_THRESHOLD_MS = 10 * 60 * 1000;
const SAVE_KEY = 'brmble_neon_d_save';

// Roll a random value within a given range
function rollWithinRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Roll volume (g/s) for a given star rating
function rollVolumeGps(stars: number): number {
  const range = VOLUME_RANGES[Math.min(5, Math.max(1, stars))];
  if (!range) return 1.0;  // Fallback
  return rollWithinRange(range[0], range[1]);
}

// Roll margin multiplier for a given star rating
function rollMarginMultiplier(stars: number): number {
  const range = MARGIN_RANGES[Math.min(5, Math.max(1, stars))];
  if (!range) return 1.0;  // Fallback
  return rollWithinRange(range[0], range[1]);
}

const generateRandomDealer = (unlockedProducts: string[], totalEarned: number): Dealer => {
  const firstNames = DEALER_FIRST_NAMES;
  const lastNames = DEALER_LAST_NAMES;
  
  const fName = firstNames[Math.floor(Math.random() * firstNames.length)];
  let lName = lastNames[Math.floor(Math.random() * lastNames.length)];
  
  if (fName === lName) lName = 'The Fixer';

  const drug = unlockedProducts.length > 0 
    ? unlockedProducts[Math.floor(Math.random() * unlockedProducts.length)] 
    : 'weed';

  const progressBonus = Math.floor(Math.log10(totalEarned / 1000 + 1));
  const volumeStars = Math.min(5, Math.floor(Math.random() * 3) + 1 + Math.min(2, progressBonus));
  const marginStars = Math.min(5, Math.floor(Math.random() * 3) + 1 + Math.min(3, progressBonus));

  const baseVolumeGps = rollVolumeGps(volumeStars);
  const baseMarginMult = rollMarginMultiplier(marginStars);

  return {
    id: crypto.randomUUID(),
    name: `${fName} "${lName}"`,
    selling: drug,
    volume: baseVolumeGps,
    margin: baseMarginMult,
    volumeBonus: 0,
    marginBonus: 0,
    sideVolume: 0,
    equipmentCount: 0,
    maxEquipmentSlots: 3,
    riskBonus: 0,
    bulkStreetValue: 0,
    baseVolumeGps,
    baseMarginMult,
    volumeStars,
    marginStars,
    isProtected: false,
    isArrested: false,
    nextArrestCheckAt: scheduleNextArrestCheck(Date.now()),
    hasPendingUpgrade: false,
    pendingUpgradeOptions: [],
  };
};

const scheduleNextArrestCheck = (now: number) =>
  now + ARREST_CHECK_INTERVAL_MS.min + Math.floor(Math.random() * (ARREST_CHECK_INTERVAL_MS.max - ARREST_CHECK_INTERVAL_MS.min));

const normalizeDealerRiskState = (dealer: Dealer): Dealer => ({
  ...dealer,
  isProtected: dealer.isProtected ?? false,
  isArrested: dealer.isArrested ?? false,
  nextArrestCheckAt: dealer.nextArrestCheckAt ?? scheduleNextArrestCheck(Date.now()),
  hasPendingUpgrade: dealer.hasPendingUpgrade ?? false,
  pendingUpgradeOptions: dealer.pendingUpgradeOptions ?? [],
  maxEquipmentSlots: dealer.maxEquipmentSlots ?? 3,
  riskBonus: dealer.riskBonus ?? 0,
  bulkStreetValue: dealer.bulkStreetValue ?? 0,
});

const normalizeGameState = (state: GameState): GameState => ({
  ...state,
  activeDealers: state.activeDealers.map(dealer => (dealer ? normalizeDealerRiskState(dealer) : null)),
  availableDealers: state.availableDealers.map(dealer => normalizeDealerRiskState(dealer)),
  operationUpgrades: {
    ...INITIAL_GAME_STATE.operationUpgrades,
    ...(state.operationUpgrades ?? {}),
  },
  productUpgrades: {
    ...createDefaultProductUpgradeState(Object.keys(state.production)),
    ...(state.productUpgrades ?? {}),
  },
  bulkMarket: state.bulkMarket ?? INITIAL_GAME_STATE.bulkMarket,
  lastTickAt: state.lastTickAt && state.lastTickAt > 0 ? state.lastTickAt : Date.now(),
  offlineEarningsSummary: state.offlineEarningsSummary ?? null,
});

type ProductDemand = {
  dealerId: string;
  amountPerSecond: number;
  earningsPerUnit: number;
};

const allocateDemandForTick = (availableStock: number, demands: ProductDemand[]) => {
  let remainingStock = availableStock;
  const soldByDealer: Record<string, number> = {};

  demands.forEach((demand) => {
    const sold = Math.min(remainingStock, demand.amountPerSecond);
    soldByDealer[demand.dealerId] = sold;
    remainingStock = Math.max(0, remainingStock - sold);
  });

  return {
    remainingStock,
    soldByDealer,
  };
};

const buildProductDemands = (state: GameState) => {
  const productDemands = new Map<string, ProductDemand[]>();

  state.activeDealers.forEach((dealer) => {
    if (!dealer || dealer.isArrested) return;

    const effectiveVolume = getEffectiveDealerVolume(state, dealer.selling, dealer.volume, dealer.volumeBonus);
    const effectiveMargin = dealer.margin * (1 + dealer.marginBonus);
    const earningsMultiplier = dealer.isProtected ? DEALER_PROTECTION_INCOME_MULTIPLIER : 1;
    const appendDemand = (productId: string, amountPerSecond: number) => {
      if (amountPerSecond <= 0) return;

      const demands = productDemands.get(productId) ?? [];
      demands.push({
        dealerId: dealer.id,
        amountPerSecond,
        earningsPerUnit: effectiveMargin * getProductSellPrice(state, productId) * earningsMultiplier,
      });
      productDemands.set(productId, demands);
    };

    appendDemand(dealer.selling, effectiveVolume);

    if (dealer.sideVolume > 0) {
      const bleedAmount = effectiveVolume * dealer.sideVolume;
      state.unlockedProduction.forEach((productId) => {
        if (productId !== dealer.selling) {
          appendDemand(productId, bleedAmount);
        }
      });
    }
  });

  return productDemands;
};

const advanceStateBySeconds = (state: GameState, seconds: number, now: number): GameState => {
  if (seconds <= 0) return state;

  const nextProduction = { ...state.production };
  const nextEarnings: Record<string, number> = {};
  let totalEarnedAcrossSpan = 0;
  const productDemands = buildProductDemands(state);

  state.activeDealers.forEach((dealer) => {
    if (!dealer) return;
    nextEarnings[dealer.id] = 0;
  });

  Object.keys(nextProduction).forEach((productId) => {
    const item = nextProduction[productId];
    const demands = productDemands.get(productId) ?? [];

    if (demands.length === 0) {
      if (item.rate > 0) {
        nextProduction[productId] = {
          ...item,
          stock: item.stock + item.rate * seconds,
        };
      }
      return;
    }

    const totalDemandPerSecond = demands.reduce((sum, demand) => sum + demand.amountPerSecond, 0);

    if (totalDemandPerSecond <= item.rate) {
      nextProduction[productId] = {
        ...item,
        stock: item.stock + (item.rate - totalDemandPerSecond) * seconds,
      };

      demands.forEach((demand) => {
        const spanSold = demand.amountPerSecond * seconds;
        const spanEarned = spanSold * demand.earningsPerUnit;
        totalEarnedAcrossSpan += spanEarned;
        nextEarnings[demand.dealerId] += demand.amountPerSecond * demand.earningsPerUnit;
      });
      return;
    }

    const stockDeficitPerSecond = totalDemandPerSecond - item.rate;
    const fullDemandTicks = Math.min(seconds, Math.floor(item.stock / stockDeficitPerSecond));

    if (fullDemandTicks > 0) {
      demands.forEach((demand) => {
        totalEarnedAcrossSpan += fullDemandTicks * demand.amountPerSecond * demand.earningsPerUnit;
      });
    }

    if (fullDemandTicks === seconds) {
      nextProduction[productId] = {
        ...item,
        stock: item.stock - stockDeficitPerSecond * seconds,
      };

      demands.forEach((demand) => {
        nextEarnings[demand.dealerId] += demand.amountPerSecond * demand.earningsPerUnit;
      });
      return;
    }

    const stockBeforePartialTick = item.stock - fullDemandTicks * stockDeficitPerSecond;
    const partialTickAllocation = allocateDemandForTick(stockBeforePartialTick + item.rate, demands);
    const zeroStockAllocation = allocateDemandForTick(item.rate, demands);
    const zeroStockTicks = seconds - fullDemandTicks - 1;
    const finalTickAllocation = zeroStockTicks > 0 ? zeroStockAllocation : partialTickAllocation;

    demands.forEach((demand) => {
      const partialSold = partialTickAllocation.soldByDealer[demand.dealerId] ?? 0;
      const zeroStockSold = zeroStockAllocation.soldByDealer[demand.dealerId] ?? 0;
      const spanSold = fullDemandTicks * demand.amountPerSecond + partialSold + zeroStockTicks * zeroStockSold;
      const spanEarned = spanSold * demand.earningsPerUnit;

      totalEarnedAcrossSpan += spanEarned;
      nextEarnings[demand.dealerId] += (finalTickAllocation.soldByDealer[demand.dealerId] ?? 0) * demand.earningsPerUnit;
    });

    nextProduction[productId] = {
      ...item,
      stock: zeroStockTicks > 0 ? 0 : partialTickAllocation.remainingStock,
    };
  });

  return {
    ...state,
    money: state.money + totalEarnedAcrossSpan,
    totalEarned: state.totalEarned + totalEarnedAcrossSpan,
    production: nextProduction,
    lastEarningsPerDealer: nextEarnings,
    lastTickAt: now,
  };
};

const applyDueArrestChecks = (state: GameState, now: number): GameState => {
  let changed = false;
  const nextDealers = state.activeDealers.map((dealer) => {
    if (!dealer || dealer.isArrested || dealer.isProtected) return dealer;
    if (dealer.nextArrestCheckAt > now) return dealer;

    changed = true;
    const rolledArrest = Math.random() < getEffectiveProductRiskChance(state, dealer.selling, dealer.riskBonus);

    if (rolledArrest) {
      return {
        ...dealer,
        isArrested: true,
        isProtected: false,
      };
    }

    return {
      ...dealer,
      nextArrestCheckAt: scheduleNextArrestCheck(now),
    };
  });

  return changed
    ? {
        ...state,
        activeDealers: nextDealers,
      }
    : state;
};

const getNextArrestEventTick = (state: GameState, targetTime: number) => {
  let nextEventTick: number | null = null;

  state.activeDealers.forEach((dealer) => {
    if (!dealer || dealer.isArrested || dealer.isProtected) return;

    const secondsUntilCheck = Math.max(1, Math.ceil((dealer.nextArrestCheckAt - state.lastTickAt) / 1000));
    const eventTick = state.lastTickAt + secondsUntilCheck * 1000;

    if (eventTick > targetTime) return;
    if (nextEventTick === null || eventTick < nextEventTick) {
      nextEventTick = eventTick;
    }
  });

  return nextEventTick;
};

const advanceGameState = (state: GameState, now: number): GameState => {
  const lastTickAt = state.lastTickAt ?? now;
  const elapsedSeconds = Math.floor((now - lastTickAt) / 1000);
  if (elapsedSeconds <= 0) return state;

  const moneyBefore = state.money;
  const targetTime = lastTickAt + elapsedSeconds * 1000;
  let nextState = state;

  while (nextState.lastTickAt < targetTime) {
    const eventTick = getNextArrestEventTick(nextState, targetTime);
    const spanEnd = eventTick ?? targetTime;
    const secondsToAdvance = Math.floor((spanEnd - nextState.lastTickAt) / 1000);

    nextState = advanceStateBySeconds(nextState, secondsToAdvance, spanEnd);

    if (eventTick !== null && spanEnd === eventTick) {
      nextState = applyDueArrestChecks(nextState, spanEnd);
    }
  }

  const awayMs = now - lastTickAt;
  if (awayMs >= OFFLINE_EARNINGS_POPUP_THRESHOLD_MS) {
    nextState = {
      ...nextState,
      offlineEarningsSummary: {
        awayMs,
        earned: nextState.money - moneyBefore,
      },
    };
  }

  return nextState;
};

const createInitialGameState = (): GameState => ({
  ...INITIAL_GAME_STATE,
  activeDealers: [null, null, null],
  unlockedSlots: 1,
  availableDealers: Array.from({ length: 3 }, () =>
    generateRandomDealer(INITIAL_GAME_STATE.unlockedProduction, INITIAL_GAME_STATE.totalEarned)
  ),
  lastTickAt: Date.now(),
});

export const useGameEngine = () => {
  const [state, setState, clearStorage] = usePersistedGameState<GameState>(SAVE_KEY, createInitialGameState);

  useEffect(() => {
    const needsMigration = state.activeDealers.some(dealer =>
      dealer !== null && (
        dealer.isProtected === undefined ||
        dealer.isArrested === undefined ||
        dealer.nextArrestCheckAt === undefined ||
        dealer.hasPendingUpgrade === undefined ||
        dealer.pendingUpgradeOptions === undefined ||
        dealer.maxEquipmentSlots === undefined ||
        dealer.riskBonus === undefined ||
        dealer.bulkStreetValue === undefined
      )
    ) || state.availableDealers.some(dealer =>
      dealer !== null && (
        dealer.isProtected === undefined ||
        dealer.isArrested === undefined ||
        dealer.nextArrestCheckAt === undefined ||
        dealer.hasPendingUpgrade === undefined ||
        dealer.pendingUpgradeOptions === undefined ||
        dealer.maxEquipmentSlots === undefined ||
        dealer.riskBonus === undefined ||
        dealer.bulkStreetValue === undefined
      )
    ) || state.lastTickAt === undefined || state.lastTickAt <= 0 ||
    state.operationUpgrades === undefined ||
    state.productUpgrades === undefined ||
    state.bulkMarket === undefined;

    if (!needsMigration) return;

    setState(prev => normalizeGameState(prev));
  }, [state.activeDealers, state.availableDealers, setState]);

  const tick = () => {
    setState(prev => advanceGameState(prev, Date.now()));
  };

  useEffect(() => {
    setState(prev => advanceGameState(prev, Date.now()));
  }, [setState]);

  const upgrade = (id: string) => {
    setState(prev => {
      const item = prev.production[id];
      if (!item || prev.money < item.upgradeCost) return prev;
      if (!prev.unlockedProduction.includes(id)) return prev;

      return {
        ...prev,
        money: prev.money - item.upgradeCost,
        production: {
          ...prev.production,
          [id]: {
            ...item,
            level: item.level + 1,
            rate: item.rate + getProductProductionYield(prev, id),
            upgradeCost: Math.floor(item.upgradeCost * item.costMultiplier)
          }
        }
      };
    });
  };

  const unlockProduction = (id: string) => {
    setState(prev => {
      if (prev.unlockedProduction.includes(id)) return prev;
      const item = prev.production[id];
      const unlockCost = UNLOCK_COSTS[id] ?? 300;
      if (!item || prev.money < unlockCost) return prev;
      
      return {
        ...prev,
        money: prev.money - unlockCost,
        unlockedProduction: [...prev.unlockedProduction, id]
      };
    });
  };

  const hireDealer = (dealer: Dealer, slotIndex: number) => {
    setState(prev => {
      if (slotIndex >= prev.unlockedSlots) return prev;
      const newActiveDealers = [...prev.activeDealers];
      newActiveDealers[slotIndex] = normalizeDealerRiskState(dealer);
      return {
        ...prev,
        activeDealers: newActiveDealers,
        availableDealers: [
          ...prev.availableDealers.filter(d => d.id !== dealer.id),
          generateRandomDealer(prev.unlockedProduction, prev.totalEarned)
        ]
      };
    });
  };

  const refreshPool = () => {
    setState(prev => {
      const now = Date.now();
      const cooldown = 10 * 60 * 1000;
      if (now - prev.lastRefreshTime < cooldown) return prev;
      
      return {
        ...prev,
        lastRefreshTime: now,
        availableDealers: Array.from({ length: 3 }, () => 
          generateRandomDealer(prev.unlockedProduction, prev.totalEarned)
        )
      };
    });
  };

  const fireDealer = (dealerId: string) => {
    setState(prev => {
      const slotIndex = prev.activeDealers.findIndex(d => d?.id === dealerId);
      if (slotIndex === -1) return prev;
      const newActiveDealers = [...prev.activeDealers];
      newActiveDealers[slotIndex] = null;
      return { ...prev, activeDealers: newActiveDealers };
    });
  };

  const startDealerUpgrade = (dealerId: string) => {
    setState(prev => {
      const slotIndex = prev.activeDealers.findIndex(d => d?.id === dealerId);
      const dealer = slotIndex === -1 ? null : prev.activeDealers[slotIndex];
      if (!dealer || !canRollDealerUpgrade(dealer)) return prev;

      if (dealer.pendingUpgradeOptions.length === 3) {
        if (dealer.hasPendingUpgrade) return prev;
        const nextActiveDealers = [...prev.activeDealers];
        nextActiveDealers[slotIndex] = {
          ...dealer,
          hasPendingUpgrade: true,
        };
        return {
          ...prev,
          activeDealers: nextActiveDealers,
        };
      }

      const upgradeCost = getDealerEquipmentUpgradeCost(dealer.equipmentCount);
      if (prev.money < upgradeCost) return prev;

      const nextActiveDealers = [...prev.activeDealers];
      nextActiveDealers[slotIndex] = {
        ...dealer,
        hasPendingUpgrade: true,
        pendingUpgradeOptions: rollDealerUpgradeOptions({
          dealer,
          unlockedProduction: prev.unlockedProduction,
          operationUpgrades: prev.operationUpgrades,
        }),
      };

      return {
        ...prev,
        money: prev.money - upgradeCost,
        activeDealers: nextActiveDealers,
      };
    });
  };

  const buyEquipment = (dealerId: string, upgrade: DealerUpgrade) => {
    setState(prev => {
      const slotIndex = prev.activeDealers.findIndex(d => d?.id === dealerId);
      const dealer = slotIndex === -1 ? null : prev.activeDealers[slotIndex];
      if (!dealer || !canRollDealerUpgrade(dealer) || dealer.isArrested) return prev;
      if (!dealer.hasPendingUpgrade || dealer.pendingUpgradeOptions.length !== 3) return prev;

      const selectedUpgrade = dealer.pendingUpgradeOptions.find(option => upgradeMatches(option, upgrade));
      if (!selectedUpgrade) return prev;

      const nextActiveDealers = [...prev.activeDealers];
      nextActiveDealers[slotIndex] = applyDealerUpgrade(dealer, selectedUpgrade);

      return {
        ...prev,
        activeDealers: nextActiveDealers,
      };
    });
  };

  const unlockSlot = () => {
    setState(prev => {
      const cost = SLOT_UNLOCK_COSTS[prev.unlockedSlots];
      if (prev.money < cost || prev.unlockedSlots >= 3) return prev;
      return {
        ...prev,
        money: prev.money - cost,
        unlockedSlots: prev.unlockedSlots + 1
      };
    });
  };

  const setDealerSelling = (dealerId: string, selling: string) => {
    setState(prev => {
      const slotIndex = prev.activeDealers.findIndex(d => d?.id === dealerId);
      if (slotIndex === -1) return prev;
      const newActiveDealers = [...prev.activeDealers];
      const dealer = newActiveDealers[slotIndex];
      if (!dealer) return prev;
      newActiveDealers[slotIndex] = { ...dealer, selling };
      return { ...prev, activeDealers: newActiveDealers };
    });
  };

  const toggleDealerProtection = (dealerId: string) => {
    setState(prev => ({
      ...prev,
      activeDealers: prev.activeDealers.map(dealer => {
        if (!dealer || dealer.id !== dealerId || dealer.isArrested) return dealer;
        const nextProtected = !dealer.isProtected;
        return {
          ...dealer,
          isProtected: nextProtected,
          nextArrestCheckAt: nextProtected ? dealer.nextArrestCheckAt : scheduleNextArrestCheck(Date.now()),
        };
      }),
    }));
  };

  const forceArrestDealer = (dealerId: string) => {
    setState(prev => ({
      ...prev,
      activeDealers: prev.activeDealers.map(dealer =>
        dealer?.id === dealerId
          ? { ...dealer, isArrested: true, isProtected: false }
          : dealer
      ),
    }));
  };

  const payDealerBail = (dealerId: string) => {
    setState(prev => {
      const dealer = prev.activeDealers.find(d => d?.id === dealerId);
      if (!dealer || !dealer.isArrested) return prev;

      const bailCost = getBailCost(prev.lastEarningsPerDealer);
      if (prev.money < bailCost) return prev;

      return {
        ...prev,
        money: prev.money - bailCost,
        activeDealers: prev.activeDealers.map(d =>
          d?.id === dealerId
            ? {
                ...d,
                isArrested: false,
                isProtected: false,
                nextArrestCheckAt: scheduleNextArrestCheck(Date.now()),
              }
            : d
        ),
      };
    });
  };

  const dismissOfflineEarningsSummary = () => {
    setState(prev => ({
      ...prev,
      offlineEarningsSummary: null,
    }));
  };

  const buyOperationUpgrade = (id: OperationUpgradeId) => {
    setState(prev => {
      const definition = OPERATION_UPGRADE_DEFINITIONS[id];
      const currentLevel = prev.operationUpgrades[id] ?? 0;
      if (currentLevel >= definition.maxLevel) return prev;
      const cost = definition.costs[currentLevel];
      if (prev.money < cost) return prev;

      return {
        ...prev,
        money: prev.money - cost,
        operationUpgrades: {
          ...prev.operationUpgrades,
          [id]: currentLevel + 1,
        },
      };
    });
  };

  const buyProductUpgrade = (productId: string, category: ProductUpgradeCategory) => {
    setState(prev => {
      const track = prev.productUpgrades[productId]?.[category];
      if (!track || track.level >= track.maxLevel) return prev;
      const cost = getProductUpgradeCost(category, track.level);
      if (prev.money < cost) return prev;

      return {
        ...prev,
        money: prev.money - cost,
        productUpgrades: upgradeProductTrack(prev.productUpgrades, productId, category),
      };
    });
  };

  const unlockDealerEquipmentSlot = (dealerId: string) => {
    setState(prev => {
      const dealer = prev.activeDealers.find(d => d?.id === dealerId);
      if (!dealer || dealer.maxEquipmentSlots >= 5) return prev;
      const cost = getDealerSlotUnlockCost(dealer.maxEquipmentSlots);
      if (prev.money < cost) return prev;

      return {
        ...prev,
        money: prev.money - cost,
        activeDealers: prev.activeDealers.map(d =>
          d?.id === dealerId ? { ...d, maxEquipmentSlots: d.maxEquipmentSlots + 1 } : d
        ),
      };
    });
  };

  const sellBulk = (productId: string) => {
    setState(prev => {
      const now = Date.now();
      const item = prev.production[productId];
      if (!item || item.stock <= 0) return prev;
      if (!canUseBulkMarket(prev.bulkMarket, now)) return prev;

      const streetValuePercent = getBestBulkStreetValue(prev.activeDealers, prev.operationUpgrades.bulkNetwork);
      if (streetValuePercent <= 0) return prev;
      const bulkSaleConfig = getBulkSaleConfig(prev.operationUpgrades.bulkNetwork);

      const sale = sellBulkStock({
        stock: item.stock,
        maxStock: bulkSaleConfig.maxStock,
        sellPrice: getProductSellPrice(prev, productId),
        streetValuePercent,
        now,
        cooldownMs: bulkSaleConfig.cooldownMs,
      });

      return {
        ...prev,
        money: prev.money + sale.earned,
        totalEarned: prev.totalEarned + sale.earned,
        bulkMarket: sale.bulkMarket,
        production: {
          ...prev.production,
          [productId]: {
            ...item,
            stock: sale.remainingStock,
          },
        },
      };
    });
  };

  const resetGame = useCallback(() => {
    const nextState = createInitialGameState();
    clearStorage();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(nextState));
    } catch (error) {
      console.warn(`Error saving localStorage key "${SAVE_KEY}" during reset:`, error);
    }
    setState(nextState);
  }, [setState, clearStorage]);

  useInterval(tick, 1000);
  
  return {
    state,
    upgrade,
    unlockProduction,
    hireDealer,
    fireDealer,
    refreshPool,
    resetGame,
    unlockSlot,
    setDealerSelling,
    startDealerUpgrade,
    buyEquipment,
    toggleDealerProtection,
    forceArrestDealer,
    payDealerBail,
    dismissOfflineEarningsSummary,
    buyOperationUpgrade,
    buyProductUpgrade,
    unlockDealerEquipmentSlot,
    sellBulk,
  };
};
