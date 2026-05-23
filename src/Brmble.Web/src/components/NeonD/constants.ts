import type { GameState } from './types';

// Complete 18-tier pricing data from DST economic model
// Pricing Model: T1-T5 represents 5 progression tiers with base prices increasing by 10x per tier (4.20, 6.00, 10.00, 15.00, 20.00).
// Each tier has 3-4 products that scale proportionally. Higher tiers maintain exponential growth through both cost multiplier increases
// (T1: 1.12, T5: 1.61) and yieldPerLevel bonuses. This creates a balanced progression where player upgrades feel impactful
// while maintaining consistent economic scaling across the 18-product hierarchy.
export const TIER_DATA = {
  weed: {
    name: "Weed",
    c0: 15,
    costMultiplier: 1.12,
    yieldPerLevel: 0.20,
    unlockCost: 0,
    sellPrice: 4.20
  },
  mushrooms: {
    name: "Mushrooms",
    c0: 150,
    costMultiplier: 1.15,
    yieldPerLevel: 0.30,
    unlockCost: 2000,
    sellPrice: 6.00
  },
  blueLotus: {
    name: "Blue Lotus",
    c0: 1500,
    costMultiplier: 1.18,
    yieldPerLevel: 0.45,
    unlockCost: 25000,
    sellPrice: 10.00
  },
  frostBite: {
    name: "Frostbite",
    c0: 15000,
    costMultiplier: 1.20,
    yieldPerLevel: 0.65,
    unlockCost: 250000,
    sellPrice: 15.00
  },
  electricLace: {
    name: "Electric Lace",
    c0: 150000,
    costMultiplier: 1.22,
    yieldPerLevel: 1.00,
    unlockCost: 2500000,
    sellPrice: 20.00
  },
  meth: {
    name: "Meth",
    c0: 1500000,
    costMultiplier: 1.25,
    yieldPerLevel: 1.50,
    unlockCost: 25000000,
    sellPrice: 26.67
  },
  pharmGrade: {
    name: "Pharm Grade",
    c0: 15000000,
    costMultiplier: 1.28,
    yieldPerLevel: 2.50,
    unlockCost: 250000000,
    sellPrice: 35.56
  },
  khole: {
    name: "K-Hole",
    c0: 150000000,
    costMultiplier: 1.31,
    yieldPerLevel: 3.75,
    unlockCost: 2500000000,
    sellPrice: 47.41
  },
  lunarRegolith: {
    name: "Lunar Regolith",
    c0: 1500000000,
    costMultiplier: 1.34,
    yieldPerLevel: 5.625,
    unlockCost: 25000000000,
    sellPrice: 63.21
  },
  martianSpores: {
    name: "Martian Spores",
    c0: 15000000000,
    costMultiplier: 1.37,
    yieldPerLevel: 8.4375,
    unlockCost: 250000000000,
    sellPrice: 84.28
  },
  nebulaMist: {
    name: "Nebula Mist",
    c0: 150000000000,
    costMultiplier: 1.40,
    yieldPerLevel: 12.65625,
    unlockCost: 2500000000000,
    sellPrice: 112.37
  },
  voidCrystals: {
    name: "Void Crystals",
    c0: 1500000000000,
    costMultiplier: 1.43,
    yieldPerLevel: 18.984375,
    unlockCost: 25000000000000,
    sellPrice: 149.82
  },
  chronoSalt: {
    name: "Chrono Salt",
    c0: 15000000000000,
    costMultiplier: 1.46,
    yieldPerLevel: 28.4765625,
    unlockCost: 250000000000000,
    sellPrice: 199.75
  },
  stardustResin: {
    name: "Stardust Resin",
    c0: 150000000000000,
    costMultiplier: 1.49,
    yieldPerLevel: 42.71484375,
    unlockCost: 2500000000000000,
    sellPrice: 266.32
  },
  darkMatterInk: {
    name: "Dark Matter Ink",
    c0: 1500000000000000,
    costMultiplier: 1.52,
    yieldPerLevel: 64.07226563,
    unlockCost: 25000000000000000,
    sellPrice: 355.08
  },
  singularityShards: {
    name: "Singularity Shards",
    c0: 15000000000000000,
    costMultiplier: 1.55,
    yieldPerLevel: 96.10839844,
    unlockCost: 250000000000000000,
    sellPrice: 473.42
  },
  neutronFlakes: {
    name: "Neutron Flakes",
    c0: 150000000000000000,
    costMultiplier: 1.58,
    yieldPerLevel: 144.1625977,
    unlockCost: 2500000000000000000,
    sellPrice: 631.20
  },
  galacticCore: {
    name: "Galactic Core",
    c0: 1500000000000000000,
    costMultiplier: 1.61,
    yieldPerLevel: 216.2438965,
    unlockCost: 25000000000000000000,
    sellPrice: 841.56
  }
} as const;

