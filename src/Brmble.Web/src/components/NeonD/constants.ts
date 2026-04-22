import { GameState } from './types';

export const INITIAL_GAME_STATE: GameState = {
  money: 250.00,
  researchSpeed: 1.0,
  production: {
    weed: { id: 'weed', name: 'Weed', stock: 33.16, price: 4.20, rate: 0.2, level: 1, upgradeCost: 16.80 },
    mushrooms: { id: 'mushrooms', name: 'Mushrooms', stock: 183.91, price: 6.00, rate: 1.2, level: 4, upgradeCost: 262.35 },
    meth: { id: 'meth', name: 'Meth', stock: 124.92, price: 10.00, rate: 1.0, level: 2, upgradeCost: 1440.00 }
  },
  dealer: { name: 'Thomas "G" Palmer', selling: 'weed', salesRate: 3.45 }
};