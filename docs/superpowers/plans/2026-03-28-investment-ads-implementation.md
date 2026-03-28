# Investment Ads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform advertisement system from passive throughput-based income to capital investment model with duration, cost, and payout on completion.

**Architecture:** Add investment mechanics on top of existing ad system. Existing "regular" ads continue to work; new investment ads have upfront cost, lock capacity for duration, and pay out on completion.

**Tech Stack:** React + TypeScript (frontend)

---

## File Structure

- **Modify:** `src/Brmble.Web/src/components/Game/types.ts` — Add duration, tier, activeInvestment fields
- **Modify:** `src/Brmble.Web/src/components/Game/useGameState.ts` — Investment logic, timers, cost/payout calculations
- **Modify:** `src/Brmble.Web/src/components/Game/GameUI.tsx` — Investment ad UI (cost display, timer, collect)
- **Modify:** `src/Brmble.Web/src/components/Game/GameUI.css` — New styles for investment features

---

## Task 1: Update Types for Investment Ads

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/types.ts:1-70`

- [ ] **Step 1: Add Duration and Investment types**

Add after the `Advertisement` interface:

```typescript
export type AdDuration = 'short' | 'medium' | 'long';

export type InvestmentStatus = 'running' | 'ready' | 'collected';

export interface ActiveInvestment {
  adId: string;
  licenseId: string;
  startTime: number;
  durationMs: number;
  payout: number;
  status: InvestmentStatus;
  volumeKB: number; // Store the capacity this investment uses
}
```

**Why separate status:**
- `running`: Active, timer ticking, blocks license
- `ready`: Completed, can collect, no longer blocks license
- `collected`: Already collected, can start new investment

- [ ] **Step 2: Add tier field to License**

Modify the `License` interface to include:

```typescript
export interface License {
  // ... existing fields
  tier: number;  // 1, 2, or 3 — determines max volume stars for investment ads
}
```

- [ ] **Step 3: Update INITIAL_LICENSES with tier values**

```typescript
export const INITIAL_LICENSES: License[] = [
  { 
    id: 'personal-website', 
    name: 'Personal Website', 
    tier: 1,
    // ... rest
  },
  { 
    id: 'blog-hosting', 
    name: 'Blog Hosting', 
    tier: 1,
    // ... rest
  },
  // File Hosting and below = tier 2
  // Video CDN and above = tier 3
];
```

- [ ] **Step 4: Add activeInvestments to GameState**

Modify `GameState` interface:

```typescript
export interface GameState {
  // ... existing fields
  activeInvestments: ActiveInvestment[];
}
```

- [ ] **Step 5: Add investment actions to GameActions**

```typescript
export interface GameActions {
  // ... existing actions
  startInvestment: (adId: string, licenseId: string) => void;
  collectInvestment: (adId: string) => void;
}
```

- [ ] **Step 6: Update INITIAL_STATE**

```typescript
export const INITIAL_STATE: GameState = {
  // ... existing fields
  activeInvestments: [],
};
```

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/Game/types.ts
git commit -m "feat: add investment ad types and fields"
```

---

## Task 2: Implement Investment Logic in useGameState

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts:1-50`

- [ ] **Step 1: Add constants for investment calculations**

Add after imports:

```typescript
const DURATION_VALUES = {
  short: { minMs: 5 * 60 * 1000, maxMs: 20 * 60 * 1000, bonus: 1.1 },
  medium: { minMs: 60 * 60 * 1000, maxMs: 4 * 60 * 60 * 1000, bonus: 1.25 },
  long: { minMs: 6 * 60 * 60 * 1000, maxMs: 12 * 60 * 60 * 1000, bonus: 1.5 },
};

const VOLUME_TO_CAPACITY = {
  1: 0.1,
  2: 0.2,
  3: 0.3,
  4: 0.4,
  5: 0.5,
};

const VOLUME_BONUS = {
  1: 0.9,
  2: 1.0,
  3: 1.1,
  4: 1.2,
  5: 1.3,
};

const MARGIN_MULTIPLIER = {
  1: 1.2,
  2: 1.4,
  3: 1.6,
  4: 1.8,
  5: 2.0,
};

const MAX_VOLUME_BY_TIER = {
  1: 3,
  2: 4,
  3: 5,
};
```

- [ ] **Step 2: Add investment helper functions**

Add before `export function useGameState()`:

```typescript
const getDuration = (): AdDuration => {
  const rand = Math.random();
  if (rand < 0.33) return 'short';
  if (rand < 0.66) return 'medium';
  return 'long';
};

const getDurationMs = (duration: AdDuration): number => {
  const { minMs, maxMs } = DURATION_VALUES[duration];
  return Math.floor(Math.random() * (maxMs - minMs) + minMs);
};

