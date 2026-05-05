import { useCallback } from 'react';
import type { GameState, Dealer, DealerUpgrade } from '../types';
import { INITIAL_GAME_STATE, UNLOCK_COSTS, PRODUCT_TIERS, DEALER_FIRST_NAMES, DEALER_LAST_NAMES, SLOT_UNLOCK_COSTS, VOLUME_RANGES, MARGIN_RANGES } from '../constants';

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
  const range = MARGIN_RANGES[Math.min(6, Math.max(1, stars))];
  if (!range) return 1.0;  // Fallback
  return rollWithinRange(range[0], range[1]);
}
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
  const volumeStars = Math.min(5, Math.floor(Math.random() * 3) + 1 + Math.min(2, progressBonus));
  const marginStars = Math.min(6, Math.floor(Math.random() * 3) + 1 + Math.min(3, progressBonus));

  const baseVolumeGps = rollVolumeGps(volumeStars);
  const baseMarginMult = rollMarginMultiplier(marginStars);

  return {
    id: crypto.randomUUID(),
    name: `${fName} "${lName}"`,
    selling: drug,
    volume: baseVolumeGps * (1 + 0),
    margin: baseMarginMult * (1 + 0),
    volumeBonus: 0,
    marginBonus: 0,
    sideVolume: 0.10,
    equipmentCount: 0,
    baseVolumeGps,
    baseMarginMult
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

        const effectiveVolume = dealer.volume * (1 + dealer.volumeBonus);
        const effectiveMargin = dealer.margin * (1 + dealer.marginBonus);

        const primaryProd = nextProduction[dealer.selling];
        if (!primaryProd) return;

        const primarySold = Math.min(primaryProd.stock, effectiveVolume);
        nextProduction[dealer.selling] = { 
          ...primaryProd, 
          stock: Math.max(0, primaryProd.stock - primarySold) 
        };

        const primaryRev = primarySold * (effectiveMargin * (PRODUCT_TIERS[dealer.selling] || 1));
        let sideRev = 0;

        // Side hustle: Each dealer simultaneously liquidates other commodities as a secondary income phase.
        // This is NOT subtracted from primary sales — it's a separate automatic parallel process.
        if (dealer.sideVolume > 0) {
          const bleedAmount = effectiveVolume * dealer.sideVolume;  // e.g., 10 g/s volume * 10% = 1 g/s to each other commodity
          
          for (const product of Object.keys(nextProduction)) {
            if (product !== dealer.selling) {
              const sideProd = nextProduction[product];
              if (!sideProd) continue;
              const sold = Math.min(sideProd.stock, bleedAmount);
              nextProduction[product] = { ...sideProd, stock: Math.max(0, sideProd.stock - sold) };
              sideRev += sold * (effectiveMargin * (PRODUCT_TIERS[product] || 1));
            }
          }
        }

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
        if (upgrade.type === 'SIDE_HUSTLE') {
          newDealer.sideVolume = (newDealer.sideVolume || 0) + (upgrade.sideVolumeValue || 0.10);
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