export const PRODUCT_TIERS: Record<string, number> = {
  weed: TIER_DATA.weed.sellPrice,
  mushrooms: TIER_DATA.mushrooms.sellPrice,
  blueLotus: TIER_DATA.blueLotus.sellPrice,
  frostBite: TIER_DATA.frostBite.sellPrice,
  electricLace: TIER_DATA.electricLace.sellPrice,
  meth: TIER_DATA.meth.sellPrice,
  pharmGrade: TIER_DATA.pharmGrade.sellPrice,
  khole: TIER_DATA.khole.sellPrice,
  lunarRegolith: TIER_DATA.lunarRegolith.sellPrice,
  martianSpores: TIER_DATA.martianSpores.sellPrice,
  nebulaMist: TIER_DATA.nebulaMist.sellPrice,
  voidCrystals: TIER_DATA.voidCrystals.sellPrice,
  chronoSalt: TIER_DATA.chronoSalt.sellPrice,
  stardustResin: TIER_DATA.stardustResin.sellPrice,
  darkMatterInk: TIER_DATA.darkMatterInk.sellPrice,
  singularityShards: TIER_DATA.singularityShards.sellPrice,
  neutronFlakes: TIER_DATA.neutronFlakes.sellPrice,
  galacticCore: TIER_DATA.galacticCore.sellPrice,
};

export const UNLOCK_COSTS: Record<string, number> = {
  weed: TIER_DATA.weed.unlockCost,
  mushrooms: TIER_DATA.mushrooms.unlockCost,
  blueLotus: TIER_DATA.blueLotus.unlockCost,
  frostBite: TIER_DATA.frostBite.unlockCost,
  electricLace: TIER_DATA.electricLace.unlockCost,
  meth: TIER_DATA.meth.unlockCost,
  pharmGrade: TIER_DATA.pharmGrade.unlockCost,
  khole: TIER_DATA.khole.unlockCost,
  lunarRegolith: TIER_DATA.lunarRegolith.unlockCost,
  martianSpores: TIER_DATA.martianSpores.unlockCost,
  nebulaMist: TIER_DATA.nebulaMist.unlockCost,
  voidCrystals: TIER_DATA.voidCrystals.unlockCost,
  chronoSalt: TIER_DATA.chronoSalt.unlockCost,
  stardustResin: TIER_DATA.stardustResin.unlockCost,
  darkMatterInk: TIER_DATA.darkMatterInk.unlockCost,
  singularityShards: TIER_DATA.singularityShards.unlockCost,
  neutronFlakes: TIER_DATA.neutronFlakes.unlockCost,
  galacticCore: TIER_DATA.galacticCore.unlockCost,
};