const calculateInvestmentCost = (license: License, volumeStars: number): number => {
  const cap = calculateCap(license, license.level);
  const effectiveCap = getEffectiveCap(license);
  const volumeKB = cap * effectiveCap * VOLUME_TO_CAPACITY[volumeStars];
  // Cost = what the throttled capacity would earn in 1 minute
  return volumeKB * license.incomePerKB * 60;
};

const calculateInvestmentPayout = (
  cost: number,
  volume: number,
  margin: number,
  duration: AdDuration
): number => {
  const marginMult = MARGIN_MULTIPLIER[margin];
  const volumeBonus = VOLUME_BONUS[volume];
  const durationBonus = DURATION_VALUES[duration].bonus;
  return cost * marginMult * volumeBonus * durationBonus;
};

const getVolumeCapacityKB = (license: License, volumeStars: number): number => {
  const cap = calculateCap(license, license.level);
  const effectiveCap = getEffectiveCap(license);
  return cap * effectiveCap * VOLUME_TO_CAPACITY[volumeStars];
};
```

- [ ] **Step 3: Add startInvestment action**

Add after `buyAdSlot`:

```typescript
const startInvestment = useCallback((adId: string, licenseId: string) => {
  setState(prev => {
    const ad = prev.advertisements.find(a => a.id === adId);
    if (!ad) return prev;
    
    const license = prev.licenses.find(l => l.id === licenseId);
    if (!license || !license.unlocked) return prev;
    
    // Check if license has a RUNNING investment (not ready or collected)
    const hasRunningInvestment = prev.activeInvestments.some(
      i => i.licenseId === licenseId && i.status === 'running'
    );
    if (hasRunningInvestment) return prev;
    
    // Check volume against tier
    const maxVolume = MAX_VOLUME_BY_TIER[license.tier];
    if (ad.volume > maxVolume) return prev;
    
    // Check capacity
    const volumeKB = getVolumeCapacityKB(license, ad.volume);
    const cost = calculateInvestmentCost(license, ad.volume);
    
    if (prev.money < cost) return prev;
    
    const duration = getDuration();
    const durationMs = getDurationMs(duration);
    const payout = calculateInvestmentPayout(cost, ad.volume, ad.margin, duration);
    
    const newInvestment: ActiveInvestment = {
      adId,
      licenseId,
      startTime: Date.now(),
      durationMs,
      payout,
      status: 'running',
      volumeKB,
    };
    
    return {
      ...prev,
      money: prev.money - cost,
      activeInvestments: [...prev.activeInvestments, newInvestment],
    };
  });
}, []);
```

- [ ] **Step 4: Add collectInvestment action**

Add after `startInvestment`:

```typescript
const collectInvestment = useCallback((adId: string) => {
  setState(prev => {
    const investment = prev.activeInvestments.find(i => i.adId === adId);
    if (!investment || investment.status !== 'ready') return prev;
    
    return {
      ...prev,
      money: prev.money + investment.payout,
      activeInvestments: prev.activeInvestments.map(i =>
        i.adId === adId ? { ...i, status: 'collected' } : i
      ),
    };
  });
}, []);
```

- [ ] **Step 5: Add investment timer with efficient updates**

Add a separate effect just for investment timers that only updates when needed:

```typescript
// Separate timer for investments - only ticks when there are running investments
useEffect(() => {
  const hasRunning = state.activeInvestments.some(i => i.status === 'running');
  if (!hasRunning) return;
  
  const interval = setInterval(() => {
    setState(prev => {
      const now = Date.now();
      let hasChanges = false;
      
      const updatedInvestments = prev.activeInvestments.map(inv => {
        if (inv.status !== 'running') return inv;
        
        const elapsed = now - inv.startTime;
        if (elapsed >= inv.durationMs) {
          hasChanges = true;
          return { ...inv, status: 'ready' };
        }
        return inv;
      });
      
      if (!hasChanges) return prev;
      return { ...prev, activeInvestments: updatedInvestments };
    });
  }, 1000);
  
  return () => clearInterval(interval);
}, [state.activeInvestments.some(i => i.status === 'running')]); // Only re-run when running count changes
```

- [ ] **Step 6: Update actions object**

Add to the `actions` object:

```typescript
const actions: GameActions = {
  // ... existing actions
  startInvestment,
  collectInvestment,
};
```

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/Game/useGameState.ts
git commit -m "feat: add investment ad logic to game state"
```

---

