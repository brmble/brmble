import type { GameState } from './types';

// Complete 18-tier pricing data from DST economic model
export const TIER_DATA = {
  weed: {
    name: "Weed",
    c0: 15,
    costMultiplier: 1.12,
    yieldPerLevel: 0.20,
    unlockCost: 0,
    sellPrice: 10
  },
  mushrooms: {
    name: "Mushrooms",
    c0: 150,
    costMultiplier: 1.15,
    yieldPerLevel: 0.30,
    unlockCost: 2000,
    sellPrice: 13
  },
  blueLotus: {
    name: "Blue Lotus",
    c0: 1500,
    costMultiplier: 1.18,
    yieldPerLevel: 0.45,
    unlockCost: 25000,
    sellPrice: 20
  },
  frostBite: {
    name: "Frostbite",
    c0: 15000,
    costMultiplier: 1.20,
    yieldPerLevel: 0.65,
    unlockCost: 250000,
    sellPrice: 30
  },
  electricLace: {
    name: "Electric Lace",
    c0: 150000,
    costMultiplier: 1.22,
    yieldPerLevel: 1.00,
    unlockCost: 2500000,
    sellPrice: 45
  },
  meth: {
    name: "Meth",
    c0: 1500000,
    costMultiplier: 1.25,
    yieldPerLevel: 1.50,
    unlockCost: 25000000,
    sellPrice: 67.50
  },
  pharmGrade: {
    name: "Pharm Grade",
    c0: 15000000,
    costMultiplier: 1.28,
    yieldPerLevel: 2.50,
    unlockCost: 250000000,
    sellPrice: 101.25
  },
  khole: {
    name: "K-Hole",
    c0: 150000000,
    costMultiplier: 1.31,
    yieldPerLevel: 3.75,
    unlockCost: 2500000000,
    sellPrice: 152
  },
  lunarRegolith: {
    name: "Lunar Regolith",
    c0: 1500000000,
    costMultiplier: 1.34,
    yieldPerLevel: 5.625,
    unlockCost: 25000000000,
    sellPrice: 228
  },
  martianSpores: {
    name: "Martian Spores",
    c0: 15000000000,
    costMultiplier: 1.37,
    yieldPerLevel: 8.4375,
    unlockCost: 250000000000,
    sellPrice: 342
  },
  nebulaMist: {
    name: "Nebula Mist",
    c0: 150000000000,
    costMultiplier: 1.40,
    yieldPerLevel: 12.65625,
    unlockCost: 2500000000000,
    sellPrice: 513
  },
  voidCrystals: {
    name: "Void Crystals",
    c0: 1500000000000,
    costMultiplier: 1.43,
    yieldPerLevel: 18.984375,
    unlockCost: 25000000000000,
    sellPrice: 770
  },
  chronoSalt: {
    name: "Chrono Salt",
    c0: 15000000000000,
    costMultiplier: 1.46,
    yieldPerLevel: 28.4765625,
    unlockCost: 250000000000000,
    sellPrice: 1155
  },
  stardustResin: {
    name: "Stardust Resin",
    c0: 150000000000000,
    costMultiplier: 1.49,
    yieldPerLevel: 42.71484375,
    unlockCost: 2500000000000000,
    sellPrice: 1733
  },
  darkMatterInk: {
    name: "Dark Matter Ink",
    c0: 1500000000000000,
    costMultiplier: 1.52,
    yieldPerLevel: 64.07226563,
    unlockCost: 25000000000000000,
    sellPrice: 2600
  },
  singularityShards: {
    name: "Singularity Shards",
    c0: 15000000000000000,
    costMultiplier: 1.55,
    yieldPerLevel: 96.10839844,
    unlockCost: 250000000000000000,
    sellPrice: 3900
  },
  neutronFlakes: {
    name: "Neutron Flakes",
    c0: 150000000000000000,
    costMultiplier: 1.58,
    yieldPerLevel: 144.1625977,
    unlockCost: 2500000000000000000,
    sellPrice: 5850
  },
  galacticCore: {
    name: "Galactic Core",
    c0: 1500000000000000000,
    costMultiplier: 1.61,
    yieldPerLevel: 216.2438965,
    unlockCost: 25000000000000000000,
    sellPrice: 8775
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
  unlockedProduction: [],
  activeDealers: [null, null, null],
  availableDealers: [],
  unlockedSlots: 1,
  lastRefreshTime: 0
};

export const DEALER_STATS = {
  thomas: { volume: 3, margin: 3 },
  dave: { volume: 4, margin: 2 },
  bob: { volume: 2, margin: 4 },
  carlos: { volume: 1, margin: 5 },
};

export const SLOT_UNLOCK_COSTS = [0, 1000, 100000]; // Slot 0 is free, 1 is $1k, 2 is $100k

export const DEALER_FIRST_NAMES = ['Thomas', 'Dutch', 'Belgian', 'Chemist', 'Slick', 'Vito', 'Snake', 'Mick', 'Jack'];
export const DEALER_LAST_NAMES = ['Palmer', 'Dave', 'Bob', 'Carlos', 'Snake', 'Miller', 'The Fixer', 'The Ghost'];