import { useState, useCallback } from 'react';
import type { GameState, Dealer } from '../types';
import { INITIAL_GAME_STATE, UNLOCK_COSTS, PRODUCT_TIERS } from '../constants';
import { useInterval } from './useInterval';

export const useGameEngine = () => {
  const [state, setState] = useState<GameState>(INITIAL_GAME_STATE);

  const tick = () => {
    setState(prev => {
      const nextProduction: GameState['production'] = {};
      
      Object.keys(prev.production).forEach(key => {
        nextProduction[key] = {
          ...prev.production[key],
          stock: prev.production[key].stock + prev.production[key].rate
        };
      });
      
      if (!prev.dealer) return { ...prev, production: nextProduction };
      
      const currentDealer = prev.dealer;
      const dealerDrugId = currentDealer.selling;
      const active = nextProduction[dealerDrugId];
      
      if (!active) return { ...prev, production: nextProduction };
      
      const amountToSell = Math.min(active.stock, currentDealer.volume);
      nextProduction[dealerDrugId] = {
        ...active,
        stock: Math.max(0, active.stock - amountToSell)
      };
      
      const tierMult = PRODUCT_TIERS[dealerDrugId] || 1;
      const earnedThisTick = amountToSell * (currentDealer.margin * tierMult);
      const bribeCost = currentDealer.bribeLevel > 0 ? earnedThisTick * 0.1 : 0;
      const finalProfit = earnedThisTick - bribeCost;
      
      return {
        ...prev,
        money: prev.money + finalProfit,
        totalEarned: prev.totalEarned + finalProfit,
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

  const hireDealer = (dealer: Dealer) => {
    setState(prev => ({ ...prev, dealer }));
  };

  const fireDealer = () => {
    setState(prev => ({ ...prev, dealer: null }));
  };

  const setBribeLevel = (level: number) => {
    setState(prev => {
      if (!prev.dealer) return prev;
      return {
        ...prev,
        dealer: { ...prev.dealer, bribeLevel: level }
      };
    });
  };

  const resetGame = useCallback(() => {
    setState(INITIAL_GAME_STATE);
  }, []);

  useInterval(tick, 1000);
  
  return { state, upgrade, unlockProduction, hireDealer, fireDealer, setBribeLevel, resetGame };
};