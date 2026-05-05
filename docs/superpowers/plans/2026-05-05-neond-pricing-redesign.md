# NeonD Pricing Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor NeonD's pricing system to align with the verified DST (Dope Slinger Tycoon) economic model, making all pricing data-driven via constants instead of hardcoded values.

**Architecture:** Replace hardcoded tier data with a centralized constants file containing all 18-tier parameters (base cost, multiplier, production rate, unlock costs, sell prices). Update type definitions to support dynamic multipliers and yields, then refactor the game engine to use these data-driven values. Finally, update UI components to reference the new camelCase IDs.

**Tech Stack:** TypeScript/React frontend, game state management in useGameEngine.ts, test suite using Jest/Vitest

---

## File Structure

**Files to create:**
- None (all changes are modifications to existing files)

**Files to modify:**
- `src/games/NeonD/types.ts` - Add `yieldPerLevel` and `costMultiplier` to ProductionItem interface
- `src/games/NeonD/constants.ts` - Reorder production items, add new properties, update tier parameters
- `src/games/NeonD/useGameEngine.ts` - Remove hardcoded objects, refactor upgrade logic
- `src/games/NeonD/NeonDGame.tsx` - Update getUpgradeName to use correct camelCase IDs
- `tests/games/NeonD/engine.test.ts` - Add tests verifying tier parameters and upgrade mechanics

---

## Task 1: Update Type Definitions

**Files:**
- Modify: `src/games/NeonD/types.ts`

- [ ] **Step 1: Read the current ProductionItem interface**

Run: `cat src/games/NeonD/types.ts` (or use your editor)

Look for the `ProductionItem` interface definition.

- [ ] **Step 2: Update ProductionItem interface to include new fields**

Find the existing interface:
```typescript
export interface ProductionItem {
  id: string;
  name: string;
  stock: number;
  rate: number;
  level: number;
  upgradeCost: number;
}
```

Replace it with:
```typescript
export interface ProductionItem {
  id: string;
  name: string;
  stock: number;
  rate: number;
  yieldPerLevel: number;
  costMultiplier: number;
  level: number;
  upgradeCost: number;
}
```

- [ ] **Step 3: Verify no other files import and rely on the old interface shape**

Run: `grep -r "ProductionItem" src/` to find all usages

Check each file to ensure they will accept the new fields. Note: New fields don't break existing code since they're additive.

- [ ] **Step 4: Commit**

```bash
git add src/games/NeonD/types.ts
git commit -m "types: add yieldPerLevel and costMultiplier to ProductionItem"
```

---

## Task 2: Create Tier Constants with All 18 Products

**Files:**
- Modify: `src/games/NeonD/constants.ts`

- [ ] **Step 1: Read the current constants file**

Review the current structure, particularly:
- `INITIAL_GAME_STATE.production` (the production items)
- `PRODUCT_TIERS` (sell prices)
- `UNLOCK_COSTS` (unlock prices)

- [ ] **Step 2: Add a new TIER_DATA constant with all 18-tier parameters**

Add this new constant before INITIAL_GAME_STATE:

```typescript
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
```

- [ ] **Step 3: Update INITIAL_GAME_STATE.production to use TIER_DATA**

Find the production array in INITIAL_GAME_STATE and replace it to maintain unlock order (weed through galacticcore):

```typescript
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
}
```

- [ ] **Step 4: Update PRODUCT_TIERS with sell prices from TIER_DATA**

Replace the existing PRODUCT_TIERS constant:

```typescript
export const PRODUCT_TIERS = {
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
  galacticCore: TIER_DATA.galacticCore.sellPrice
} as const;
```

- [ ] **Step 5: Update UNLOCK_COSTS with unlock costs from TIER_DATA**

Replace the existing UNLOCK_COSTS constant:

```typescript
export const UNLOCK_COSTS = {
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
  galacticCore: TIER_DATA.galacticCore.unlockCost
} as const;
```

- [ ] **Step 6: Verify the file still exports INITIAL_GAME_STATE**

Check that INITIAL_GAME_STATE is exported at the end of the file (it should be).

- [ ] **Step 7: Commit**

```bash
git add src/games/NeonD/constants.ts
git commit -m "constants: add 18-tier TIER_DATA with DST pricing model, update production items and tier constants"
```

---

## Task 3: Refactor Game Engine to Use Data-Driven Values

**Files:**
- Modify: `src/games/NeonD/useGameEngine.ts`

- [ ] **Step 1: Read the current useGameEngine.ts file**

