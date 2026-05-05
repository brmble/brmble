# Neon Game Economy Investigation Report

**Date:** May 5, 2026  
**Based on:** Dope Slinger Tycoon Economy Analysis & Current Brmble Neon Implementation

---

## Executive Summary

After analyzing the "Dope Slinger Tycoon Economy Breakdown" document and comparing it with our current Brmble Neon game implementation, several critical economic imbalances have been identified. The current implementation has products starting with **zero production rate**, arbitrary cost multipliers, and lacks the meta-currency systems that make idle games sustainable at scale.

**Key Finding:** The game "does not make sense with how expensive Products are" because we have high costs without corresponding production capacity or economic relief mechanisms.

---

## 1. Current State Analysis

### 1.1 Critical Issues Identified

| Issue | Current Implementation | Impact |
|-------|----------------------|--------|
| **Zero Initial Production** | All products start with `rate: 0` | Players must upgrade before seeing any production |
| **Inconsistent Cost Multipliers** | 1.35 (weed), 1.45 (mushrooms), 1.6 (meth), 1.8 (others) | Arbitrary scaling creates unpredictable progression |
| **No Meta-Currency** | Missing Respect/deflationary system | No relief from exponential cost scaling |
| **Astronomical Unlock Costs** | galacticcore: 25 trillion | Unreachable without massive grinding |
| **yieldPerLevel Too Low** | Ranges from 0.05 to 12.50 | Upgrades feel insignificant vs. cost |

### 1.2 Current Constants Analysis

From `constants.ts`:
- **Initial Rates**: All products start at `rate: 0` (no production until first upgrade)
- **Yield Per Level**: 
  - weed: 0.05g/s per level
  - galacticcore: 3.75g/s per level
- **Upgrade Costs**: Scale from $15 (weed) to $18 trillion (galacticcore)
- **Product Tiers (Selling Prices)**:
  - weed: $1.0/g → galacticcore: $1500/g

### 1.3 The Math Problem

Using the geometric sequence formula: `C(n) = C₀ × Mⁿ`

For **Weed** (multiplier 1.35):
- Level 10 cost: $15 × 1.35¹⁰ ≈ $301
- Level 20 cost: $15 × 1.35²⁰ ≈ $6,044
- Level 50 cost: $15 × 1.35⁵⁰ ≈ $97,680,000

For **Galactic Core** (multiplier 1.8):
- Level 1 cost: $18,000,000,000,000
- Level 2 cost: $32,400,000,000,000

**Problem:** The production increase doesn't match the cost curve. Weed yields only +0.05g/s per level, requiring 20 levels just to reach 1g/s.

---

## 2. Dope Slinger Tycoon Reference Model

### 2.1 Key Economic Mechanics

The document reveals a sophisticated dual-currency system:

#### **Primary Currency: Cash**
- Generated through dealer distribution
- Used for production assets and unlocks
- Visualized as `cashPerSecond`

#### **Meta-Currency: Respect**
- Generated passively by "Muscle" personnel
- Provides **deflationary pressure** via `discountMulti()` function
- Can reduce all asset prices by up to 30%
- **Critical insight:** Respect shifts the entire exponential curve backward

#### **Production-Distribution Decoupling**
- Production creates **inventory** (illiquid)
- Dealers convert inventory to **cash** (liquid)
- Creates a queuing problem: balance production rate vs. distribution bandwidth

### 2.2 Mathematical Scaling Model

| Tier | Product | Base Cost | Multiplier | Production Rate | Unlock Cost |
|------|---------|-----------|-------------|-----------------|--------------|
| 1 | Weed | $20 | 1.07 | +0.20g/s | Free |
| 2 | Mushrooms | $500 | 1.09 | +0.30g/s | $1,000 |
| 3 | Acid | $5,000 | ~1.12 | Higher | $10,000 |
| ... | ... | ... | ... | ... | ... |
| 7 | Heroin | $700M | ~1.43 | Highest | $500M |

