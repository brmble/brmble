# Investment Ads Design

## Overview

Evolves the existing advertisement system from passive throughput-based income to a capital investment model. Players now make strategic decisions about where to allocate money and hosting capacity.

---

## Core Concept

**Investment Ads:**
- Upfront cost locks hosting capacity for a duration
- Payout received on completion (not ongoing)
- Player decides: "Is this ROI worth locking my money + capacity?"
- Duration affects total payout: longer = better ROI

---

## Ad Properties

| Property | Stars | Effect |
|----------|-------|--------|
| **Volume** | 1-5 | % of hosting capacity throttled + payout bonus |
| **Margin** | 1-5 | ROI multiplier (profit %) |
| **Duration** | Short/Medium/Long | How long the ad runs |

### Volume Stars → Capacity Throttle

| Stars | Throttle |
|-------|----------|
| 1★ | 10% |
| 2★ | 20% |
| 3★ | 30% |
| 4★ | 40% |
| 5★ | 50% |

### Margin Stars → ROI Multiplier

| Stars | Multiplier | Profit |
|-------|------------|--------|
| 1★ | 1.2× | 20% |
| 2★ | 1.4× | 40% |
| 3★ | 1.6× | 60% |
| 4★ | 1.8× | 80% |
| 5★ | 2.0× | 100% |

### Duration

| Category | Range | Bonus |
|----------|-------|-------|
| Short | 5-20 minutes | 1.1× |
| Medium | 1-4 hours | 1.25× |
| Long | 6-12 hours | 1.5× |

Longer durations provide better total ROI, creating meaningful trade-offs:
- Short: Fast cash (1.1× bonus)
- Medium: Balanced (1.25× bonus)
- Long: Best total return (1.5× bonus), but capital locked longer

---

## Cost & Payout Formula

```
cost = hostingValue
payout = cost × marginMultiplier × durationBonus × volumeBonus

Where:
- hostingValue = hosting's KB/s × $/KB baseline
- marginMultiplier = based on margin stars (1.2× to 2.0×)
- durationBonus = 1.1× (short), 1.25× (medium), 1.5× (long)
- volumeBonus = 0.9× to 1.3× based on volume stars
```

### Volume Stars → Payout Bonus

High-volume ads are more intrusive, so they pay more:

| Stars | Bonus |
|-------|-------|
| 1★ | 0.9× |
| 2★ | 1.0× |
| 3★ | 1.1× |
| 4★ | 1.2× |
| 5★ | 1.3× |

**Trade-off:**
- High volume = more capacity locked, but also more profit
- Low volume = safer, but less lucrative

**Example:**
- Personal Website: $10 baseline value
- 1★ margin (1.2×), 1★ volume (0.9×), Short: Cost = $10, Payout = $10 × 1.2 × 1.1 × 0.9 = $11.88 (19% profit)
- 5★ margin (2.0×), 5★ volume (1.3×), Long: Cost = $10, Payout = $10 × 2.0 × 1.5 × 1.3 = $39 (290% profit)

**Adjusted Margin Stars → ROI:**

| Stars | Multiplier | Profit |
|-------|------------|--------|
| 1★ | 1.2× | 20% |
| 2★ | 1.4× | 40% |
| 3★ | 1.6× | 60% |
| 4★ | 1.8× | 80% |
| 5★ | 2.0× | 100% |

---

## Placement Rules

1. Each hosting can have **only 1 active ad at a time**
2. Must have **free (unallocated) capacity** >= required throttle
3. Ad locks the throttled capacity for full duration
4. Warning shown if placing on hosting that already has an ad

### Hosting Tier Volume Cap

Volume stars available scale with hosting tier:

| Hosting Tier | Max Volume Stars |
|--------------|-------------------|
| Tier 1 | 3★ |
| Tier 2 | 4★ |
| Tier 3 | 5★ |

This prevents early-game softlocks where players can't fit high-volume ads.

**Volume Check:**
```
if (hosting.totalCapacity × volume% > hosting.freeCapacity):
    Show warning: "Not enough free capacity"
```

---

## UI Flow

1. **View 3 ads** with dropdown to select hosting
2. **Select hosting** → updates:
   - Required cost
   - KB/s that will be throttled
   - KB/s remaining free
3. **Buy button** (disabled if insufficient funds)
4. **Ad runs** → shows countdown timer
5. **On completion:**
   - Throttle released
   - "Collect" button appears
6. **Collect** → payout added to money, ad slot empty
7. **Find New Ad** button with 5-minute cooldown

---

## Interaction with Existing System

- Infrastructure (USB Uploaders) → KB/s
- Hosting → capacity for both regular income AND investment ads
- Regular KB/s income still works (non-ad traffic)
- Ad throttle reduces available capacity during investment duration

**Formula for occupied capacity:**
```
occupied = regularHostingUsage + activeAd.throttle
free = hosting.totalCapacity × 0.6 - occupied
```

Note: The 60% ad-density rule still applies to total ad usage.

---

## Key Design Decisions

1. **Slots:** 3 ad slots (expandable via upgrades)
2. **Refresh:** Manual "Find New Ad" with 5-min cooldown
3. **No partial early exit:** Player commits for full duration
4. **Visible timer:** Player sees remaining duration
5. **Collect required:** Payout not auto-added, must click to collect

---

## Safeguards

1. **Always show free capacity** when selecting hosting
2. **Warning on oversaturated:** Can't place if not enough free
3. **Collection required:** Prevents accidental money gain
4. **Cooldown prevents spam:** 5-min wait between ads

---

## Future Considerations (Not in V1)

- Buyout option (cancel early, 50% refund)
- Market archetypes (Stable/Volatile/Slow Burn/Burst)
- Preview tool showing estimated income per hosting
