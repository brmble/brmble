import { useState } from 'react';
import { GameState, ProductionItem } from '../types';
import { INITIAL_GAME_STATE } from '../constants';
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
      
      const active = next.production[next.dealer.selling];
      const amountToSell = Math.min(active.stock, next.dealer.salesRate);
      active.stock = Math.max(0, active.stock - amountToSell);
      next.money += amountToSell * active.price;
      
      return next;
    });
  };

  const upgrade = (id: string) => {
    setState(prev => {
      const item = prev.production[id];
      if (!item || prev.money < item.upgradeCost) return prev;
      
      return {
        ...prev,
        money: prev.money - item.upgradeCost,
        production: {
          ...prev.production,
          [id]: {
            ...item,
            level: item.level + 1,
            rate: item.rate + 0.1,
            upgradeCost: item.upgradeCost * 1.5
          }
        }
      };
    });
  };

  const setDealer = (dealer: { name: string; selling: string; salesRate: number }) => {
    setState(prev => ({ ...prev, dealer }));
  };

  useInterval(tick, 1000);
  
  return { state, upgrade, setDealer };
};