Look for:
- Any hardcoded `rateIncreases` object
- Any hardcoded `costMultipliers` object
- The `upgrade` function implementation

- [ ] **Step 2: Remove hardcoded rateIncreases and costMultipliers objects**

If the file contains these lines (or similar):
```typescript
const rateIncreases = {
  weed: 0.20,
  mushrooms: 0.30,
  // ... etc
};

const costMultipliers = {
  weed: 1.12,
  mushrooms: 1.15,
  // ... etc
};
```

Delete both objects entirely.

- [ ] **Step 3: Update the upgrade function to use item.yieldPerLevel and item.costMultiplier**

Find the upgrade function and replace it with:

```typescript
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
```

Note: This function now reads `yieldPerLevel` and `costMultiplier` from the item itself (populated from constants), making no assumptions about tier-specific values.

- [ ] **Step 4: Verify the unlock function doesn't hardcode unlock costs**

Find the unlock function. If it references a hardcoded object or array, update it to use UNLOCK_COSTS from constants:

```typescript
import { UNLOCK_COSTS } from './constants';

const unlock = (id: string) => {
  setState(prev => {
    if (prev.unlockedProduction.includes(id)) return prev;
    const unlockCost = UNLOCK_COSTS[id as keyof typeof UNLOCK_COSTS] || 0;
    if (prev.money < unlockCost) return prev;
    
    return {
      ...prev,
      money: prev.money - unlockCost,
      unlockedProduction: [...prev.unlockedProduction, id]
    };
  });
};
```

- [ ] **Step 5: Verify the sell function uses PRODUCT_TIERS from constants**

Find the sell function. It should use PRODUCT_TIERS for price lookup:

```typescript
import { PRODUCT_TIERS } from './constants';

const sell = (id: string, amount: number) => {
  setState(prev => {
    const item = prev.production[id];
    if (!item) return prev;
    const sellPrice = PRODUCT_TIERS[id as keyof typeof PRODUCT_TIERS] || 0;
    const revenue = amount * sellPrice;
    
    return {
      ...prev,
      money: prev.money + revenue,
      production: {
        ...prev.production,
        [id]: {
          ...item,
          stock: Math.max(0, item.stock - amount)
        }
      }
    };
  });
};
```

- [ ] **Step 6: Commit**

```bash
git add src/games/NeonD/useGameEngine.ts
git commit -m "refactor: remove hardcoded tier data, use data-driven values from item properties"
```

---

## Task 4: Update UI Component ID References

**Files:**
- Modify: `src/games/NeonD/NeonDGame.tsx`

- [ ] **Step 1: Read the NeonDGame.tsx file**

Look for the `getUpgradeName` function or any place where product IDs are converted to display names.

- [ ] **Step 2: Find all hardcoded product ID mappings**

Search for patterns like:
```typescript
case 'bluelotus':
case 'frostbite':
// etc
```

These need to be updated to camelCase to match the constants: `blueLotus`, `frostBite`, etc.

- [ ] **Step 3: Update getUpgradeName function to use camelCase IDs**

Replace the function with this corrected version:

```typescript
const getUpgradeName = (id: string): string => {
  const nameMap: Record<string, string> = {
    weed: "Weed",
    mushrooms: "Mushrooms",
    blueLotus: "Blue Lotus",
    frostBite: "Frostbite",
    electricLace: "Electric Lace",
    meth: "Meth",
    pharmGrade: "Pharm Grade",
    khole: "K-Hole",
    lunarRegolith: "Lunar Regolith",
    martianSpores: "Martian Spores",
    nebulaMist: "Nebula Mist",
    voidCrystals: "Void Crystals",
    chronoSalt: "Chrono Salt",
    stardustResin: "Stardust Resin",
    darkMatterInk: "Dark Matter Ink",
    singularityShards: "Singularity Shards",
    neutronFlakes: "Neutron Flakes",
    galacticCore: "Galactic Core"
  };
  return nameMap[id] || id;
};
```

- [ ] **Step 4: Update all references to product IDs in the component**

