# Neon-D Dealer Mechanics Fix Design
Date: 2026-05-05
Status: Approved

## Overview
Fix Neon-D's dealer mechanics to align with the verified DST (Dope Slinger Tycoon) economic model. Updates dealer star scaling, stat generation, side hustle logic, and upgrade naming while keeping the RNG upgrade choice system.

## Source of Truth
All dealer parameters sourced from `docs/investigations/Neon Dealer Mechanics Explained.md` (DST reverse-engineering).

## Design Sections

### 1. Dealer Star Scaling (Task 1)
Replace current star=raw-stat with DST-based RNG ranges in `useGameEngine.ts`. Values are rolled once at dealer generation and stored on the dealer object (fixed per dealer).

**Volume (max 5★) — RNG range per star:**
| Stars | g/s Range |
|-------|-----------|
| 1★ | 1.0 - 1.5 |
| 2★ | 2.5 - 3.5 |
| 3★ | 4.0 - 6.0 |
| 4★ | 8.0 - 10.0 |
| 5★ | 15.0 - 17.0 |

**Margin (max 6★ anomaly) — RNG range per star:**
| Stars | Multiplier Range |
|-------|-------------------|
| 1★ | 1.0x - 1.15x |
| 2★ | 1.5x - 1.7x |
| 3★ | 2.5x - 3.0x |
| 4★ | 4.0x - 6.0x |
| 5★ | 7.5x - 9.0x |
| 6★ | 15.0x - 18.0x |

Add helper functions: `rollVolumeGps(stars)` and `rollMarginMultiplier(stars)` that return a random value within the range. Store results as `dealer.baseVolumeGps` and `dealer.baseMarginMult` at generation time.

### 2. Dealer Stat Generation (Task 5)
Update `generateRandomDealer()` in `useGameEngine.ts`:

- **Volume**: `Math.min(5, Math.floor(Math.random() * 3) + 1 + Math.min(2, progressBonus))` — hard cap at 5★
- **Margin**: `Math.min(6, Math.floor(Math.random() * 3) + 1 + Math.min(3, progressBonus))` — allows 6★ anomaly
- 6★ margin base chance ~1%, scales with `progressBonus`

### 3. Side Hustle Fix (Task 3)
Replace per-product `sideHustle` map with single `sideVolume: number` field (default 0.10):

- Add `sideVolume: number` to `Dealer` interface in `types.ts`
- Remove `networkBonus: number` and `sideHustle: Record<string, number>` from `Dealer`
- In `tick()`: each dealer bleeds `dealer.volume * dealer.volumeBonus * dealer.sideVolume` of EVERY other commodity per second
- `SIDE_HUSTLE` upgrade type sets/adds to `dealer.sideVolume` instead of per-product mapping
- Remove `networkBonus` references throughout engine

### 4. Upgrade Renaming (RNG Kept)
Keep current bonus values and RNG choice, rename labels to DST-style:

| Type | Old Label | New Label | Bonus |
|------|-----------|-----------|-------|
| VOLUME | High Capacity | Armed Gang | +15% |
| MARGIN | Premium Cut | Ferrari | +15% |
| ALL_AROUNDER | Packaging Expert | Copter | +5% both |
| BULK | Bulk Specialist | The Crew | +35% vol / -10% mar |
| NETWORK | The Network | The Syndicate | +10% side |
| SIDE_HUSTLE | JACKPOT: Side Hustle | JACKPOT: Side Hustle | sets sideVolume |

### 5. Type Updates (`types.ts`)
```typescript
export interface Dealer {
  id: string;
  name: string;
  selling: string;
  volume: number;
  margin: number;
  volumeBonus: number;
  marginBonus: number;
  sideVolume: number;  // Replaces sideHustle map and networkBonus
  equipmentCount: number;
}

export interface DealerUpgrade {
  type: UpgradeType;
  label: string;
  description: string;
  value: number;
  marginPenalty?: number;
  sideVolumeValue?: number;  // Replaces targetProductId
}
```

### 6. Constants Updates (`constants.ts`)
- Remove `DEALER_STATS` (unused hardcoded stats)
- Add star lookup maps:
```typescript
export const VOLUME_BY_STARS: Record<number, number> = { 1: 1.0, 2: 2.5, 3: 4.0, 4: 8.0, 5: 15.0 };
export const MARGIN_BY_STARS: Record<number, number> = { 1: 1.0, 2: 1.5, 3: 2.5, 4: 4.0, 5: 7.5, 6: 15.0 };
```

### 7. Engine Updates (`useGameEngine.ts`)
- `generateRandomDealer()`: cap volume at 5★, allow margin up to 6★, initialize `sideVolume: 0.10`
- `tick()`: replace per-product side hustle loop with single `sideVolume` bleed across all other commodities
- `buyEquipment()`: update SIDE_HUSTLE to add to `dealer.sideVolume`, remove NETWORK/networkBonus logic
- Remove all `networkBonus` references

### 8. UI Updates (`NeonDGame.tsx`)
- Update upgrade popup labels to new DST-style names
- Show sideVolume percentage in dealer card instead of per-product side hustle list
- Update `getUpgradeName` if needed for new equipment names
- Keep earnings calculation logic (already works with volume/margin helpers)

## Implementation Approach
**Approach: Data-Driven Refactor**
- All dealer logic driven by lookup tables in constants.ts
- No hardcoded values in engine or UI
- Preserve RNG upgrade choice UX

## Verification
- Confirm 5★ volume dealer = 15.0 g/s throughput
- Confirm 6★ margin dealer = 15.0x multiplier (rare, ~1% base chance)
- Confirm sideVolume bleeds fixed % of volume to ALL other commodities each second
- Confirm upgrade labels show new DST-style names
- Confirm networkBonus removed, sideVolume used instead
