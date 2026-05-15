import { useCallback, useEffect } from 'react';
import { useInterval } from './useInterval';
import { usePersistedGameState } from './usePersistedGameState';
import type { GameState, Dealer, DealerUpgrade } from '../types';
import { INITIAL_GAME_STATE, UNLOCK_COSTS, PRODUCT_TIERS, DEALER_FIRST_NAMES, DEALER_LAST_NAMES, SLOT_UNLOCK_COSTS, VOLUME_RANGES, MARGIN_RANGES, ARREST_CHECK_INTERVAL_MS, DEALER_PROTECTION_INCOME_MULTIPLIER, PRODUCT_ARREST_RISK } from '../constants';
import { getBailCost } from '../economy';

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

const COMMON_DEALER_UPGRADES: DealerUpgrade[] = [
  { type: 'VOLUME', label: 'Armed Gang', description: 'Volume +15%', value: 0.15 },
  { type: 'MARGIN', label: 'Ferrari', description: 'Margin +15%', value: 0.15 },
  { type: 'ALL_AROUNDER', label: 'Copter', description: 'Volume & Margin +5%', value: 0.05 },
];

const UNCOMMON_DEALER_UPGRADES: DealerUpgrade[] = [
  { type: 'BULK', label: 'The Crew', description: 'Volume +35%, Margin -10%', value: 0.35, marginPenalty: 0.1 },
];

const getDealerEquipmentUpgradeCost = (equipmentCount: number) => 500 * Math.pow(2.5, equipmentCount);

const upgradeMatches = (a: DealerUpgrade, b: DealerUpgrade) =>
  a.type === b.type &&
  a.label === b.label &&
  a.description === b.description &&
  a.value === b.value &&
  (a.marginPenalty ?? 0) === (b.marginPenalty ?? 0) &&
  (a.sideVolumeValue ?? 0) === (b.sideVolumeValue ?? 0);

const generateDealerUpgradeOptions = (dealer: Dealer, unlockedProduction: string[]): DealerUpgrade[] => {
  const sideHustleProducts = unlockedProduction.filter(id => id !== dealer.selling);
  const options: DealerUpgrade[] = [];

  for (let i = 0; i < 3; i++) {
    const roll = Math.random();
    if (roll < 0.10 && sideHustleProducts.length > 0) {
      options.push({
        type: 'SIDE_HUSTLE',
        label: 'JACKPOT: Side Hustle',
        description: 'Add 10% side volume bleed',
        value: 0.1,
        sideVolumeValue: 0.1,
      });
    } else if (roll < 0.30) {
      const upgrade = UNCOMMON_DEALER_UPGRADES[Math.floor(Math.random() * UNCOMMON_DEALER_UPGRADES.length)];
      options.push({ ...upgrade });
    } else {
      const upgrade = COMMON_DEALER_UPGRADES[Math.floor(Math.random() * COMMON_DEALER_UPGRADES.length)];
      options.push({ ...upgrade });
    }
  }

  return options;
};

const applyDealerUpgrade = (dealer: Dealer, upgrade: DealerUpgrade): Dealer => {
  const nextDealer = { ...dealer, equipmentCount: dealer.equipmentCount + 1 };

  if (upgrade.type === 'VOLUME') nextDealer.volumeBonus += upgrade.value;
  if (upgrade.type === 'MARGIN') nextDealer.marginBonus += upgrade.value;
  if (upgrade.type === 'ALL_AROUNDER') {
    nextDealer.volumeBonus += upgrade.value;
    nextDealer.marginBonus += upgrade.value;
  }
  if (upgrade.type === 'BULK') {
    nextDealer.volumeBonus += upgrade.value;
    nextDealer.marginBonus -= upgrade.marginPenalty || 0.1;
  }
  if (upgrade.type === 'SIDE_HUSTLE') {
    nextDealer.sideVolume = (nextDealer.sideVolume ?? 0) + (upgrade.sideVolumeValue ?? 0.10);
  }

  return {
    ...nextDealer,
    hasPendingUpgrade: false,
    pendingUpgradeOptions: [],
  };
};

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

const getDealerRisk = (productId: string) =>
  PRODUCT_ARREST_RISK[productId] ?? { chance: 0.10, label: 'LOW' as const };

const normalizeDealerRiskState = (dealer: Dealer): Dealer => ({
  ...dealer,
  isProtected: dealer.isProtected ?? false,
  isArrested: dealer.isArrested ?? false,
  nextArrestCheckAt: dealer.nextArrestCheckAt ?? scheduleNextArrestCheck(Date.now()),
  hasPendingUpgrade: dealer.hasPendingUpgrade ?? false,
  pendingUpgradeOptions: dealer.pendingUpgradeOptions ?? [],
});

