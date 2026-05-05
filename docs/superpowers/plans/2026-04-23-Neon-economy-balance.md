This revised plan addresses the structural and mathematical gaps identified in the first audit. To solve the "fixed increase" problem, we will move the **Yield per Level** into the data itself, removing hardcoded logic and ensuring every upgrade feels impactful regardless of the product's tier.

This revised **Economy 2.0 Master Plan** fixes the structural "fixed increase" problem by moving the **Yield per Level** directly into your data. It also standardizes all product keys to **camelCase** to ensure your game logic and UI lookups never fail.

Follow the steps below and copy-paste the code blocks into your respective files.

---

## 1. Updated `types.ts`
Add the `yieldPerLevel` property to the `ProductionItem` interface so the engine knows how much production to add during a level-up.

```typescript
export interface ProductionItem {
  id: string;
  name: string;
  stock: number;
  rate: number;
  yieldPerLevel: number; // The fixed amount added per level
  level: number;
  upgradeCost: number;
}

export type UpgradeType = 'VOLUME' | 'MARGIN' | 'SIDE_HUSTLE' | 'NETWORK' | 'ALL_AROUNDER' | 'BULK';

export interface DealerUpgrade {
  type: UpgradeType;
  label: string;
  description: string;
  value: number;
  targetProductId?: string;
  marginPenalty?: number;
}

export interface Dealer {
  id: string;
  name: string;
  selling: string;
  volume: number;
  margin: number;
  volumeBonus: number;
  marginBonus: number;
  sideHustle: Record<string, number>;
  networkBonus: number;
  equipmentCount: number;
}

export interface GameState {
  money: number;
  totalEarned: number;
  researchSpeed: number;
  production: Record<string, ProductionItem>;
  unlockedProduction: string[];
  activeDealers: (Dealer | null)[];
  availableDealers: Dealer[];
  unlockedSlots: number;
  lastRefreshTime: number;
}
```

---

## 2. Updated `constants.ts`
This file now uses the **camelCase** keys and the updated pricing, base rates, and yields from the Economy 2.0 table.

```typescript
import type { GameState } from './types';

export const INITIAL_GAME_STATE: GameState = {
  money: 250.00,
  totalEarned: 0,
  researchSpeed: 1.0,
  production: {
    weed: { id: 'weed', name: 'Weed', stock: 0, rate: 0.20, yieldPerLevel: 0.05, level: 0, upgradeCost: 15 },
    mushrooms: { id: 'mushrooms', name: 'Mushrooms', stock: 0, rate: 0.80, yieldPerLevel: 0.20, level: 0, upgradeCost: 100 },
    meth: { id: 'meth', name: 'Meth', stock: 0, rate: 0.30, yieldPerLevel: 0.08, level: 0, upgradeCost: 800 },
    blueLotus: { id: 'blueLotus', name: 'Blue Lotus', stock: 0, rate: 1.00, yieldPerLevel: 0.25, level: 0, upgradeCost: 3500 },
    frostBite: { id: 'frostBite', name: 'Frost-Bite', stock: 0, rate: 1.00, yieldPerLevel: 0.25, level: 0, upgradeCost: 18000 },
    electricLace: { id: 'electricLace', name: 'Electric Lace', stock: 0, rate: 4.00, yieldPerLevel: 1.00, level: 0, upgradeCost: 85000 },
    pharmGrade: { id: 'pharmGrade', name: 'Pharm-Grade', stock: 0, rate: 1.50, yieldPerLevel: 0.40, level: 0, upgradeCost: 450000 },
    kHole: { id: 'kHole', name: 'K-Hole', stock: 0, rate: 6.00, yieldPerLevel: 1.50, level: 0, upgradeCost: 1800000 },
    lunarRegolith: { id: 'lunarRegolith', name: 'Lunar Regolith', stock: 0, rate: 2.50, yieldPerLevel: 0.60, level: 0, upgradeCost: 8500000 },
    martianSpores: { id: 'martianSpores', name: 'Martian Spores', stock: 0, rate: 10.00, yieldPerLevel: 2.50, level: 0, upgradeCost: 40000000 },
    nebulaMist: { id: 'nebulaMist', name: 'Nebula Mist', stock: 0, rate: 4.50, yieldPerLevel: 1.10, level: 0, upgradeCost: 180000000 },
    voidCrystals: { id: 'voidCrystals', name: 'Void Crystals', stock: 0, rate: 5.00, yieldPerLevel: 1.25, level: 0, upgradeCost: 850000000 },
    chronoSalt: { id: 'chronoSalt', name: 'Chrono-Salt', stock: 0, rate: 20.00, yieldPerLevel: 5.00, level: 0, upgradeCost: 4500000000 },
    stardustResin: { id: 'stardustResin', name: 'Stardust Resin', stock: 0, rate: 6.00, yieldPerLevel: 1.50, level: 0, upgradeCost: 22000000000 },
    darkMatterInk: { id: 'darkMatterInk', name: 'Dark Matter Ink', stock: 0, rate: 25.00, yieldPerLevel: 6.25, level: 0, upgradeCost: 110000000000 },
    singularityShards: { id: 'singularityShards', name: 'Singularity Shards', stock: 0, rate: 12.00, yieldPerLevel: 3.00, level: 0, upgradeCost: 600000000000 },
    neutronFlakes: { id: 'neutronFlakes', name: 'Neutron Flakes', stock: 0, rate: 50.00, yieldPerLevel: 12.50, level: 0, upgradeCost: 3000000000000 },
    galacticCore: { id: 'galacticCore', name: 'Galactic Core', stock: 0, rate: 15.00, yieldPerLevel: 3.75, level: 0, upgradeCost: 18000000000000 }
  },
  unlockedProduction: [],
  activeDealers: [null, null, null],
  availableDealers: [],
  unlockedSlots: 1,
  lastRefreshTime: 0
};

export const PRODUCT_TIERS: Record<string, number> = {
  weed: 1.00,
  mushrooms: 0.75,
  meth: 6.00,
  blueLotus: 5.00,
  frostBite: 15.00,
  electricLace: 10.00,
  pharmGrade: 80.00,
  kHole: 60.00,
  lunarRegolith: 400.00,
  martianSpores: 300.00,
  nebulaMist: 2000.00,
  voidCrystals: 5000.00,
  chronoSalt: 3500.00,
  stardustResin: 35000.00,
  darkMatterInk: 25000.00,
  singularityShards: 150000.00,
  neutronFlakes: 100000.00,
  galacticCore: 1000000.00
};

export const UNLOCK_COSTS: Record<string, number> = {
  weed: 0,
  mushrooms: 150,
  meth: 1200,
  blueLotus: 5000,
  frostBite: 25000,
  electricLace: 120000,
  pharmGrade: 600000,
  kHole: 2500000,
  lunarRegolith: 12000000,
  martianSpores: 60000000,
  nebulaMist: 250000000,
  voidCrystals: 1200000000,
  chronoSalt: 6000000000,
  stardustResin: 30000000000,
  darkMatterInk: 150000000000,
  singularityShards: 800000000000,
  neutronFlakes: 4000000000000,
  galacticCore: 25000000000000
};

export const SLOT_UNLOCK_COSTS = [0, 1000, 100000];
export const DEALER_FIRST_NAMES = ['Thomas', 'Dutch', 'Belgian', 'Chemist', 'Slick', 'Vito', 'Snake', 'Mick', 'Jack'];
export const DEALER_LAST_NAMES = ['Palmer', 'Dave', 'Bob', 'Carlos', 'Snake', 'Miller', 'The Fixer', 'The Ghost'];
```