export const INITIAL_GAME_STATE: GameState = {
  money: 250.00,
  totalEarned: 0,
  researchSpeed: 1.0,
  production: {
    weed: {
      id: "weed",
      name: TIER_DATA.weed.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.weed.yieldPerLevel,
      costMultiplier: TIER_DATA.weed.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.weed.c0
    },
    mushrooms: {
      id: "mushrooms",
      name: TIER_DATA.mushrooms.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.mushrooms.yieldPerLevel,
      costMultiplier: TIER_DATA.mushrooms.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.mushrooms.c0
    },
    blueLotus: {
      id: "blueLotus",
      name: TIER_DATA.blueLotus.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.blueLotus.yieldPerLevel,
      costMultiplier: TIER_DATA.blueLotus.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.blueLotus.c0
    },
    frostBite: {
      id: "frostBite",
      name: TIER_DATA.frostBite.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.frostBite.yieldPerLevel,
      costMultiplier: TIER_DATA.frostBite.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.frostBite.c0
    },
    electricLace: {
      id: "electricLace",
      name: TIER_DATA.electricLace.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.electricLace.yieldPerLevel,
      costMultiplier: TIER_DATA.electricLace.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.electricLace.c0
    },
    meth: {
      id: "meth",
      name: TIER_DATA.meth.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.meth.yieldPerLevel,
      costMultiplier: TIER_DATA.meth.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.meth.c0
    },
    pharmGrade: {
      id: "pharmGrade",
      name: TIER_DATA.pharmGrade.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.pharmGrade.yieldPerLevel,
      costMultiplier: TIER_DATA.pharmGrade.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.pharmGrade.c0
    },
    khole: {
      id: "khole",
      name: TIER_DATA.khole.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.khole.yieldPerLevel,
      costMultiplier: TIER_DATA.khole.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.khole.c0
    },
    lunarRegolith: {
      id: "lunarRegolith",
      name: TIER_DATA.lunarRegolith.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.lunarRegolith.yieldPerLevel,
      costMultiplier: TIER_DATA.lunarRegolith.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.lunarRegolith.c0
    },
    martianSpores: {
      id: "martianSpores",
      name: TIER_DATA.martianSpores.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.martianSpores.yieldPerLevel,
      costMultiplier: TIER_DATA.martianSpores.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.martianSpores.c0
    },
    nebulaMist: {
      id: "nebulaMist",
      name: TIER_DATA.nebulaMist.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.nebulaMist.yieldPerLevel,
      costMultiplier: TIER_DATA.nebulaMist.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.nebulaMist.c0
    },
    voidCrystals: {
      id: "voidCrystals",
      name: TIER_DATA.voidCrystals.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.voidCrystals.yieldPerLevel,
      costMultiplier: TIER_DATA.voidCrystals.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.voidCrystals.c0
    },
    chronoSalt: {
      id: "chronoSalt",
      name: TIER_DATA.chronoSalt.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.chronoSalt.yieldPerLevel,
      costMultiplier: TIER_DATA.chronoSalt.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.chronoSalt.c0
    },
    stardustResin: {
      id: "stardustResin",
      name: TIER_DATA.stardustResin.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.stardustResin.yieldPerLevel,
      costMultiplier: TIER_DATA.stardustResin.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.stardustResin.c0
    },
    darkMatterInk: {
      id: "darkMatterInk",
      name: TIER_DATA.darkMatterInk.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.darkMatterInk.yieldPerLevel,
      costMultiplier: TIER_DATA.darkMatterInk.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.darkMatterInk.c0
    },
    singularityShards: {
      id: "singularityShards",
      name: TIER_DATA.singularityShards.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.singularityShards.yieldPerLevel,
      costMultiplier: TIER_DATA.singularityShards.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.singularityShards.c0
    },
    neutronFlakes: {
      id: "neutronFlakes",
      name: TIER_DATA.neutronFlakes.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.neutronFlakes.yieldPerLevel,
      costMultiplier: TIER_DATA.neutronFlakes.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.neutronFlakes.c0
    },
    galacticCore: {
      id: "galacticCore",
      name: TIER_DATA.galacticCore.name,
      stock: 0,
      rate: 0,
      yieldPerLevel: TIER_DATA.galacticCore.yieldPerLevel,
      costMultiplier: TIER_DATA.galacticCore.costMultiplier,
      level: 0,
      upgradeCost: TIER_DATA.galacticCore.c0
    }
  },
  unlockedProduction: ["weed"],
  activeDealers: [null, null, null],
  availableDealers: [],
  unlockedSlots: 1,
  lastRefreshTime: 0,
  lastEarningsPerDealer: {},
  lastTickAt: Date.now(),
};