## Task 3: Update UI for Investment Ads

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/GameUI.tsx:560-640`

- [ ] **Step 1: Update AdSlotsSection to show investment UI**

Replace `AdSlotsSection` with new version that shows:
- Cost when hovering/selecting hosting
- Timer countdown when ad is running
- Collect button when ready

```typescript
function AdSlotsSection({ 
  advertisements, 
  adSlots, 
  lastAdRefresh, 
  onAssignAd, 
  onFindNewAd, 
  licenses,
  activeInvestments,
  onStartInvestment,
  onCollectInvestment,
  money,
}: AdSlotsSectionProps) {
  const [timeLeft, setTimeLeft] = useState(0);
  const [selectedAdId, setSelectedAdId] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const cooldown = 5 * 60 * 1000;
      setTimeLeft(Math.max(0, cooldown - (now - lastAdRefresh)));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastAdRefresh]);

  const canRefresh = timeLeft === 0;
  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);

  const getAdVolumeKB = (ad: Advertisement, license: License): number => {
    const cap = calculateCap(license.baseCap, license.capPerLevel, license.level);
    const effectiveCap = 0.6 + license.bonus.capacityBonus;
    const maxAdKB = cap * effectiveCap;
    return maxAdKB * (ad.volume / 5);
  };

  const getInvestmentForAd = (adId: string) => {
    return activeInvestments.find(i => i.adId === adId);
  };

  // Status is stored in state, not computed from time
  const isInvestmentReady = (adId: string) => {
    const inv = getInvestmentForAd(adId);
    return inv?.status === 'ready';
  };

  const isInvestmentRunning = (adId: string) => {
    const inv = getInvestmentForAd(adId);
    return inv?.status === 'running';
  };

  const getTimeRemaining = (adId: string): number => {
    const inv = getInvestmentForAd(adId);
    if (!inv || inv.status !== 'running') return 0;
    const elapsed = Date.now() - inv.startTime;
    return Math.max(0, inv.durationMs - elapsed);
  };

  return (
    <div className="ad-slots-section">
      <div className="ad-header">
        <h3 className="heading-label">Advertisement Slots ({advertisements.length}/{adSlots})</h3>
        <button
          className="btn btn-secondary"
          disabled={!canRefresh}
          onClick={onFindNewAd}
        >
          {canRefresh ? 'Find New Ad' : `Wait ${minutes}:${seconds.toString().padStart(2, '0')}`}
        </button>
      </div>

      {advertisements.map((ad) => {
        const investment = getInvestmentForAd(ad.id);
        const isRunning = isInvestmentRunning(ad.id);
        const canCollect = isInvestmentReady(ad.id);
        const timeRemaining = getTimeRemaining(ad.id);

        const formatTime = (ms: number) => {
          const hours = Math.floor(ms / 3600000);
          const mins = Math.floor((ms % 3600000) / 60000);
          if (hours > 0) return `${hours}h ${mins}m`;
          return `${mins}m`;
        };

        return (
          <div key={ad.id} className={`ad-slot ${isRunning ? 'running' : ''} ${canCollect ? 'ready' : ''}`}>
            <span className="ad-type">{ad.type}</span>
            <span className="ad-name">{ad.name}</span>
            <span className="ad-stars">Vol: {'★'.repeat(ad.volume)}{'☆'.repeat(5-ad.volume)}</span>
            <span className="ad-stars">Mar: {'★'.repeat(ad.margin)}{'☆'.repeat(5-ad.margin)}</span>
            
            {canCollect ? (
              <button 
                className="btn btn-primary collect-btn"
                onClick={() => onCollectInvestment(ad.id)}
              >
                Collect ${investment?.payout.toFixed(2)}
              </button>
            ) : isRunning ? (
              <span className="investment-timer">
                {formatTime(timeRemaining)} left
              </span>
            ) : (
              <>
                <select
                  value={ad.licenseId}
                  onChange={(e) => onAssignAd(ad.id, e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {licenses.filter(l => l.unlocked).map(l => {
                    const cap = calculateCap(l.baseCap, l.capPerLevel, l.level);
                    const effectiveCap = 0.6 + l.bonus.capacityBonus;
                    const maxAdKB = cap * effectiveCap;
                    const otherAds = advertisements
                      .filter(a => a.id !== ad.id && a.licenseId === l.id)
                      .reduce((sum, a) => sum + getAdVolumeKB(a, l), 0);
                    const available = maxAdKB - otherAds;
                    const adKB = getAdVolumeKB(ad, l);
                    // Only block if there's a RUNNING investment (ready/collected are fine)
                    const hasRunningInvestment = activeInvestments.some(
                      i => i.licenseId === l.id && i.status === 'running'
                    );
                    return (
                      <option 
                        key={l.id} 
                        value={l.id} 
                        disabled={available < adKB || hasRunningInvestment}
                      >
                        {l.name} ({formatBandwidth(Math.max(0, available))} free)
                      </option>
                    );
                  })}
                </select>
                {ad.licenseId && (
                  <button
                    className="btn btn-primary invest-btn"
                    disabled={money < calculateCostForAd(ad, licenses.find(l => l.id === ad.licenseId)!)}
                    onClick={() => onStartInvestment(ad.id, ad.licenseId)}
                  >
                    Invest
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Add calculateCostForAd helper**

Add at the top of the file (or in a utils section):

```typescript
const calculateCostForAd = (ad: Advertisement, license: License): number => {
  const cap = calculateCap(license.baseCap, license.capPerLevel, license.level);
  return cap * license.incomePerKB * 60;
};
```

- [ ] **Step 3: Update HostingTabProps**

Add to the props interface:

```typescript
interface AdSlotsSectionProps {
  // ... existing
  activeInvestments: ActiveInvestment[];
  onStartInvestment: (adId: string, licenseId: string) => void;
  onCollectInvestment: (adId: string) => void;
  money: number;
}
```

- [ ] **Step 4: Update HostingTab to pass new props**

Modify where `AdSlotsSection` is rendered in `HostingTab`:

```typescript
<AdSlotsSection
  advertisements={advertisements}
  adSlots={adSlots}
  lastAdRefresh={lastAdRefresh}
  onAssignAd={onAssignAd}
  onFindNewAd={handleFindNewAd}
  licenses={licenses}
  activeInvestments={state.activeInvestments}
  onStartInvestment={actions.startInvestment}
  onCollectInvestment={actions.collectInvestment}
  money={state.money}
/>
```

- [ ] **Step 5: Add styles for investment UI**

Add to `GameUI.css`:

```css
.ad-slot.running {
  background: rgba(59, 130, 246, 0.2);
  border-left: 3px solid #3b82f6;
}

.ad-slot.ready {
  background: rgba(34, 197, 94, 0.2);
  border-left: 3px solid #22c55e;
}

.investment-timer {
  color: #3b82f6;
  font-weight: bold;
}

.collect-btn {
  background: #22c55e;
  animation: pulse 1s infinite;
}

.invest-btn {
  margin-left: 8px;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Game/GameUI.tsx src/Brmble.Web/src/components/Game/GameUI.css
git commit -m "feat: add investment ad UI with timer and collect"
```

---

## Task 4: Generate Investment Ads with Duration

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts:350-370`

- [ ] **Step 1: Update generateAdOptions to include duration**

Modify the `generateAdOptions` function:

```typescript
const generateAdOptions = useCallback((): Advertisement[] => {
  const options: Advertisement[] = [];
  for (let i = 0; i < 3; i++) {
    const type = AD_TYPES[Math.floor(Math.random() * AD_TYPES.length)];
    const volume = Math.floor(Math.random() * 5) + 1;
    const margin = Math.floor(Math.random() * 5) + 1;
    const duration = getDuration(); // Add this
    options.push({
      id: crypto.randomUUID(),
      name: generateAdName(type),
      type,
      volume,
      margin,
      licenseId: '',
      duration, // Add this
    });
  }
  return options;
}, []);
```

- [ ] **Step 2: Update Advertisement type to include duration**

Modify the `Advertisement` interface in types.ts:

```typescript
export interface Advertisement {
  id: string;
  name: string;
  type: AdType;
  volume: number;
  margin: number;
  licenseId: string;
  duration?: AdDuration; // Optional - for investment ads
}
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/useGameState.ts src/Brmble.Web/src/components/Game/types.ts
git commit -m "feat: add duration to generated ads"
```

---

## Task 5: Integration Testing

- [ ] **Step 1: Test the full flow**

1. Start the game
2. Click "Find New Ad"
3. Select an ad
4. Select a hosting from dropdown
5. Click "Invest" (if enough money)
6. Verify timer appears
7. Wait for completion (or use dev tools to speed up)
8. Click "Collect"
9. Verify money increases

- [ ] **Step 2: Test edge cases**

1. Try to invest with insufficient money (should be disabled)
2. Try to place ad on hosting with existing investment (should be disabled)
3. Try to use 5★ volume on tier 1 hosting (should be limited to 3★)
4. Refresh page and verify investments persist

- [ ] **Step 3: Commit any fixes**

```bash
git add .
git commit -m "fix: investment ad edge cases"
```

---

## Implementation Complete

The investment ads system is now implemented with:
- Duration-based ads (short/medium/long)
- Upfront cost based on hosting value
- Payout calculation with margin × volume × duration bonuses
- Tier-based volume limits
- Timer countdown UI
- Collect button on completion
- Warning when hosting already has an investment