export const useGameEngine = () => {
  const [state, setState, clearStorage] = usePersistedGameState<GameState>('brmble_neon_d_save', () => {
    const initial = INITIAL_GAME_STATE;
    return {
      ...initial,
      activeDealers: [null, null, null],
      unlockedSlots: 1,
      availableDealers: Array.from({ length: 3 }, () => 
        generateRandomDealer(initial.unlockedProduction, initial.totalEarned)
      )
    };
  });

  useEffect(() => {
    const needsMigration = state.activeDealers.some(dealer =>
      dealer !== null && (
        dealer.isProtected === undefined ||
        dealer.isArrested === undefined ||
        dealer.nextArrestCheckAt === undefined ||
        dealer.hasPendingUpgrade === undefined ||
        dealer.pendingUpgradeOptions === undefined
      )
    ) || state.availableDealers.some(dealer =>
      dealer !== null && (
        dealer.isProtected === undefined ||
        dealer.isArrested === undefined ||
        dealer.nextArrestCheckAt === undefined ||
        dealer.hasPendingUpgrade === undefined ||
        dealer.pendingUpgradeOptions === undefined
      )
    );

    if (!needsMigration) return;

    setState(prev => ({
      ...prev,
      activeDealers: prev.activeDealers.map(dealer => (dealer ? normalizeDealerRiskState(dealer) : null)),
      availableDealers: prev.availableDealers.map(dealer => normalizeDealerRiskState(dealer)),
    }));
  }, [state.activeDealers, state.availableDealers, setState]);

  const tick = () => {
    setState(prev => {
      const nextProduction = { ...prev.production };
      const nextEarnings: Record<string, number> = {};
      let totalEarnedThisTick = 0;

      Object.keys(nextProduction).forEach(key => {
        if (nextProduction[key].rate > 0) {
          nextProduction[key] = {
            ...nextProduction[key],
            stock: nextProduction[key].stock + nextProduction[key].rate
          };
        }
      });

      prev.activeDealers.forEach((dealer) => {
        if (!dealer) return;
        if (dealer.isArrested) {
          nextEarnings[dealer.id] = 0;
          return;
        }
        let dealerGross = 0;

        const effectiveVolume = dealer.volume * (1 + dealer.volumeBonus);
        const effectiveMargin = dealer.margin * (1 + dealer.marginBonus);

        const primaryProd = nextProduction[dealer.selling];
        if (primaryProd) {
          const primarySold = Math.min(primaryProd.stock, effectiveVolume);
          nextProduction[dealer.selling] = { 
            ...primaryProd, 
            stock: Math.max(0, primaryProd.stock - primarySold) 
          };
          dealerGross += primarySold * (effectiveMargin * (PRODUCT_TIERS[dealer.selling] || 1));
        }

        if (dealer.sideVolume > 0) {
          const bleedAmount = effectiveVolume * dealer.sideVolume;
          // Side volume only applies to other UNLOCKED products
          for (const product of prev.unlockedProduction) {
            if (product !== dealer.selling) {
              const sideProd = nextProduction[product];
              if (!sideProd) continue;
              const sold = Math.min(sideProd.stock, bleedAmount);
              nextProduction[product] = { ...sideProd, stock: Math.max(0, sideProd.stock - sold) };
              dealerGross += sold * (effectiveMargin * (PRODUCT_TIERS[product] || 1));
            }
          }
        }

        if (dealer.isProtected) {
          dealerGross *= DEALER_PROTECTION_INCOME_MULTIPLIER;
        }

        nextEarnings[dealer.id] = dealerGross;
        totalEarnedThisTick += dealerGross;
      });

      const now = Date.now();
      let nextDealers = prev.activeDealers.map(dealer => dealer ? { ...dealer } : null);
      nextDealers = nextDealers.map(dealer => {
        if (!dealer || dealer.isArrested || dealer.isProtected) return dealer;
        if (dealer.nextArrestCheckAt > now) return dealer;

        const risk = getDealerRisk(dealer.selling);
        const rolledArrest = Math.random() < risk.chance;

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

      return {
        ...prev,
        money: prev.money + totalEarnedThisTick,
        totalEarned: prev.totalEarned + totalEarnedThisTick,
        production: nextProduction,
        activeDealers: nextDealers,
        lastEarningsPerDealer: nextEarnings
      };
    });
  };

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
            rate: item.rate + item.yieldPerLevel,
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
      if (!dealer || dealer.equipmentCount >= 3) return prev;

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
        pendingUpgradeOptions: generateDealerUpgradeOptions(dealer, prev.unlockedProduction),
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
      if (!dealer || dealer.equipmentCount >= 3 || dealer.isArrested) return prev;
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

  const resetGame = useCallback(() => {
    clearStorage();
    setState({
      ...INITIAL_GAME_STATE,
      activeDealers: [null, null, null],
      unlockedSlots: 1,
      availableDealers: Array.from({ length: 3 }, () => 
        generateRandomDealer(INITIAL_GAME_STATE.unlockedProduction, INITIAL_GAME_STATE.totalEarned)
      )
    });
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
  };
};
