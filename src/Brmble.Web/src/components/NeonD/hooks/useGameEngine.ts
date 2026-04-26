import { useCallback } from 'react';
import type { GameState, Dealer, DealerUpgrade } from '../types';
import { INITIAL_GAME_STATE, UNLOCK_COSTS, PRODUCT_TIERS, DEALER_FIRST_NAMES, DEALER_LAST_NAMES, SLOT_UNLOCK_COSTS } from '../constants';
import { useInterval } from './useInterval';
import { usePersistedGameState } from './usePersistedGameState';

const generateRandomDealer = (unlockedProducts: string[], totalEarned: number): Dealer => {
  const firstNames = DEALER_FIRST_NAMES;
  const lastNames = DEALER_LAST_NAMES;
  
  const fName = firstNames[Math.floor(Math.random() * firstNames.length)];
  let lName = lastNames[Math.floor(Math.random() * lastNames.length)];
  
  if (fName === lName) lName = 'The Fixer';

  const drug = unlockedProducts.length > 0 
    ? unlockedProducts[Math.floor(Math.random() * unlockedProducts.length)] 
    : 'weed';

  const progressBonus = Math.floor(totalEarned / 10000);
  const rollStat = () => Math.min(5, Math.floor(Math.random() * 3) + 1 + Math.min(2, progressBonus));

  return {
    id: crypto.randomUUID(),
    name: `${fName} "${lName}"`,
    selling: drug,
    volume: rollStat(),
    margin: rollStat(),
    volumeBonus: 1.0,
    marginBonus: 1.0,
    sideHustle: {},
    networkBonus: 0,
    equipmentCount: 0
  };
};

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

  const tick = () => {
    setState(prev => {
      const nextProduction = { ...prev.production };
      let totalEarnedThisTick = 0;

      Object.keys(nextProduction).forEach(key => {
        nextProduction[key] = {
          ...nextProduction[key],
          stock: nextProduction[key].stock + nextProduction[key].rate
        };
      });

      prev.activeDealers.forEach((dealer) => {
        if (!dealer) return;

        const totalVol = dealer.volume * dealer.volumeBonus;
        const effectiveSideHustle = Object.fromEntries(
          Object.entries(dealer.sideHustle).map(([k, v]) => [k, v * (1 + dealer.networkBonus)])
        );
        const sideRatio = Math.min(0.9, Object.values(effectiveSideHustle).reduce((a, b) => a + b, 0));

        const primaryProd = nextProduction[dealer.selling];
        if (!primaryProd) return;

        const primarySold = Math.min(primaryProd.stock, totalVol * (1 - sideRatio));
        nextProduction[dealer.selling] = { 
          ...primaryProd, 
          stock: Math.max(0, primaryProd.stock - primarySold) 
        };

        let sideRev = 0;
        Object.entries(effectiveSideHustle).forEach(([prodId, ratio]) => {
          const sideProd = nextProduction[prodId];
          if (!sideProd) return;
          const sold = Math.min(sideProd.stock, totalVol * ratio);
          nextProduction[prodId] = { ...sideProd, stock: Math.max(0, sideProd.stock - sold) };
          sideRev += sold * (dealer.margin * dealer.marginBonus * (PRODUCT_TIERS[prodId] || 1));
        });

        const primaryRev = primarySold * (dealer.margin * dealer.marginBonus * (PRODUCT_TIERS[dealer.selling] || 1));
        const gross = primaryRev + sideRev;
        totalEarnedThisTick += gross;
      });

      return {
        ...prev,
        money: prev.money + totalEarnedThisTick,
        totalEarned: prev.totalEarned + totalEarnedThisTick,
        production: nextProduction
      };
    });
  };

  const upgrade = (id: string) => {
    setState(prev => {
      const item = prev.production[id];
      if (!item) return prev;
      const currentUpgradeCost = Math.floor(item.upgradeCost);
      if (prev.money < currentUpgradeCost) return prev;
      if (!prev.unlockedProduction.includes(id)) return prev;
      
      const rateIncreases: Record<string, number> = {
        weed: 0.10,
        mushrooms: 0.07,
        meth: 0.04,
      };
      const rateIncrease = rateIncreases[id] || 0.02;
      
      const costMultipliers: Record<string, number> = {
        weed: 1.35,
        mushrooms: 1.45,
        meth: 1.6,
      };
      const multiplier = costMultipliers[id] || 1.8;
      const nextUpgradeCost = Math.floor(item.upgradeCost * multiplier);
      
      return {
        ...prev,
        money: prev.money - currentUpgradeCost,
        production: {
          ...prev.production,
          [id]: {
            ...item,
            level: item.level + 1,
            rate: item.rate + rateIncrease,
            upgradeCost: nextUpgradeCost
          }
        }
      };
    });
  };

  const unlockProduction = (id: string) => {
    setState(prev => {
      if (prev.unlockedProduction.includes(id)) return prev;
      const item = prev.production[id];
      const unlockCost = UNLOCK_COSTS[id] || 300;
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
      newActiveDealers[slotIndex] = dealer;
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

  const buyEquipment = (dealerId: string, upgrade: DealerUpgrade) => {
    setState(prev => {
      const dealer = prev.activeDealers.find(d => d?.id === dealerId);
      
      if (!dealer || dealer.equipmentCount >= 3) return prev;

      const upgradeCost = 500 * Math.pow(2.5, dealer.equipmentCount);
      if (prev.money < upgradeCost) return prev;

      const nextDealers = prev.activeDealers.map(d => {
        if (d?.id !== dealerId) return d;
        const newDealer = { ...d, equipmentCount: d.equipmentCount + 1 };
        
        if (upgrade.type === 'VOLUME') newDealer.volumeBonus += upgrade.value;
        if (upgrade.type === 'MARGIN') newDealer.marginBonus += upgrade.value;
        if (upgrade.type === 'ALL_AROUNDER') {
          newDealer.volumeBonus += upgrade.value;
          newDealer.marginBonus += upgrade.value;
        }
        if (upgrade.type === 'BULK') {
          newDealer.volumeBonus += upgrade.value;
          newDealer.marginBonus -= upgrade.marginPenalty || 0.1;
        }
        if (upgrade.type === 'NETWORK') {
          newDealer.networkBonus += upgrade.value;
        }
        if (upgrade.type === 'SIDE_HUSTLE' && upgrade.targetProductId) {
          newDealer.sideHustle = { 
            ...d.sideHustle, 
            [upgrade.targetProductId]: (d.sideHustle[upgrade.targetProductId] || 0) + upgrade.value 
          };
        }
        return newDealer;
      });

      return { ...prev, money: prev.money - upgradeCost, activeDealers: nextDealers };
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
  }, [setState]);

  useInterval(tick, 1000);
  
  return { state, upgrade, unlockProduction, hireDealer, fireDealer, refreshPool, resetGame, unlockSlot, setDealerSelling, buyEquipment };
};