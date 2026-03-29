# Advertisement System Design

## Overview

The game has 3 layers:

1. **Input (Infrastructure)** - Produces KB/s
2. **Buffer (Hosting)** - Stores the capacity
3. **Output (Ads)** - Converts KB/s to money

---

## Layer 1: Input (Infrastructure)

**Question:** How much "Power" does the system produce?

**Components:** USB Uploaders, Home Servers, Data Centers

**Output:** Total KB/s (Bandwidth)

**Design Rule:** Passive counter that only increases through purchases. It's the fuel for the rest of the game.

---

## Layer 2: Hosting (Buffer)

**Question:** How much "Space" is there to place ads?

**Components:** Personal Websites, Blogs, Game Servers

**Mechanic:** Each site has a maximum capacity (Cap), e.g., 100 KB/s

**Constraint: 60% Ad-Density Rule:**
- Only 60% of a site's capacity can be filled with ads
- The remaining 40% is "Content" (non-sellable)

**Design Rule:** Player must always have more Hosting than they sell to Ads, otherwise the site is "oversaturated"

---

## Layer 3: Output (Ads)

**Question:** How is data converted to money?

**Components:** 1 to 3 Ad-slots

### Ad Types

Each ad has a **Type** that determines its base behavior:

| Type | Volume | Margin | Special Effect |
|------|--------|--------|----------------|
| **Video Ads** | High (60-100% of slot) | High ($0.004-0.008/KB) | None |
| **Banner Ads** | Low (20-40% of slot) | Stable ($0.002-0.004/KB) | None |
| **Popup Ads** | Medium (40-60% of slot) | High ($0.005-0.007/KB) | Reduces site efficiency by 10% per ad |
| **Sponsored Content** | Varies | Varies | Can use up to 20% of the 40% "Content" space |

### RNG Roll

When you get an Ad contract, it has:

- **Type** (random from table above)
- **Volume** (1-5 Stars): What % of the ad-space does this ad take?
  - 1 star = 20% of ad-space
  - 5 stars = 100% of ad-space (full 60% of capacity)
- **Margin** (1-5 Stars): What is the price per sold KB?

### License Bonuses

Each license type provides a bonus when ads are placed on it:

| License | Bonus |
|---------|-------|
| **Blog Hosting** | +20% margin for low-volume ads (1-2 stars) |
| **Game Servers** | +30% capacity for high-volume ads (4-5 stars) |
| **Personal Website** | Slower saturation penalty (10% instead of 20%) |
| **Video CDN** | +10% all ad revenue |
| **Cloud Storage** | Can handle more stacked ads before efficiency penalty kicks in |

---

## Stacking Efficiency

Multiple ads can be placed on the same hosting license, but each subsequent ad gets an efficiency penalty:

- **1st ad:** 100% efficiency
- **2nd ad:** 80% efficiency
- **3rd ad:** 60% efficiency
- **4th+ ad:** 40% efficiency

**Formula:**
```
effectiveVolume = adVolume * efficiency
effectiveMargin = adMargin * efficiency
```

This naturally limits stacking - spreading ads across multiple licenses is more efficient than stacking on one.

---

## The Formula

```
Regular Hosting Income = allocatedKB * license.incomePerKB

Ad Income = license.cap * effectiveCap * volume% * effectiveMarginRate * licenseBonus

Where:
- license.cap = total capacity of license
- effectiveCap = 0.6 (60% ad-density) + license bonus for capacity
- volume% = 0.2 to 1.0 (based on Volume stars 1-5)
- effectiveMarginRate = marginRate * efficiency * license bonus for margin
- efficiency = based on number of ads on same license: 1st=1.0, 2nd=0.8, 3rd=0.6, 4th+=0.4
- licenseBonus = 1.0 + bonus from license type
```

**Note:** Efficiency only affects Margin, not Volume. This prevents double multiplication.

---

## The Fail States

1. **Underpowered:**
   - You have a great Ad and lots of Hosting
   - But your USB sticks don't produce enough KB/s
   - The Ad runs at half power and you earn less

2. **Oversaturated:**
   - Your Ad tries to sell 100 KB/s
   - But your Hosting can only provide 60 KB/s (due to 60% rule)
   - You waste the Ad's potential

3. **Overstacked:**
   - You put 4+ ads on one license
   - Efficiency drops to 40%
   - Better to spread across multiple licenses

---

## UI Design

**Layout:**

- **Left (Input):** List of hardware (USB sticks) filling a meter: "Total Network Power"

- **Center (Hosting):** Website cards. Each card has:
  - Bar showing how full the site is with ads (max 60%)
  - Number of ads currently on this license
  - Efficiency indicator

- **Right (Ads):** Active contracts with:
  - Ad type icon/name
  - Volume/Margin stars
  - Dropdown: "On which site do you want to place this Ad?"
  - Efficiency warning if stacked

---

## Implementation Notes

- Each license has a `maxAdCapacity` = cap * 0.6
- License tracks how much is sold to ads vs regular hosting
- Slider in Hosting tab shows: allocated / maxAdCapacity (not total cap)
- If allocated > maxAdCapacity, show warning (oversaturated)
- Efficiency calculated per license based on ad count
- Sponsored Content can use the 40% content space (special case)

## Slots

- 1 free slot to start (enforced: advertisements.length < adSlots)
- Buy more in Tech Upgrades tab
- adSlotCost scales with number of slots

## Refresh Mechanic

- Manual "Find New Ad" button
- Cooldown: 5 minutes between refreshes
- New ad: random Type + Volume + Margin (1-5 stars each)
- If slot is empty, add new ad
- If slot has ad, replace current ad with new one

## Assignment Rules

- Can assign ads only to unlocked licenses
- Can unassign/remove ad from license (set licenseId to empty)
- Must validate available capacity: ad.effectiveCost <= license.maxAdCapacity (accounting for efficiency)

## Example

- Personal Website: 100 KB/s capacity
- Max Ad space: 60 KB/s (60% of 100)
- 2 Ads stacked: Video Ad (Volume 5, Margin 5) + Banner Ad (Volume 3, Margin 3)
- First ad efficiency: 100%, Second ad efficiency: 80%
- Ad 1: 60 KB/s × 1.0 × $0.005/KB × 1.0 = $0.30/s
- Ad 2: 60 KB/s × 0.6 × $0.003/KB × 0.8 = $0.086/s
- Regular hosting: 40 KB/s left × $0.001/KB = $0.04/s
- Total: $0.426/s
