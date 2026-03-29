# Ad System Redesign - Investment Gameplay

## Overview

Complete overhaul of the ad system to create a strategic mini-game where players choose between fast small profits or longer bigger profits.

## Core Ad Properties

### New Ad Fields
Each rolled ad has:
- `volume`: 1-5 stars (data to process, KB)
- `margin`: 1-5 stars (profit per KB)
- `passiveIncome`: 1-5 stars (fixed $/sec while active)
- `timeLimitMs`: deadline calculated from volume

### Star Distribution (Weighted Random)
| Stars | Probability | Passive Income ($/sec) |
|-------|-------------|------------------------|
| 1-3   | ~70-80%     | $0.10-$0.50/s          |
| 4     | ~15-20%     | $1.00-$2.00/s          |
| 5     | ~5-10%      | $3.00-$5.00/s          |

Same distribution applies to Volume and Margin.

### Time Limit Calculation
```
timeLimitMs = volumeKB * (0.7 + random * 0.6) * timeMultiplier
```
Where `timeMultiplier` scales volume KB to realistic time limits.

## Income Model

### Three Income Components

1. **Passive Income** (Time)
   - Fixed $/sec paid every second while ad is active
   - Always earned, win or lose
   - Calculated: `passiveIncomeBase * passiveRating`

2. **Margin Income** (Performance Bonus)
   - $/KB earned as data is processed
   - Paid at completion OR when time expires
   - Calculated: `license.incomePerKB * marginMultiplier * KB_processed`

3. **Breach Fee** (Cancellation Cost)
   - Paid to cancel early or when time expires
   - Formula: `buyPrice + (expectedTotalPayout * 0.20)`
   - Frees up the slot

### Buy Price
```
expectedPassiveIncome = passiveIncomePerSec * estimatedDuration
expectedMarginIncome = volumeKB * marginPerKB
expectedTotalPayout = expectedPassiveIncome + expectedMarginIncome
buyPrice = expectedTotalPayout * (0.20 + random * 0.10)  // 20-30%
```

## Hosting Bandwidth

Progress calculation uses `license.allocated` KB/s (player-controlled).

### Progress Formula
```
KB_processed = elapsed_seconds * license.allocated
KB_remaining = volumeKB - KB_processed
progress_pct = KB_processed / volumeKB * 100
```

### Estimated Duration
```
estimatedDuration = volumeKB / license.allocated
```

## UI Components

### Ad Selection Modal (Find New Ad)

```
┌─────────────────────────────────────┐
│ <Advertisement Name>                │
│                                     │
│ Volume: ★★★★★                       │
│ Margin: ★★★                         │
│ Passive Income: $0.50/s ★★          │
│ Time Limit: 02:30:00                │
│                                     │
│ [Invest $25.00]                     │
└─────────────────────────────────────┘
```

### Ad Slots Tab

```
┌─────────────────────────────────────┐
│ Advertisement Slots (2/5)           │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ StreamHub Pro        [Running]   │ │
│ │ ████████████░░░░░ 67%           │ │
│ │ KB Remaining: 512 MB             │ │
│ │ Income Earned: $12.50           │ │
│ │ Time Left: 01:23:45             │ │
│ │ [Cancel - $30.00]               │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### Hosting Tab (License Row)

```
┌─────────────────────────────────────┐
│ Personal Website  Lv.2              │
│ Cap: 2 MB | $1.00/KB               │
│                                     │
│ ████████░░░░░░░░░ 45%             │
│ Ad: StreamHub Pro                   │
│ Income: +$0.50/s                    │
│ KB/s: 512 / 1024                   │
└─────────────────────────────────────┘
```

**Note:** Sliders remain for allocation management, but display shows:
- Progress bar if ad is active
- Ad name and income contribution
- Current KB/s usage vs allocated

## State Changes

### Advertisement Interface
```typescript
interface Advertisement {
  id: string;
  name: string;
  type: AdType;
  volume: number;        // 1-5 stars
  margin: number;       // 1-5 stars
  passiveIncome: number; // 1-5 stars ($/sec derived from this)
  timeLimitMs: number;  // deadline in ms
  licenseId: string;
  buyPrice: number;
}
```

### ActiveInvestment Interface
```typescript
interface ActiveInvestment {
  adId: string;
  licenseId: string;
  startTime: number;
  volumeKB: number;
  passiveIncomePerSec: number;
  marginPerKB: number;
  buyPrice: number;
  breachFee: number;
  status: InvestmentStatus;
}
```

## Game Rules

### Success (Ad Completes)
- Ad finishes before time limit
- Player receives: all passive income + full margin income
- Slot freed

### Failure (Time Expires)
- Player keeps passive income earned so far
- Must pay breach fee to cancel
- Breach fee = buyPrice + (expectedPayout * 0.20)
- Slot freed after payment

### Manual Cancel
- Player can cancel anytime
- Same breach fee applies
- Passive income earned so far is kept

### Slot Lockdown
- While ad is running, license cannot be deallocated below ad's KB/s usage
- Enforcement: prevent allocation < current ad usage when ad is active

## Files to Modify

1. **types.ts**
   - Update `Advertisement` interface
   - Update `ActiveInvestment` interface

2. **useGameState.ts**
   - Update `generateAdOptions()` with new fields and weighted distribution
   - Update `startInvestment()` to calculate buy price and breach fee
   - Add `cancelInvestment()` action
   - Update income ticker to handle passive income tracking

3. **GameUI.tsx**
   - Update `AdSelectionModal` with new card layout
   - Update `AdSlotsSection` with progress bars and cancel button
   - Update `LicenseRow` with progress bar display

4. **GameUI.css**
   - Add styles for progress bars, cancel button, ad card layout

## Verification

- [ ] Ad generation has correct star distribution
- [ ] Buy price is 20-30% of expected payout
- [ ] Passive income paid per second
- [ ] Margin income calculated correctly at completion
- [ ] Breach fee calculated correctly
- [ ] Progress bars update in real-time
- [ ] Hosting tab shows ad progress
- [ ] Cancel button works with confirmation
- [ ] Time limit enforced correctly