**Key Difference:** DST has **gentler multipliers** (1.07-1.43) vs. our aggressive 1.35-1.8 range.

### 2.3 Respect Discount Impact

With 30% Respect discount:
- Unit 50 cost without discount: $97,680,000
- Unit 50 cost WITH discount: $68,376,000
- **Savings: $29,304,000 on a single purchase**

This is the economic relief valve that our game is missing.

---

## 3. Problems with Current Implementation

### 3.1 The "Expensive Products" Problem

The user's complaint: *"the game we have made so far does not make sense with how expensive Products are"*

**Root Causes:**

1. **Zero Initial Production**: Players invest $15-25T and get **0g/s** until they upgrade
2. **No Respect System**: No way to reduce costs as they scale exponentially
3. **Arbitrary Multipliers**: 1.35/1.45/1.6/1.8 don't follow a logical progression
4. **yieldPerLevel Too Low**: +0.05g/s for weed means 20 upgrades to reach 1g/s
5. **Missing Bulk Liquidation**: No "Silk Road" mechanic for late-game

### 3.2 Dealer-Side Issues

Current implementation:
- Dealers have volume (stars) and margin (stars)
- Equipment upgrades available (3 slots)
- Side hustle system for selling multiple products

**Missing from DST model:**
- No "Muscle" personnel for Respect generation
- No "Kingpin" prestige system
- No "Silk Road" bulk liquidation (kg-based sales)

---

## 4. Recommendations

### 4.1 Immediate Fixes (Critical)

#### **Fix 1: Non-Zero Initial Production**
```typescript
// Current (broken):
weed: { rate: 0, yieldPerLevel: 0.05, ... }

// Recommended:
weed: { rate: 0.20, yieldPerLevel: 0.05, ... }
```
**Rationale:** DST Weed produces +0.20g/s immediately. Players need to SEE production happening.

#### **Fix 2: Standardize Cost Multipliers**
Replace arbitrary multipliers (1.35, 1.45, 1.6, 1.8) with a tiered system:
- Tier 1-3: 1.15
- Tier 4-6: 1.25  
- Tier 7-9: 1.35
- Tier 10+: 1.45

**Rationale:** DST uses 1.07-1.43 range. Our 1.8 multiplier is too aggressive.

#### **Fix 3: Increase yieldPerLevel Values**
Current weed: +0.05g/s per level (need 20 levels for 1g/s)
Recommended: +0.20g/s per level (5 levels for 1g/s)

### 4.2 Medium-Term Features (Important)

#### **Feature 1: Respect Meta-Currency**
Implement a "Reputation" system:
- Generated by specialized dealers or idle generation
- Spend to reduce global costs (10-30% discount)
- Caps at meaningful amounts (e.g., 50% max discount)

```typescript
interface GameState {
  // ... existing fields
  respect: number;
  respectLevel: number; // Determines discount percentage
  discountMultiplier: number; // 1.0 = no discount, 0.7 = 30% off
}
```

#### **Feature 2: Research Gates (Unlock Costs)**
Current unlock costs are unreachable:
- galacticcore: $25,000,000,000,000

**Recommended approach:**
1. Add "Research Points" generated by idle time or specific actions
2. Use Research Points for unlocks instead of raw cash
3. Or, dramatically reduce unlock costs to match DST model ($500M for top tier)

#### **Feature 3: Silk Road Bulk Liquidation**
Late-game mechanic for selling entire stash at once:
- Sell all inventory in kg batches
- Slight discount vs. dealer prices (90% of normal)
- Cooldown timer (e.g., once per hour)
- Provides massive one-time cash injection

### 4.3 Long-Term Features (Strategic)

