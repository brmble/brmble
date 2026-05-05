# NeonD Pricing Redesign Spec
Date: 2026-05-05
Status: Approved

## Overview
Fix NeonD's incorrect product pricing by aligning with the verified economic model from *Dope Slinger Tycoon* (DST), documented in `docs/investigations/Economic Architecture and Systemic Scaling.md`.

## Source of Truth
All pricing parameters are sourced from the MD file `docs/investigations/Economic Architecture and Systemic Scaling.md`, which contains the correct DST economic model.

## Tier Mapping
NeonD's 18 products map to DST's 7 tiers (in order) plus 11 extended tiers:
| NeonD Product | DST Tier | DST Equivalent |
|---------------|-----------|----------------|
| weed | 1 | Weed |
| mushrooms | 2 | Mushrooms |
| bluelotus | 3 | Acid (LSD) |
| frostbite | 4 | MDMA |
| electriclace | 5 | Cocaine |
| meth | 6 | Meth/Speed |
| pharmgrade | 7 | Heroin |
| khole | 8 | Extended |
| lunarregolith | 9 | Extended |
| martianspores | 10 | Extended |
| nebulamist | 11 | Extended |
| voidcrystals | 12 | Extended |
| chronosalt | 13 | Extended |
| stardustresin | 14 | Extended |
| darkmatterink | 15 | Extended |
| singularityshards | 16 | Extended |
| neutronflakes | 17 | Extended |
| galacticcore | 18 | Extended |

## Confirmed Tier Parameters
Full 18-tier parameters (C0 = base cost, M = cost multiplier, Rate = per unit, Unlock = research cost, Sell = per gram):

| Tier | NeonD Product | C0 | M | Rate/Unit (g/s) | Unlock Cost | Sell Price/Gram |
|------|----------------|----|---|------------|--------------|-----------------|
| 1 | weed | $15 | 1.12 | 0.20 | $0 | $10 |
| 2 | mushrooms | $150 | 1.15 | 0.30 | $2,000 | $13 |
| 3 | bluelotus | $1,500 | 1.18 | 0.45 | $25,000 | $20 |
| 4 | frostbite | $15,000 | 1.20 | 0.65 | $250,000 | $30 |
| 5 | electriclace | $150,000 | 1.22 | 1.00 | $2.5M | $45 |
| 6 | meth | $1.5M | 1.25 | 1.50 | $25M | $67.50 |
| 7 | pharmgrade | $15M | 1.28 | 2.50 | $250M | $101.25 |
| 8 | khole | $150M | 1.31 | 3.75 | $2.5B | $152 |
| 9 | lunarregolith | $1.5B | 1.34 | 5.625 | $25B | $228 |
| 10 | martianspores | $15B | 1.37 | 8.4375 | $250B | $342 |
| 11 | nebulamist | $150B | 1.40 | 12.65625 | $2.5T | $513 |
| 12 | voidcrystals | $1.5T | 1.43 | 18.984375 | $25T | $770 |
| 13 | chronosalt | $15T | 1.46 | 28.4765625 | $250T | $1155 |
| 14 | stardustresin | $150T | 1.49 | 42.71484375 | $2.5Q | $1733 |
| 15 | darkmatterink | $1.5Q | 1.52 | 64.07226563 | $25Q | $2600 |
| 16 | singularityshards | $15Q | 1.55 | 96.10839844 | $250Q | $3900 |
| 17 | neutronflakes | $150Q | 1.58 | 144.1625977 | $2.5S | $5850 |
| 18 | galacticcore | $1.5S | 1.61 | 216.2438965 | $25S | $8775 |

## Scaling Rules
For Tiers 1-7: Use DST's exact values from source MD.
For Tiers 8-18 (Extended): Apply DST inter-tier scaling:
- C0 = 10 × previous tier's C0
- M = previous tier's M + 0.03
- Rate = 1.5 × previous tier's rate
- Unlock Cost = 10 × previous tier's Unlock Cost
- Sell Price = 1.5 × previous tier's Sell Price

## Design Sections
### 1. Type Updates (types.ts)
Add `yieldPerLevel` and `costMultiplier` to `ProductionItem`:
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

### 2. Constants Updates (constants.ts)
- Reorder `INITIAL_GAME_STATE.production` to match unlock order (weed → mushrooms → bluelotus → ... → galacticcore)
- Add `yieldPerLevel` and `costMultiplier` to each production item
- Set `upgradeCost = C0` (first unit cost), `rate = 0` initially
- Update `PRODUCT_TIERS` to confirmed sell prices
- Update `UNLOCK_COSTS` to confirmed unlock costs

### 3. Engine Updates (useGameEngine.ts)
- Remove hardcoded `rateIncreases` and `costMultipliers` objects
- Update `upgrade` function to use `item.yieldPerLevel` and `item.costMultiplier`

Updated `upgrade` function:
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

### 4. UI Updates (NeonDGame.tsx)
- Update `getUpgradeName` to use camelCase IDs matching constants.ts (e.g., bluelotus → blueLotus, frostbite → frostBite, etc.)

## Implementation Approach
Approach 1: Full Data-Driven Refactor (Approved)
- All logic driven by data in constants.ts, no hardcoded values in engine

## Verification
- Confirm Weed first upgrade cost is $15, rate increases by 0.20g/s
- Confirm Mushrooms first upgrade cost is $150, rate increases by 0.30g/s
- Confirm unlock costs match confirmed values
- Confirm sell prices match confirmed values
