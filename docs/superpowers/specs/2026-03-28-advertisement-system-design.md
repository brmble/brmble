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

**RNG Roll:** When you get an Ad contract, it has two variables:

- **Volume** (1-5 Stars): What % of the available 60% ad-space does this ad take?
  - 1 star = 20% of ad-space
  - 5 stars = 100% of ad-space (full 60% of capacity)
- **Margin** (1-5 Stars): What is the price per sold KB?

**Design Rule:** Income = Linked Hosting Cap × 60% × Ad Volume % × Ad Margin

---

## The Formula

```
Regular Hosting Income = allocatedKB * license.incomePerKB

Ad Income = (license.cap * 0.6 * adVolumePercent) * adMarginRate

Where:
- license.cap = total capacity of license
- 0.6 = 60% ad-density limit
- adVolumePercent = 0.2 to 1.0 (based on Volume stars 1-5)
- adMarginRate = $ per KB (based on Margin stars)
```

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

---

## UI Design

**Layout:**

- **Left (Input):** List of hardware (USB sticks) filling a meter: "Total Network Power"

- **Center (Hosting):** Website cards. Each card has a bar showing how full the site is with ads (max 60%)

- **Right (Ads):** Active contracts with dropdown: "On which site do you want to place this Ad?"

---

## Implementation Notes

- Each license has a `maxAdCapacity` = cap * 0.6
- License tracks how much is sold to ads vs regular hosting
- Slider in Hosting tab shows: allocated / maxAdCapacity (not total cap)
- If allocated > maxAdCapacity, show warning (oversaturated)
- Income calculation: regularKB * regularRate + adKB * adRate

## Slots

- 1 free slot to start (enforced: advertisements.length < adSlots)
- Buy more in Tech Upgrades tab
- adSlotCost scales with number of slots

## Refresh Mechanic

- Manual "Find New Ad" button
- Cooldown: 5 minutes between refreshes
- New ad: random Volume + Margin (1-5 stars each)
- If slot is empty, add new ad
- If slot has ad, replace current ad with new one

## Assignment Rules

- Can assign ads only to unlocked licenses
- Can unassign/remove ad from license (set licenseId to empty)
- Must validate available capacity: ad.cost <= license.maxAdCapacity

## Example

- Personal Website: 100 KB/s capacity
- Max Ad space: 60 KB/s (60% of 100)
- Ad with Volume 5 stars, Margin 5 stars
- Ad uses: 60 KB/s × 1.0 × $0.005/KB = $0.30/s
- Regular hosting: 40 KB/s left × $0.001/KB = $0.04/s
- Total: $0.34/s