#### **Prestige System: "Kingpins"**
- Reset progress for permanent multiplier
- Cost scales hyper-exponentially (reference DST's Dealer Captain costs)
- Unlocks automation features in subsequent runs

#### **Territory Expansion**
- Unlock new markets with different price tiers
- Each territory has unique dealers and challenges

---

## 5. Proposed New Economy Constants

### 5.1 Revised Production Values

```typescript
export const INITIAL_GAME_STATE: GameState = {
  money: 250.00,
  totalEarned: 0,
  researchSpeed: 1.0,
  respect: 0,
  respectLevel: 0,
  production: {
    weed: { id: 'weed', name: 'Weed', stock: 0, rate: 0.20, yieldPerLevel: 0.20, level: 0, upgradeCost: 15 },
    mushrooms: { id: 'mushrooms', name: 'Mushrooms', stock: 0, rate: 0.80, yieldPerLevel: 0.30, level: 0, upgradeCost: 100 },
    meth: { id: 'meth', name: 'Meth', stock: 0, rate: 0.30, yieldPerLevel: 0.15, level: 0, upgradeCost: 800 },
    // ... adjust others similarly
  },
  // ...
};
```

### 5.2 Unified Cost Multiplier System

```typescript
// In useGameEngine.ts - replace the arbitrary multipliers
const getCostMultiplier = (itemId: string, level: number): number => {
  const tier = getProductTier(itemId); // 1-17
  if (tier <= 3) return 1.15;
  if (tier <= 6) return 1.25;
  if (tier <= 10) return 1.35;
  return 1.45;
};
```

### 5.3 Respect Discount Function

```typescript
const getDiscountMultiplier = (respectLevel: number): number => {
  // Max 30% discount at respect level 100
  return Math.max(0.70, 1.0 - (respectLevel * 0.003));
};

const upgrade = (id: string) => {
  setState(prev => {
    // ...
    const discount = getDiscountMultiplier(prev.respectLevel);
    const currentUpgradeCost = Math.floor(item.upgradeCost * discount);
    // ...
  });
};
```

---

## 6. Implementation Priority

### Phase 1: Critical Fixes (Do Immediately)
1. ✅ Set non-zero `rate` values for all products
2. ✅ Standardize cost multipliers to 1.15-1.45 range
3. ✅ Increase `yieldPerLevel` to meaningful values

### Phase 2: Core Features (Next Sprint)
1. Implement Respect meta-currency
2. Add Respect discount to upgrade costs
3. Rebalance unlock costs (or add Research Points)

### Phase 3: Advanced Features (Future)
1. Silk Road bulk liquidation
2. Kingpin prestige system
3. Territory expansion

---

## 7. Conclusion

The Brmble Neon game suffers from **economic imbalance** caused by:
- Zero initial production rates
- Arbitrary and aggressive cost multipliers
- Missing meta-currency (Respect) for economic relief
- Unreachable unlock costs

By adopting the **Dope Slinger Tycoon model**:
- Gentler exponential curves (1.07-1.43 multipliers)
- Respect/Reputation system for cost reduction
- Immediate production feedback (non-zero initial rates)
- Bulk liquidation mechanics for late-game

We can transform the current frustrating experience into a balanced, engaging idle game that respects the player's time while maintaining meaningful progression.

**The key insight from DST:** *"Respect functions as a global economic modifier, introducing deflationary pressure on asset prices to counteract the inflationary nature of exponential scaling."*

**Our game needs this deflationary valve to be playable at scale.**

---

## Appendix: Document Reference

The full "Dope Slinger Tycoon Economy Breakdown" document has been extracted to:
`C:\PrOgram project\brmble\brmble\docs\investigations\temp_extracted\word\document.xml`

Key sections referenced:
- "The Dual-Currency Ecosystem and Capital Flow" (Section 2)
- "Production Mathematics and Exponential Tier Scaling" (Section 3)
- "Meta-Currencies and the Deflationary Respect Economy" (Section 6)
- "The Silk Road Liquidation Protocol" (Section 7)
