# Neon-D Dealer Mechanics Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix Neon-D's dealer mechanics to align with the verified DST (Dope Slinger Tycoon) economic model by updating star scaling, stat generation, side hustle logic, and upgrade naming.

**Architecture:** This is a data-driven refactor centered on lookup tables in constants.ts. The changes flow from type definitions → constants → engine logic → UI. All dealer stats (volume/margin per star) are rolled once at generation and stored on the dealer object. The RNG upgrade system is preserved but with DST-style labels and simplified side hustle logic (single `sideVolume` field instead of per-product mapping).

**Tech Stack:** React, TypeScript, Vite, existing game engine in `useGameEngine.ts`

---

## File Structure

**Files to modify:**
- `src/Brmble.Web/src/types.ts` — Add `sideVolume` to Dealer interface, remove `sideHustle` map and `networkBonus`
- `src/Brmble.Web/src/constants.ts` — Add star lookup maps for volume/margin ranges, remove `DEALER_STATS`
- `src/Brmble.Web/src/hooks/useGameEngine.ts` — Update dealer generation and tick logic
- `src/Brmble.Web/src/components/NeonDGame.tsx` — Update UI labels and sideVolume display

**No new files created.** All changes fit within existing architecture.

---

## Task 1: Update Type Definitions

**Files:**
- Modify: `src/Brmble.Web/src/types.ts`

- [x] **Step 1: Read the current Dealer interface**

Run: Open `src/Brmble.Web/src/types.ts` and locate the `Dealer` interface definition.

Expected output: Find the interface with fields like `id`, `name`, `selling`, `volume`, `margin`, `volumeBonus`, `marginBonus`, `equipmentCount`, `sideHustle`, `networkBonus`.

- [x] **Step 2: Replace sideHustle and networkBonus with sideVolume**

Replace the Dealer interface:

```typescript
export interface Dealer {
  id: string;
  name: string;
  selling: string;
  volume: number;  // Current effective volume (base × volumeBonus applied). Mutable during tick.
  margin: number;  // Current effective margin (base × marginBonus applied). Mutable during tick.
  volumeBonus: number;  // Accumulated bonus multiplier from upgrades (e.g., 0.15 for +15%)
  marginBonus: number;  // Accumulated bonus multiplier from upgrades
  sideVolume: number;  // Percentage of volume to bleed to other commodities (e.g., 0.10 for 10%)
  equipmentCount: number;
  baseVolumeGps: number;  // IMMUTABLE: rolled baseline volume (never changes after generation)
  baseMarginMult: number;  // IMMUTABLE: rolled baseline margin multiplier (never changes after generation)
}
```

**Design Intent:** `volume` and `margin` are the MUTABLE effective values used in tick calculations (base × bonus). `baseVolumeGps` and `baseMarginMult` are IMMUTABLE references preserved throughout the dealer's lifetime to ensure bonuses compound correctly and for prestige system reference.

- [x] **Step 3: Update DealerUpgrade interface**

Find the `DealerUpgrade` interface and update it:

```typescript
export interface DealerUpgrade {
  type: UpgradeType;
  label: string;
  description: string;
  value: number;
  marginPenalty?: number;
  sideVolumeValue?: number;  // Replaces targetProductId
}
```

- [x] **Step 4: Verify no other interfaces reference sideHustle or networkBonus**

Search the file for `sideHustle` and `networkBonus` references. If found in other interfaces, remove them.

- [x] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/types.ts
git commit -m "feat: update Dealer types - replace sideHustle/networkBonus with sideVolume"
```

---

## Task 2: Add Star Lookup Constants

**Files:**
- Modify: `src/Brmble.Web/src/constants.ts`

- [x] **Step 1: Read the current constants file**

Run: Open `src/Brmble.Web/src/constants.ts` and locate `DEALER_STATS` (to be removed) and any existing upgrade constants.

- [x] **Step 2: Remove DEALER_STATS if present**

If `DEALER_STATS` exists, delete it.

- [x] **Step 3: Add volume and margin star lookup maps**

Add these constants after any existing game constants:

```typescript
// Star-based dealer stat ranges (rolled once at generation)
export const VOLUME_RANGES: Record<number, [number, number]> = {
  1: [1.0, 1.5],
  2: [2.5, 3.5],
  3: [4.0, 6.0],
  4: [8.0, 10.0],
  5: [15.0, 17.0],
};

export const MARGIN_RANGES: Record<number, [number, number]> = {
  1: [1.0, 1.15],
  2: [1.5, 1.7],
  3: [2.5, 3.0],
  4: [4.0, 6.0],
  5: [7.5, 9.0],
  6: [15.0, 18.0],
};