Search for any hardcoded string literals like "bluelotus" and replace with their camelCase equivalents:
- `"bluelotus"` → `"blueLotus"`
- `"frostbite"` → `"frostBite"`
- `"electriclace"` → `"electricLace"`
- `"pharmgrade"` → `"pharmGrade"`
- `"khole"` → `"khole"` (already correct)
- `"lunarregolith"` → `"lunarRegolith"`
- `"martianspores"` → `"martianSpores"`
- `"nebulamist"` → `"nebulaMist"`
- `"voidcrystals"` → `"voidCrystals"`
- `"chronosalt"` → `"chronoSalt"`
- `"stardustresin"` → `"stardustResin"`
- `"darkmatterink"` → `"darkMatterInk"`
- `"singularityshards"` → `"singularityShards"`
- `"neutronflakes"` → `"neutronFlakes"`
- `"galacticcore"` → `"galacticCore"`

- [ ] **Step 5: Commit**

```bash
git add src/games/NeonD/NeonDGame.tsx
git commit -m "ui: update product IDs to camelCase for consistency with constants"
```

---

## Task 5: Write Unit Tests for Tier Parameters and Upgrade Mechanics

**Files:**
- Create/Modify: `tests/games/NeonD/engine.test.ts`

- [ ] **Step 1: Create the test file if it doesn't exist**

If the file doesn't exist, create it at `tests/games/NeonD/engine.test.ts`.

- [ ] **Step 2: Import necessary modules**

Add these imports to the top of the test file:

```typescript
import { INITIAL_GAME_STATE, TIER_DATA, PRODUCT_TIERS, UNLOCK_COSTS } from '../../../src/games/NeonD/constants';
import { describe, it, expect } from 'vitest'; // or 'jest' if using Jest
```

- [ ] **Step 3: Write test for Weed tier parameters**

```typescript
describe('NeonD Tier Parameters', () => {
  it('Weed (Tier 1) has correct initial cost', () => {
    const weedItem = INITIAL_GAME_STATE.production.weed;
    expect(weedItem.upgradeCost).toBe(15);
  });

  it('Weed has correct yieldPerLevel', () => {
    const weedItem = INITIAL_GAME_STATE.production.weed;
    expect(weedItem.yieldPerLevel).toBe(0.20);
  });

  it('Weed has correct costMultiplier', () => {
    const weedItem = INITIAL_GAME_STATE.production.weed;
    expect(weedItem.costMultiplier).toBe(1.12);
  });

  it('Weed has correct unlock cost', () => {
    expect(UNLOCK_COSTS.weed).toBe(0);
  });

  it('Weed has correct sell price', () => {
    expect(PRODUCT_TIERS.weed).toBe(10);
  });
});
```

- [ ] **Step 4: Write test for Mushrooms tier parameters**

```typescript
describe('NeonD Tier Parameters', () => {
  it('Mushrooms (Tier 2) has correct initial cost', () => {
    const mushroomsItem = INITIAL_GAME_STATE.production.mushrooms;
    expect(mushroomsItem.upgradeCost).toBe(150);
  });

  it('Mushrooms has correct yieldPerLevel', () => {
    const mushroomsItem = INITIAL_GAME_STATE.production.mushrooms;
    expect(mushroomsItem.yieldPerLevel).toBe(0.30);
  });

  it('Mushrooms has correct costMultiplier', () => {
    const mushroomsItem = INITIAL_GAME_STATE.production.mushrooms;
    expect(mushroomsItem.costMultiplier).toBe(1.15);
  });

  it('Mushrooms has correct unlock cost', () => {
    expect(UNLOCK_COSTS.mushrooms).toBe(2000);
  });

  it('Mushrooms has correct sell price', () => {
    expect(PRODUCT_TIERS.mushrooms).toBe(13);
  });
});
```

- [ ] **Step 5: Write test for Galactic Core (Tier 18) tier parameters**

```typescript
describe('NeonD Tier Parameters', () => {
  it('Galactic Core (Tier 18) has correct initial cost', () => {
    const galacticCoreItem = INITIAL_GAME_STATE.production.galacticCore;
    expect(galacticCoreItem.upgradeCost).toBe(1500000000000000000);
  });

  it('Galactic Core has correct yieldPerLevel', () => {
    const galacticCoreItem = INITIAL_GAME_STATE.production.galacticCore;
    expect(galacticCoreItem.yieldPerLevel).toBe(216.2438965);
  });

  it('Galactic Core has correct costMultiplier', () => {
    const galacticCoreItem = INITIAL_GAME_STATE.production.galacticCore;
    expect(galacticCoreItem.costMultiplier).toBe(1.61);
  });

  it('Galactic Core has correct unlock cost', () => {
    expect(UNLOCK_COSTS.galacticCore).toBe(25000000000000000000);
  });

  it('Galactic Core has correct sell price', () => {
    expect(PRODUCT_TIERS.galacticCore).toBe(8775);
  });
});
```