// Star-based dealer stat ranges (rolled once at generation)
export const VOLUME_RANGES: Record<number, [number, number]> = {
  1: [1.0, 1.5],
  2: [1.5, 2.5],
  3: [2.5, 3.5],
  4: [3.5, 4.5],
  5: [4.5, 5.5],
};

export const MARGIN_RANGES: Record<number, [number, number]> = {
  1: [0.42, 0.50],
  2: [0.51, 0.78],
  3: [0.90, 1.10],
  4: [1.20, 1.40],
  5: [1.50, 1.70],
};

// Min values for upgrade calculations
export const VOLUME_BY_STARS: Record<number, number> = { 1: 1.0, 2: 1.5, 3: 2.5, 4: 3.5, 5: 4.5 };
export const MARGIN_BY_STARS: Record<number, number> = { 1: 0.42, 2: 0.51, 3: 0.90, 4: 1.20, 5: 1.50 };

// Upgrade type constants
export const UPGRADE_TYPES = {
  VOLUME: 'VOLUME',
  MARGIN: 'MARGIN',
  ALL_AROUNDER: 'ALL_AROUNDER',
  BULK: 'BULK',
  SIDE_HUSTLE: 'SIDE_HUSTLE',
} as const;

export const SLOT_UNLOCK_COSTS = [0, 1000, 100000]; // Slot 0 is free, 1 is $1k, 2 is $100k

export const DEALER_FIRST_NAMES = ['Thomas', 'Dutch', 'Belgian', 'Chemist', 'Slick', 'Vito', 'Snake', 'Mick', 'Jack', 'Dave', 'Miller', 'Bob', 'Ghost'];
export const DEALER_LAST_NAMES = ['Palmer', 'Dave', 'Bob', 'Carlos', 'Snake', 'Miller', 'The Fixer', 'The Ghost', 'Slick'];

export const DEALER_PROTECTION_INCOME_MULTIPLIER = 0.85;

export const ARREST_CHECK_INTERVAL_MS = {
  min: 300_000,
  max: 600_000,
} as const;

export const BAIL_BASE_FLOOR = 500;
export const BAIL_INCOME_MULTIPLIER = 45;

export const PRODUCT_ARREST_RISK: Record<string, { chance: number; label: 'LOW' | 'MEDIUM' | 'HIGH' }> = {
  weed: { chance: 0.10, label: 'LOW' },
  mushrooms: { chance: 0.12, label: 'LOW' },
  blueLotus: { chance: 0.15, label: 'MEDIUM' },
  frostBite: { chance: 0.17, label: 'MEDIUM' },
  electricLace: { chance: 0.20, label: 'MEDIUM' },
  meth: { chance: 0.25, label: 'HIGH' },
  pharmGrade: { chance: 0.28, label: 'HIGH' },
  khole: { chance: 0.30, label: 'HIGH' },
  lunarRegolith: { chance: 0.33, label: 'HIGH' },
  martianSpores: { chance: 0.36, label: 'HIGH' },
  nebulaMist: { chance: 0.40, label: 'HIGH' },
  voidCrystals: { chance: 0.45, label: 'HIGH' },
  chronoSalt: { chance: 0.50, label: 'HIGH' },
  stardustResin: { chance: 0.55, label: 'HIGH' },
  darkMatterInk: { chance: 0.60, label: 'HIGH' },
  singularityShards: { chance: 0.65, label: 'HIGH' },
  neutronFlakes: { chance: 0.70, label: 'HIGH' },
  galacticCore: { chance: 0.75, label: 'HIGH' },
};