// Min values for upgrade calculations
export const VOLUME_BY_STARS: Record<number, number> = { 1: 1.0, 2: 2.5, 3: 4.0, 4: 8.0, 5: 15.0 };
export const MARGIN_BY_STARS: Record<number, number> = { 1: 1.0, 2: 1.5, 3: 2.5, 4: 4.0, 5: 7.5, 6: 15.0 };

// Upgrade type constants
export const UPGRADE_TYPES = {
  VOLUME: 'VOLUME',
  MARGIN: 'MARGIN',
  ALL_AROUNDER: 'ALL_AROUNDER',
  BULK: 'BULK',
  NETWORK: 'NETWORK',
  SIDE_HUSTLE: 'SIDE_HUSTLE',
} as const;
```

- [x] **Step 4: Verify constants are exported**

Ensure all new constants have `export` keyword.

- [x] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/constants.ts
git commit -m "feat: add star-based dealer stat lookup tables and upgrade type constants"
```

---

## Task 3: Implement RNG Star Scaling Helpers

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useGameEngine.ts`

- [x] **Step 1: Add helper functions for RNG rolling**

Add these helper functions at the top of the game engine file (before or after imports, but before the main hook):

```typescript
// Roll a random value within a given range
function rollWithinRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Roll volume (g/s) for a given star rating
function rollVolumeGps(stars: number): number {
  const range = VOLUME_RANGES[Math.min(5, Math.max(1, stars))];
  if (!range) return 1.0;  // Fallback
  return rollWithinRange(range[0], range[1]);
}

// Roll margin multiplier for a given star rating
function rollMarginMultiplier(stars: number): number {
  const range = MARGIN_RANGES[Math.min(6, Math.max(1, stars))];
  if (!range) return 1.0;  // Fallback
  return rollWithinRange(range[0], range[1]);
}
```

Import the new constants at the top of the file:

```typescript
import { VOLUME_RANGES, MARGIN_RANGES, UPGRADE_TYPES } from '../constants';
```

- [x] **Step 2: Verify imports compile**

Run: `cd src/Brmble.Web && npm run build`

Expected: No TypeScript errors related to the new helper functions.

- [x] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/hooks/useGameEngine.ts
git commit -m "feat: add RNG helper functions for star-based stat rolling"
```

---

## Task 4: Update Dealer Generation Logic

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useGameEngine.ts`

- [x] **Step 1: Find the generateRandomDealer function**

Locate `generateRandomDealer()` in `useGameEngine.ts`.

- [x] **Step 2: Update volume star generation (cap at 5★)**

Replace the volume star calculation with:

```typescript
const volumeStars = Math.min(5, Math.floor(Math.random() * 3) + 1 + Math.min(2, progressBonus));
```

- [x] **Step 3: Update margin star generation (allow up to 6★)**

Replace the margin star calculation with:

```typescript
const marginStars = Math.min(6, Math.floor(Math.random() * 3) + 1 + Math.min(3, progressBonus));
```

- [x] **Step 4: Roll and store base volume and margin values**

After calculating stars, add:

```typescript
const baseVolumeGps = rollVolumeGps(volumeStars);
const baseMarginMult = rollMarginMultiplier(marginStars);
```

- [x] **Step 5: Initialize sideVolume to 0.10**

In the dealer object creation, add:

```typescript
sideVolume: 0.10,
baseVolumeGps,
baseMarginMult,
```

Remove any `sideHustle` map initialization and `networkBonus` field.

- [x] **Step 6: Initialize volume and margin with effective calculations**

Set the dealer's `volume` and `margin` fields by combining base values with initial bonuses (both start at 0 for new dealers):

```typescript
volume: baseVolumeGps * (1 + 0),  // Currently: base × 1.0 (no bonuses yet)
margin: baseMarginMult * (1 + 0), // Currently: base × 1.0 (no bonuses yet)
volumeBonus: 0,  // Starts at 0, incremented by upgrades
marginBonus: 0,  // Starts at 0, incremented by upgrades
```

**Note:** During tick calculations, `volume` will be recalculated as `baseVolumeGps * (1 + volumeBonus)` using the immutable base. This ensures bonuses compound correctly and survive prestige resets (when base is retained but bonuses reset).

- [x] **Step 7: Run build and verify no errors**

Run: `cd src/Brmble.Web && npm run build`

Expected: No TypeScript errors.

- [x] **Step 8: Commit**

```bash
git add src/Brmble.Web/src/hooks/useGameEngine.ts
git commit -m "feat: update dealer generation with star-based RNG rolling and sideVolume init"
```

---

## Task 5: Update Dealer Tick Logic (Side Hustle)

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useGameEngine.ts`

