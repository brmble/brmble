# NeonD Price Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scale all 18 NeonD product sell prices so tier 1-5 match exact targets ($4.20, $6.00, $10.00, $15.00, $20.00) with geometric progression for tiers 6-18.

**Architecture:** Update `TIER_DATA` constants in `src/Brmble.Web/src/components/NeonD/constants.ts` with new sell prices. The `PRODUCT_TIERS` export is automatically derived from these values and used throughout the game engine.

**Tech Stack:** TypeScript, React (NeonD game component)

---

## New Sell Prices (All 18 Tiers)

```
Tier 1:  weed                 $4.20
Tier 2:  mushrooms            $6.00
Tier 3:  blueLotus            $10.00
Tier 4:  frostBite            $15.00
Tier 5:  electricLace         $20.00
Tier 6:  meth                 $26.67
Tier 7:  pharmGrade           $35.56
Tier 8:  khole                $47.41
Tier 9:  lunarRegolith        $63.21
Tier 10: martianSpores        $84.28
Tier 11: nebulaMist           $112.37
Tier 12: voidCrystals         $149.82
Tier 13: chronoSalt           $199.75
Tier 14: stardustResin        $266.32
Tier 15: darkMatterInk        $355.08
Tier 16: singularityShards    $473.42
Tier 17: neutronFlakes        $631.20
Tier 18: galacticCore         $841.56
```

---

## Files Modified

- `src/Brmble.Web/src/components/NeonD/constants.ts` - Update all `sellPrice` values in `TIER_DATA`

---

## Task 1: Update TIER_DATA Sell Prices

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/constants.ts` (lines 11, 19, 27, 35, 43, 51, 59, 67, 75, 83, 91, 99, 107, 115, 123, 131, 139, 147)

- [ ] **Step 1: Open constants.ts and locate TIER_DATA**

File: `src/Brmble.Web/src/components/NeonD/constants.ts` lines 4-149

- [ ] **Step 2: Update weed sellPrice**

Find line 11:
```typescript
sellPrice: 10
```

Replace with:
```typescript
sellPrice: 4.20
```

- [ ] **Step 3: Update mushrooms sellPrice**

Find line 19:
```typescript
sellPrice: 13
```

Replace with:
```typescript
sellPrice: 6.00
```

- [ ] **Step 4: Update blueLotus sellPrice**

Find line 27:
```typescript
sellPrice: 20
```

Replace with:
```typescript
sellPrice: 10.00
```

- [ ] **Step 5: Update frostBite sellPrice**

Find line 35:
```typescript
sellPrice: 30
```

Replace with:
```typescript
sellPrice: 15.00
```

- [ ] **Step 6: Update electricLace sellPrice**

Find line 43:
```typescript
sellPrice: 45
```

Replace with:
```typescript
sellPrice: 20.00
```

- [ ] **Step 7: Update meth sellPrice**

Find line 51:
```typescript
sellPrice: 67.50
```

Replace with:
```typescript
sellPrice: 26.67
```

- [ ] **Step 8: Update pharmGrade sellPrice**

Find line 59:
```typescript
sellPrice: 101.25
```

Replace with:
```typescript
sellPrice: 35.56
```

- [ ] **Step 9: Update khole sellPrice**

Find line 67:
```typescript
sellPrice: 152
```

Replace with:
```typescript
sellPrice: 47.41
```

- [ ] **Step 10: Update lunarRegolith sellPrice**

Find line 75:
```typescript
sellPrice: 228
```

Replace with:
```typescript
sellPrice: 63.21
```

- [ ] **Step 11: Update martianSpores sellPrice**

Find line 83:
```typescript
sellPrice: 342
```

Replace with:
```typescript
sellPrice: 84.28
```

- [ ] **Step 12: Update nebulaMist sellPrice**

Find line 91:
```typescript
sellPrice: 513
```

Replace with:
```typescript
sellPrice: 112.37
```

- [ ] **Step 13: Update voidCrystals sellPrice**

Find line 99:
```typescript
sellPrice: 770
```

Replace with:
```typescript
sellPrice: 149.82
```

- [ ] **Step 14: Update chronoSalt sellPrice**

Find line 107:
```typescript
sellPrice: 1155
```

Replace with:
```typescript
sellPrice: 199.75
```

- [ ] **Step 15: Update stardustResin sellPrice**

Find line 115:
```typescript
sellPrice: 1733
```

Replace with:
```typescript
sellPrice: 266.32
```

- [ ] **Step 16: Update darkMatterInk sellPrice**

Find line 123:
```typescript
sellPrice: 2600
```

Replace with:
```typescript
sellPrice: 355.08
```

- [ ] **Step 17: Update singularityShards sellPrice**

Find line 131:
```typescript
sellPrice: 3900
```

Replace with:
```typescript
sellPrice: 473.42
```

- [ ] **Step 18: Update neutronFlakes sellPrice**

Find line 139:
```typescript
sellPrice: 5850
```

Replace with:
```typescript
sellPrice: 631.20
```

- [ ] **Step 19: Update galacticCore sellPrice**

Find line 147:
```typescript
sellPrice: 8775
```

Replace with:
```typescript
sellPrice: 841.56
```

- [ ] **Step 20: Verify all changes and save**

Run: `git diff src/Brmble.Web/src/components/NeonD/constants.ts`

Expected: 18 changes to `sellPrice` values, one per tier

- [ ] **Step 21: Commit changes**

```bash
git add src/Brmble.Web/src/components/NeonD/constants.ts
git commit -m "feat: scale NeonD product prices to new targets (T1-T5: $4.20-$20.00)"
```

---

## Task 2: Verify Game Logic Still Works

- [ ] **Step 1: Build the frontend**

Run: `cd src/Brmble.Web && npm run build`

Expected: Build succeeds with no errors

- [ ] **Step 2: Run NeonD tests (if any exist)**

Run: `cd src/Brmble.Web && npm test -- NeonD`

Expected: All tests pass (or confirm no tests exist for NeonD)

- [ ] **Step 3: Start dev server and test manually**

Run in terminal 1: `cd src/Brmble.Web && npm run dev`

Expected: Vite dev server starts on `http://localhost:5173`

- [ ] **Step 4: Verify prices in game UI**

1. Open Brmble client or navigate to NeonD game in web
2. Check that weed shows $4.20 per gram in dealer earnings display
3. Check that mushrooms shows $6.00 per gram
4. Verify a 1-star dealer selling weed produces $1.76-$2.10/s revenue (0.42-0.50 × $4.20)
5. Verify a 3-star dealer selling mushrooms produces $5.40-$6.60/s revenue (0.90-1.10 × $6.00)

Expected: All prices display correctly

---

## Summary

This plan updates all 18 sell prices in a single constants file with geometric progression from your exact tier 1-5 targets. No game logic changes needed—revenue calculations use these constants automatically.
