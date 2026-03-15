export interface Crop {
  id: string;
  name: string;
  baseCost: number;
  baseIncome: number;
  owned: number;
  unlocked: boolean;
  unlockCost?: number;
  soilLevel: number;
  soilUpgradeCost: number;
  fertilizerLevel: number;
  fertilizerUpgradeCost: number;
  seedsLevel: number;
  seedsUpgradeCost: number;
}

export interface Upgrade {
  id: string;
  name: string;
  description: string;
  requirement: number;
  unlocked: boolean;
  rewards: string[];
}

export interface GameState {
  money: number;
  incomePerSecond: number;
  crops: Crop[];
  upgrades: Upgrade[];
  lastSaved: number;
}

export interface GameActions {
  buyCrop: (cropId: string) => void;
  upgradeSoil: (cropId: string) => void;
  upgradeFertilizer: (cropId: string) => void;
  upgradeSeeds: (cropId: string) => void;
  unlockCrop: (cropId: string) => void;
  setTheme: (theme: string) => void;
  saveGame: () => void;
  loadGame: () => void;
  resetGame: () => void;
  exportSave: () => string;
  importSave: (data: string) => boolean;
}

export const INITIAL_CROPS: Crop[] = [
  { id: 'wheat', name: 'Wheat', baseCost: 10, baseIncome: 1, owned: 0, unlocked: true, soilLevel: 0, soilUpgradeCost: 50, fertilizerLevel: 0, fertilizerUpgradeCost: 75, seedsLevel: 0, seedsUpgradeCost: 100 },
  { id: 'corn', name: 'Corn', baseCost: 100, baseIncome: 8, owned: 0, unlocked: true, soilLevel: 0, soilUpgradeCost: 150, fertilizerLevel: 0, fertilizerUpgradeCost: 225, seedsLevel: 0, seedsUpgradeCost: 300 },
  { id: 'potatoes', name: 'Potatoes', baseCost: 1100, baseIncome: 47, owned: 0, unlocked: false, unlockCost: 5000, soilLevel: 0, soilUpgradeCost: 550, fertilizerLevel: 0, fertilizerUpgradeCost: 825, seedsLevel: 0, seedsUpgradeCost: 1100 },
  { id: 'sugarcane', name: 'Sugarcane', baseCost: 12000, baseIncome: 260, owned: 0, unlocked: false, unlockCost: 50000, soilLevel: 0, soilUpgradeCost: 6000, fertilizerLevel: 0, fertilizerUpgradeCost: 9000, seedsLevel: 0, seedsUpgradeCost: 12000 },
  { id: 'cotton', name: 'Cotton', baseCost: 130000, baseIncome: 2000, owned: 0, unlocked: false, unlockCost: 500000, soilLevel: 0, soilUpgradeCost: 65000, fertilizerLevel: 0, fertilizerUpgradeCost: 97500, seedsLevel: 0, seedsUpgradeCost: 130000 },
  { id: 'coffee', name: 'Coffee Beans', baseCost: 1400000, baseIncome: 15000, owned: 0, unlocked: false, unlockCost: 5000000, soilLevel: 0, soilUpgradeCost: 700000, fertilizerLevel: 0, fertilizerUpgradeCost: 1050000, seedsLevel: 0, seedsUpgradeCost: 1400000 },
  { id: 'cocoa', name: 'Cocoa Pods', baseCost: 20000000, baseIncome: 120000, owned: 0, unlocked: false, unlockCost: 75000000, soilLevel: 0, soilUpgradeCost: 10000000, fertilizerLevel: 0, fertilizerUpgradeCost: 15000000, seedsLevel: 0, seedsUpgradeCost: 20000000 },
  { id: 'golden', name: 'Golden Apples', baseCost: 330000000, baseIncome: 600000, owned: 0, unlocked: false, unlockCost: 1000000000, soilLevel: 0, soilUpgradeCost: 165000000, fertilizerLevel: 0, fertilizerUpgradeCost: 247500000, seedsLevel: 0, seedsUpgradeCost: 330000000 },
  { id: 'starfruit', name: 'Starfruit', baseCost: 5100000000, baseIncome: 4000000, owned: 0, unlocked: false, unlockCost: 15000000000, soilLevel: 0, soilUpgradeCost: 2550000000, fertilizerLevel: 0, fertilizerUpgradeCost: 3825000000, seedsLevel: 0, seedsUpgradeCost: 5100000000 },
  { id: 'moon', name: 'Moon Melons', baseCost: 75000000000, baseIncome: 25000000, owned: 0, unlocked: false, unlockCost: 200000000000, soilLevel: 0, soilUpgradeCost: 37500000000, fertilizerLevel: 0, fertilizerUpgradeCost: 56250000000, seedsLevel: 0, seedsUpgradeCost: 75000000000 },
  { id: 'lotus', name: 'Ethereal Lotus', baseCost: 1000000000000, baseIncome: 160000000, owned: 0, unlocked: false, unlockCost: 5000000000000, soilLevel: 0, soilUpgradeCost: 500000000000, fertilizerLevel: 0, fertilizerUpgradeCost: 750000000000, seedsLevel: 0, seedsUpgradeCost: 1000000000000 },
  { id: 'chrono', name: 'Chrono-Vines', baseCost: 14000000000000, baseIncome: 1000000000, owned: 0, unlocked: false, unlockCost: 50000000000000, soilLevel: 0, soilUpgradeCost: 7000000000000, fertilizerLevel: 0, fertilizerUpgradeCost: 10500000000000, seedsLevel: 0, seedsUpgradeCost: 14000000000000 },
  { id: 'void', name: 'Void Berries', baseCost: 170000000000000, baseIncome: 7000000000, owned: 0, unlocked: false, unlockCost: 500000000000000, soilLevel: 0, soilUpgradeCost: 85000000000000, fertilizerLevel: 0, fertilizerUpgradeCost: 127500000000000, seedsLevel: 0, seedsUpgradeCost: 170000000000000 },
];

export const INITIAL_UPGRADES: Upgrade[] = [
  { id: 'potatoes-unlock', name: 'Unlock Potatoes', description: 'Unlock Potatoes crop', requirement: 5000, unlocked: false, rewards: ['Unlock Potatoes'] },
  { id: 'sugarcane-unlock', name: 'Unlock Sugarcane', description: 'Unlock Sugarcane crop', requirement: 50000, unlocked: false, rewards: ['Unlock Sugarcane'] },
  { id: 'cotton-unlock', name: 'Unlock Cotton', description: 'Unlock Cotton crop', requirement: 500000, unlocked: false, rewards: ['Unlock Cotton'] },
];

export const INITIAL_STATE: GameState = {
  money: 25,
  incomePerSecond: 0,
  crops: INITIAL_CROPS,
  upgrades: INITIAL_UPGRADES,
  lastSaved: Date.now(),
};