- [x] **Step 1: Find the tick function or dealer update logic**

Locate where dealers are updated each tick (likely in a `tick()` or `update()` function).

- [x] **Step 2: Replace per-product side hustle with unified sideVolume bleed**

Find the section that applies side hustle (likely a loop over `dealer.sideHustle` map). Replace it with:

```typescript
// Side hustle: Each dealer simultaneously liquidates other commodities as a secondary income phase.
// This is NOT subtracted from primary sales — it's a separate automatic parallel process.
if (dealer.sideVolume > 0) {
  const effectiveVolume = dealer.volume * (1 + dealer.volumeBonus);
  const bleedAmount = effectiveVolume * dealer.sideVolume;  // e.g., 10 g/s volume * 10% = 1 g/s to each other commodity
  
  for (const product of Object.keys(commodities)) {
    if (product !== dealer.selling) {
      // Each other commodity receives the bleed amount as passive secondary liquidation
      commodities[product] += bleedAmount;
    }
  }
}
```

**Design:** `sideVolume` is NOT a reduction of primary sales. It represents a **concurrent secondary liquidation phase** where the dealer simultaneously processes fractional percentages of unassigned inventory. Both the primary yield and secondary bleeds add to the total dealer revenue.

- [x] **Step 3: Remove networkBonus references**

Search for `networkBonus` in the tick logic and remove any references.

- [x] **Step 4: Verify logic is a separate phase (NOT subtractive)**

Ensure the bleed calculation:
- Uses `effectiveVolume = dealer.volume * (1 + dealer.volumeBonus)` to compute actual throughput with bonuses
- Multiplies by `dealer.sideVolume` (default 0.10 = 10%)
- **ADDS** that amount to each other commodity (does NOT subtract from primary)
- Is a secondary, parallel phase (happens alongside primary sales, not instead of them)

Result: Each tick, the dealer processes its primary product AND simultaneously bleeds 10% of its effective throughput into each other commodity.

- [x] **Step 5: Run build and verify no errors**

Run: `cd src/Brmble.Web && npm run build`

Expected: No TypeScript errors.

- [x] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/hooks/useGameEngine.ts
git commit -m "feat: replace per-product side hustle with unified sideVolume bleed"
```

---

## Task 6: Update Upgrade Application Logic

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useGameEngine.ts`

- [x] **Step 1: Find the buyEquipment or applyUpgrade function**

Locate where upgrades are applied to dealers (likely `buyEquipment()` or similar).

- [x] **Step 2: Update SIDE_HUSTLE upgrade handling**

Find the case for `SIDE_HUSTLE` and replace it:

```typescript
case 'SIDE_HUSTLE':
  dealer.sideVolume = (dealer.sideVolume || 0) + (upgrade.sideVolumeValue || 0.10);
  break;
```

(If `sideVolumeValue` is provided in the upgrade, use it; otherwise add 0.10.)

- [x] **Step 3: Remove NETWORK upgrade handling**

Find the case for `NETWORK` (if present) and delete it entirely. Remove any logic that sets `networkBonus`.

- [x] **Step 4: Rename NETWORK upgrade type to reference SIDE_HUSTLE or update label**

If NETWORK upgrades are meant to update side hustle, change their type to `SIDE_HUSTLE`.

- [x] **Step 5: Run build and verify no errors**

Run: `cd src/Brmble.Web && npm run build`

Expected: No TypeScript errors.

- [x] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/hooks/useGameEngine.ts
git commit -m "feat: update upgrade logic - SIDE_HUSTLE adds to sideVolume, remove NETWORK"
```

---

## Task 7: Update Upgrade Labels and Names

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useGameEngine.ts` (or wherever upgrades are defined)

- [x] **Step 1: Find where upgrade definitions/choices are created**

Locate the code that generates upgrade options (likely in `generateUpgradeChoices()` or similar).

- [x] **Step 2: Update upgrade labels to DST-style names**

Replace the upgrade labels with:

```typescript
const upgradeMap = {
  VOLUME: { label: 'Armed Gang', bonus: 0.15 },
  MARGIN: { label: 'Ferrari', bonus: 0.15 },
  ALL_AROUNDER: { label: 'Copter', bonus: 0.05 },
  BULK: { label: 'The Crew', volumeBonus: 0.35, marginPenalty: -0.10 },
  SIDE_HUSTLE: { label: 'JACKPOT: Side Hustle', sideVolumeValue: 0.10 },
};
```

- [x] **Step 3: Update any hardcoded upgrade descriptions**

Ensure descriptions match the new labels. Example:

```typescript
{
  type: 'VOLUME',
  label: 'Armed Gang',
  description: 'Increase volume by 15%',
  value: 0.15,
}
```