---

## 3. Updated `getUpgradeName` in `NeonDGame.tsx`
Update the helper function keys to match the new **camelCase** IDs.

```typescript
function getUpgradeName(id: string): string {
  const names: Record<string, string> = {
    weed: 'Grow Op',
    mushrooms: 'Mushroom Farm',
    meth: 'Meth Lab',
    blueLotus: 'Club Lab',
    frostBite: 'Cryo Lab',
    electricLace: 'Micro-Drip',
    pharmGrade: 'Factory',
    kHole: 'Ketamine Lab',
    lunarRegolith: 'Zero-G Lab',
    martianSpores: 'Mars Chamber',
    nebulaMist: 'Siphon',
    voidCrystals: 'Event Horizon',
    chronoSalt: 'Accelerator',
    stardustResin: 'Solar Extractor',
    darkMatterInk: 'Telepathy Lab',
    singularityShards: 'Void Rift',
    neutronFlakes: 'Particle Accel',
    galacticCore: 'Core Fusion',
  };
  return names[id] || 'Lab';
}
```

---

## 4. Updated `upgrade` Logic in `useGameEngine.ts`
Simplify your upgrade function by removing hardcoded increases and using the `yieldPerLevel` field you added to the data.

```typescript
const upgrade = (id: string) => {
  setState(prev => {
    const item = prev.production[id];
    if (!item || prev.money < item.upgradeCost) return prev;
    
    const rateIncrease = item.yieldPerLevel; // Uses the data-driven value
    const multiplier = 1.45; // Standard cost scaling
    
    return {
      ...prev,
      money: prev.money - item.upgradeCost,
      production: {
        ...prev.production,
        [id]: {
          ...item,
          level: item.level + 1,
          rate: item.rate + rateIncrease,
          upgradeCost: Math.floor(item.upgradeCost * multiplier)
        }
      }
    };
  });
};
```

## 4. Implementation Checklist
- [ ] **Global Rename:** Search and replace all instances of lowercase product keys with camelCase (e.g., `bluelotus` → `blueLotus`).
- [ ] **Constants Sync:** Update `INITIAL_GAME_STATE`, `PRODUCT_TIERS`, and `UNLOCK_COSTS` with the new numeric values.
- [ ] **Type Update:** Add `yieldPerLevel` to the `ProductionItem` interface in `types.ts`.
- [ ] **Logic Cleanup:** Remove the `rateIncreases` and `costMultipliers` switch/object from the `upgrade` function in `useGameEngine.ts`.
- [ ] **Verification:** Confirm that buying 1 level of **Pharm-Grade** increases the yield by exactly **0.40g/s**.