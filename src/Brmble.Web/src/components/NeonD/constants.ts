import type { GameState } from './types';

export const INITIAL_GAME_STATE: GameState = {
  money: 250.00,
  totalEarned: 0,
  researchSpeed: 1.0,
  production: {
    weed: { id: 'weed', name: 'Weed', stock: 0, price: 4.20, rate: 0, level: 0, upgradeCost: 17 },
    mushrooms: { id: 'mushrooms', name: 'Mushrooms', stock: 0, price: 6.00, rate: 0, level: 0, upgradeCost: 250 },
    meth: { id: 'meth', name: 'Meth', stock: 0, price: 10.00, rate: 0, level: 0, upgradeCost: 500 },
    bluelotus: { id: 'bluelotus', name: 'Blue Lotus', stock: 0, price: 15.00, rate: 0, level: 0, upgradeCost: 1200 },
    frostbite: { id: 'frostbite', name: 'Frost-Bite', stock: 0, price: 35.00, rate: 0, level: 0, upgradeCost: 3500 },
    electriclace: { id: 'electriclace', name: 'Electric Lace', stock: 0, price: 25.00, rate: 0, level: 0, upgradeCost: 2500 },
    pharmgrade: { id: 'pharmgrade', name: 'Pharm-Grade', stock: 0, price: 5.50, rate: 0, level: 0, upgradeCost: 8000 },
    khole: { id: 'khole', name: 'K-Hole', stock: 0, price: 60.00, rate: 0, level: 0, upgradeCost: 15000 },
    lunarregolith: { id: 'lunarregolith', name: 'Lunar Regolith', stock: 0, price: 85.00, rate: 0, level: 0, upgradeCost: 25000 },
    martianspores: { id: 'martianspores', name: 'Martian Spores', stock: 0, price: 45.00, rate: 0, level: 0, upgradeCost: 20000 },
    nebulamist: { id: 'nebulamist', name: 'Nebula Mist', stock: 0, price: 120.00, rate: 0, level: 0, upgradeCost: 40000 },
    voidcrystals: { id: 'voidcrystals', name: 'Void Crystals', stock: 0, price: 200.00, rate: 0, level: 0, upgradeCost: 75000 },
    chronosalt: { id: 'chronosalt', name: 'Chrono-Salt', stock: 0, price: 150.00, rate: 0, level: 0, upgradeCost: 60000 },
    stardustresin: { id: 'stardustresin', name: 'Stardust Resin', stock: 0, price: 300.00, rate: 0, level: 0, upgradeCost: 120000 },
    darkmatterink: { id: 'darkmatterink', name: 'Dark Matter Ink', stock: 0, price: 180.00, rate: 0, level: 0, upgradeCost: 100000 },
    singularityshards: { id: 'singularityshards', name: 'Singularity Shards', stock: 0, price: 500.00, rate: 0, level: 0, upgradeCost: 250000 },
    neutronflakes: { id: 'neutronflakes', name: 'Neutron Flakes', stock: 0, price: 800.00, rate: 0, level: 0, upgradeCost: 500000 },
    galacticcore: { id: 'galacticcore', name: 'Galactic Core', stock: 0, price: 1500.00, rate: 0, level: 0, upgradeCost: 1000000 }
  },
  unlockedProduction: [],
  dealer: null
};

export const DEALER_STATS = {
  thomas: { volume: 3, margin: 3 },
  dave: { volume: 4, margin: 2 },
  bob: { volume: 2, margin: 4 },
  carlos: { volume: 1, margin: 5 },
};

export const UNLOCK_COSTS: Record<string, number> = {
  weed: 50,
  mushrooms: 150,
  meth: 300,
  bluelotus: 800,
  frostbite: 2500,
  electriclace: 2000,
  pharmgrade: 6000,
  khole: 12000,
  lunarregolith: 20000,
  martianspores: 18000,
  nebulamist: 35000,
  voidcrystals: 60000,
  chronosalt: 50000,
  stardustresin: 100000,
  darkmatterink: 85000,
  singularityshards: 200000,
  neutronflakes: 400000,
  galacticcore: 850000,
};