import { useState, useCallback } from 'react';
import type { GameState, Dealer } from '../types';
import { INITIAL_GAME_STATE, UNLOCK_COSTS } from '../constants';
import { useInterval } from './useInterval';

export const useGameEngine = () => {
  const [state, setState] = useState<GameState>(INITIAL_GAME_STATE);

  const tick = () => {
    setState(prev => {
      const next: GameState = {
        ...prev,
        production: { ...prev.production }
      };
      
      Object.keys(next.production).forEach(key => {
        next.production[key] = { ...next.production[key] };
        next.production[key].stock += next.production[key].rate;
      });
      
      if (!prev.dealer) return next;
      
      const currentDealer = prev.dealer;
      const active = next.production[currentDealer.selling];
      if (!active) return next;
      
      const effectiveSalesRate = currentDealer.salesRate * currentDealer.volume;
      const amountToSell = Math.min(active.stock, active.rate, effectiveSalesRate);
      active.stock = Math.max(0, active.stock - amountToSell);
      
      const grossEarnings = amountToSell * active.price;
      const marginCost = grossEarnings * (currentDealer.margin * 0.1);
      const netEarnings = grossEarnings - marginCost;
      
      const bribeCost = currentDealer.bribeLevel > 0 ? netEarnings * 0.1 : 0;
      const earnedThisTick = netEarnings - bribeCost;
      next.money += earnedThisTick;
      next.totalEarned += earnedThisTick;
      
      return next;
    });
  };

  const upgrade = (id: string) => {
    setState(prev => {
      const item = prev.production[id];
      const currentUpgradeCost = Math.floor(item.upgradeCost);
      if (!item || prev.money < currentUpgradeCost) return prev;
      
      let rateIncrease = 0.1;
      if (id === 'mushrooms') rateIncrease = 0.15;
      if (id === 'meth') rateIncrease = 0.05;
      
      const costMultiplier = id === 'weed' ? 1.4 : id === 'mushrooms' ? 1.5 : 2.0;
      const nextUpgradeCost = Math.floor(item.upgradeCost * costMultiplier);
      
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
        },
        unlockedProduction: prev.unlockedProduction.includes(id) 
          ? prev.unlockedProduction 
          : [...prev.unlockedProduction, id]
      };
    });
  };

  const unlockProduction = (id: string) => {
    setState(prev => {
      const item = prev.production[id];
      const unlockCost = UNLOCK_COSTS[id] || 300;
      if (!item || prev.money < unlockCost) return prev;
      
      return {
        ...prev,
        money: prev.money - unlockCost,
        unlockedProduction: prev.unlockedProduction.includes(id)
          ? prev.unlockedProduction
          : [...prev.unlockedProduction, id]
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