- [x] **Step 4: Run build and verify no errors**

Run: `cd src/Brmble.Web && npm run build`

Expected: No TypeScript errors.

- [x] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useGameEngine.ts
git commit -m "feat: rename upgrades to DST-style labels (Armed Gang, Ferrari, Copter, The Crew, JACKPOT)"
```

---

## Task 8: Update UI Display (NeonDGame.tsx)

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonDGame.tsx`

- [x] **Step 1: Find the dealer card rendering**

Locate where dealers are displayed (likely a map or list of dealer components).

- [x] **Step 2: Replace per-product side hustle display with sideVolume percentage**

Find any code that renders `dealer.sideHustle` as a map/list and replace it with:

```typescript
<div className="side-volume">
  Side Volume: {(dealer.sideVolume * 100).toFixed(1)}%
</div>
```

- [x] **Step 3: Update upgrade popup labels**

Find where upgrade options are displayed (popup/modal). Update the labels to use the new DST-style names:

```typescript
// Example: if displaying upgrades
{upgrade.label}  // This should now show 'Armed Gang', 'Ferrari', etc.
```

- [x] **Step 4: Verify earnings calculation still works**

Ensure the earnings calculation uses `volume` and `margin` fields correctly. No changes needed if it already uses these fields.

- [x] **Step 5: Verify Build (Agentic Safe)**

Run:
```bash
cd src/Brmble.Web && npm run build
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeds with no TypeScript errors, confirming all UI components compile with the new types and labels. Visual testing (launching dev server) is reserved for human review after this task completes.

- [x] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/NeonDGame.tsx
git commit -m "ui: update dealer card to show sideVolume percentage, update upgrade labels"
```

---

## Task 9: Verify and Test (Human Review)

**IMPORTANT:** This task is for manual human gameplay testing after agentic implementation completes. An AI agent should NOT execute Task 9. After Tasks 1-8 complete and build succeeds, pause and pass to a human for visual verification.

**Files:**
- Test: Manual gameplay testing

- [x] **Step 1: Start the game and generate a dealer**

Run the game and create a new dealer. Observe:
- Dealer has a 1★–5★ volume rating (capped at 5★)
- Dealer has a 1★–6★ margin rating (allowing 6★ anomaly)
- Dealer shows sideVolume as a percentage (default 10%)

- [x] **Step 2: Verify star-based volume output**

Check a 5★ volume dealer. Expected throughput near 15–17 g/s.

- [x] **Step 3: Verify star-based margin multiplier**

Check a 5★ margin dealer. Expected multiplier near 7.5–9.0x.
Check a 6★ margin dealer (rare). Expected multiplier near 15–18x.

- [x] **Step 4: Apply upgrades and verify new labels**

Buy equipment. Verify:
- "Armed Gang" appears for volume upgrades
- "Ferrari" appears for margin upgrades
- "Copter" appears for all-arounder upgrades
- "The Crew" appears for bulk upgrades
- "JACKPOT: Side Hustle" appears for side hustle upgrades

- [x] **Step 5: Verify side hustle bleed**

Enable side hustle on a dealer. Verify that other commodities increase each second.

- [x] **Step 6: Check for console errors**

Open browser console (F12) and verify no errors appear during gameplay.

- [x] **Step 7: Run full build**

```bash
cd src/Brmble.Web && npm run build
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: No errors, all tests pass (if tests exist).

- [x] **Step 8: Final commit (if only docs or minor fixes needed)**

```bash
git add .
git commit -m "test: verify neond dealer mechanics align with DST model"
```

---

## Summary of Changes

| Component | Change |
|-----------|--------|
| Types | Replace `sideHustle` map + `networkBonus` with single `sideVolume: number` |
| Constants | Add `VOLUME_RANGES`, `MARGIN_RANGES` lookup tables |
| Engine | Roll volume/margin per star at generation; store as `baseVolumeGps`/`baseMarginMult` |
| Tick logic | Replace per-product side hustle loop with unified `sideVolume` bleed |
| Upgrades | Update labels to DST-style (Armed Gang, Ferrari, Copter, The Crew, JACKPOT); remove NETWORK |
| UI | Show `sideVolume` as percentage; update upgrade popup labels |

---

## Verification Checklist

- [x] 5★ volume dealer produces ~15–17 g/s
- [x] 6★ margin dealer has ~15–18x multiplier (rare, ~1% base chance)
- [x] Side hustle bleeds correct percentage of volume to all other commodities each second
- [x] Upgrade labels show new DST-style names
- [x] `networkBonus` completely removed from codebase
- [x] `sideHustle` map completely removed from codebase
- [x] Build succeeds with no TypeScript errors
- [x] Game plays without console errors