- [ ] **Step 6: Write test for upgrade cost calculation**

```typescript
describe('Upgrade Mechanics', () => {
  it('upgrade calculates next cost using costMultiplier', () => {
    const weedItem = INITIAL_GAME_STATE.production.weed;
    const initialCost = weedItem.upgradeCost;
    const nextCost = Math.floor(initialCost * weedItem.costMultiplier);
    expect(nextCost).toBe(Math.floor(15 * 1.12)); // 16
  });

  it('upgrade calculates rate increase using yieldPerLevel', () => {
    const weedItem = INITIAL_GAME_STATE.production.weed;
    const rateIncrease = weedItem.yieldPerLevel;
    expect(rateIncrease).toBe(0.20);
  });
});
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- tests/games/NeonD/engine.test.ts` (or equivalent for your test runner)

Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add tests/games/NeonD/engine.test.ts
git commit -m "test: add unit tests for NeonD tier parameters and upgrade mechanics"
```

---

## Task 6: Verification and Full Integration Test

**Files:**
- Test/Verify: All modified files work together

- [ ] **Step 1: Run all tests**

Run: `npm test` (or equivalent full test command)

Expected: All tests PASS, including new tier parameter tests

- [ ] **Step 2: Build the frontend**

Run: `cd src/Brmble.Web && npm run build`

Expected: Build completes with no errors

- [ ] **Step 3: Start the dev server**

Run: `cd src/Brmble.Web && npm run dev` (in one terminal)

- [ ] **Step 4: Start the client**

In another terminal, run: `dotnet run --project src/Brmble.Client`

Expected: Client starts and connects to dev server

- [ ] **Step 5: Manually verify gameplay**

1. Open the NeonD game
2. Verify initial Weed item shows cost of $15
3. Click upgrade on Weed, verify:
   - Cost deducted from money: $15
   - Level increases by 1
   - Rate increases by 0.20 g/s
   - Next upgrade cost is $16 (Math.floor(15 * 1.12))
4. Unlock Mushrooms, verify:
   - Cost deducted is $2,000
   - Item is now unlocked
   - Initial cost is $150
5. Upgrade Mushrooms, verify:
   - Cost deducted: $150
   - Rate increases by 0.30 g/s
   - Next cost is $172 (Math.floor(150 * 1.15))
6. Sell product, verify sell prices match TIER_DATA

- [ ] **Step 6: Verify all 18 products exist and display correctly**

In NeonD game UI:
1. Scroll through all products
2. Verify names match TIER_DATA
3. Spot-check 2-3 mid-tier items (e.g., Electric Lace, Nebula Mist) for correct costs
4. Verify Galactic Core exists and shows correct tier 18 values

- [ ] **Step 7: Create a final verification commit**

```bash
git add -A
git commit -m "feat: complete NeonD pricing redesign with 18-tier DST economic model

- Replace hardcoded tier data with data-driven TIER_DATA constant
- Update ProductionItem type to include yieldPerLevel and costMultiplier
- Refactor game engine upgrade logic to use item properties
- Update UI components to use camelCase product IDs
- Add comprehensive unit tests for tier parameters and mechanics
- Verify all 18 products with correct DST pricing"
```

---

## Verification Checklist

Before considering this task complete, verify:

- [ ] All 18 product IDs use camelCase in constants and match UI
- [ ] TIER_DATA constant contains all 18 tiers with correct pricing
- [ ] PRODUCT_TIERS and UNLOCK_COSTS reference TIER_DATA values
- [ ] ProductionItem interface includes yieldPerLevel and costMultiplier
- [ ] upgrade function uses item.yieldPerLevel and item.costMultiplier (not hardcoded)
- [ ] Unit tests pass for Weed, Mushrooms, and Galactic Core parameters
- [ ] Upgrade cost calculations match spec (C0 * M)
- [ ] Sell prices match TIER_DATA
- [ ] All 18 products render in UI without errors
- [ ] No hardcoded rateIncreases or costMultipliers objects remain in codebase

---

## Spec Coverage Summary

| Spec Section | Task(s) | Status |
|--------------|---------|--------|
| Type Updates | Task 1 | ✓ |
| Constants Updates | Task 2 | ✓ |
| Engine Updates | Task 3 | ✓ |
| UI Updates | Task 4 | ✓ |
| Verification | Task 5, 6 | ✓ |

All spec requirements are covered by implementation tasks.
