# Advertisement System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add advertisement system to game - ads placed on licenses take bandwidth and sell at higher rates

**Architecture:** Add Advertisement types, state logic, and UI to existing Game component. License capacity is split between regular hosting and ads.

**Tech Stack:** React, TypeScript

---

## File Structure

**Modify:**
- `src/Brmble.Web/src/components/Game/types.ts` - Advertisement interface, update License/GameState
- `src/Brmble.Web/src/components/Game/useGameState.ts` - Ad state logic, refresh timer, adSlotCost
- `src/Brmble.Web/src/components/Game/GameUI.tsx` - Hosting tab with ad slots
- `src/Brmble.Web/src/components/Game/GameUI.css` - Ad slot styles

---

### Task 1: Update Types

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/types.ts`

- [ ] **Step 1: Add Advertisement interface**

```typescript
export interface Advertisement {
  id: string;
  name: string;
  volume: number;      // 1-5 stars
  margin: number;     // 1-5 stars multiplier
  cost: number;       // KB/s consumed
  incomePerKB: number; // $/KB sold
  licenseId: string;  // which license it's assigned to (empty = unassigned)
}
```

- [ ] **Step 2: Update License interface to track ad usage**

```typescript
export interface License {
  // ... existing fields ...
  adAllocated: number; // KB/s used by ads
}
```

- [ ] **Step 3: Add ad-related fields to GameState**

```typescript
export interface GameState {
  // ... existing fields ...
  advertisements: Advertisement[];
  adSlots: number;
  lastAdRefresh: number;
}
```

- [ ] **Step 4: Update INITIAL_STATE**

```typescript
export const INITIAL_STATE: GameState = {
  // ... existing fields ...
  advertisements: [],
  adSlots: 1,
  lastAdRefresh: 0,
};
```

- [ ] **Step 5: Update GameActions interface**

```typescript
export interface GameActions {
  // ... existing fields ...
  refreshAdvertisement: () => void;
  assignAdToLicense: (adId: string, licenseId: string) => void;
  buyAdSlot: () => void;
}
```

- [ ] **Step 6: Commit**

---

### Task 2: Update Game State Logic

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts`

- [ ] **Step 1: Add ad name generator**

```typescript
const adNames = ['Premium Hosting', 'FastNet', 'CloudPro', 'WebSpeed', 'MegaHost', 'TurboSite', 'QuickLoad', 'SuperWeb', 'EliteHost', 'UltraNet'];
const adAdjectives = ['Plus', 'Max', 'Ultra', 'Super', 'Mega', 'Pro', 'Premium', 'Elite', 'Prime', 'Elite'];

const generateAdName = (): string => {
  const name = adNames[Math.floor(Math.random() * adNames.length)];
  const adj = adAdjectives[Math.floor(Math.random() * adAdjectives.length)];
  return `${adj} ${name}`;
};
```

- [ ] **Step 2: Add adSlotCost constant**

```typescript
const getAdSlotCost = (currentSlots: number): number => {
  return Math.floor(10000 * Math.pow(2, currentSlots - 1));
};
```

- [ ] **Step 3: Add refreshAdvertisement action**

```typescript
const refreshAdvertisement = useCallback(() => {
  setState(prev => {
    const now = Date.now();
    const cooldown = 5 * 60 * 1000; // 5 minutes
    
    if (now - prev.lastAdRefresh < cooldown) {
      return prev; // Still cooling down
    }
    
    // Check if we can add more ads
    if (prev.advertisements.length >= prev.adSlots) {
      // Replace existing ad (first one)
    }
    
    const volume = Math.floor(Math.random() * 5) + 1; // 1-5
    const margin = Math.floor(Math.random() * 5) + 1; // 1-5
    
    const baseCost = volume * 1024; // volume in KB/s
    const baseIncome = margin * 0.001; // $/KB
    
    const newAd: Advertisement = {
      id: crypto.randomUUID(),
      name: generateAdName(),
      volume,
      margin,
      cost: baseCost,
      incomePerKB: baseIncome,
      licenseId: '',
    };
    
    // If we have room, add. If full, replace first.
    let newAds: Advertisement[];
    if (prev.advertisements.length < prev.adSlots) {
      newAds = [...prev.advertisements, newAd];
    } else {
      newAds = [newAd, ...prev.advertisements.slice(1)];
    }
    
    return {
      ...prev,
      advertisements: newAds,
      lastAdRefresh: now,
    };
  });
}, []);
```

- [ ] **Step 4: Add assignAdToLicense action**

```typescript
const assignAdToLicense = useCallback((adId: string, licenseId: string) => {
  setState(prev => {
    const ad = prev.advertisements.find(a => a.id === adId);
    if (!ad) return prev;
    
    // If unassigning (empty licenseId), just update
    if (!licenseId) {
      return {
        ...prev,
        advertisements: prev.advertisements.map(a =>
          a.id === adId ? { ...a, licenseId: '' } : a
        ),
      };
    }
    
    const license = prev.licenses.find(l => l.id === licenseId);
    if (!license || !license.unlocked) return prev;
    
    // Calculate capacity used by OTHER ads on this license (excluding this ad)
    const otherAdsOnLicense = prev.advertisements
      .filter(a => a.id !== adId && a.licenseId === licenseId)
      .reduce((sum, a) => sum + a.cost, 0);
    
    const cap = calculateCap(license, license.level);
    const available = cap - otherAdsOnLicense;
    
    if (ad.cost > available) return prev; // Not enough capacity
    
    return {
      ...prev,
      advertisements: prev.advertisements.map(a =>
        a.id === adId ? { ...a, licenseId } : a
      ),
    };
  });
}, []);
```

- [ ] **Step 5: Add buyAdSlot action**

```typescript
const buyAdSlot = useCallback(() => {
  setState(prev => {
    const cost = getAdSlotCost(prev.adSlots);
    if (prev.money < cost) return prev;
    if (prev.advertisements.length >= prev.adSlots) return prev; // Already at max
    
    return {
      ...prev,
      money: prev.money - cost,
      adSlots: prev.adSlots + 1,
    };
  });
}, []);
```

- [ ] **Step 6: Add computeDerivedState helper**

```typescript
const computeDerivedValues = (state: GameState) => {
  // Calculate adAllocated per license
  const licensesWithAds = state.licenses.map(license => {
    const adUsage = state.advertisements
      .filter(a => a.licenseId === license.id)
      .reduce((sum, a) => sum + a.cost, 0);
    return { ...license, adAllocated: adUsage };
  });
  
  // Calculate regular bandwidth (total - ad usage)
  const regularBandwidth = licensesWithAds.map(l => {
    const cap = calculateCap(l, l.level);
    const regularKB = Math.max(0, cap - l.adAllocated);
    return { ...l, regularKB };
  });
  
  // Calculate ad income
  const adIncome = state.advertisements
    .filter(a => a.licenseId)
    .reduce((sum, a) => sum + (a.cost * a.incomePerKB), 0);
  
  // Calculate regular income
  const regularIncome = regularBandwidth
    .filter(l => l.unlocked)
    .reduce((sum, l) => sum + (l.regularKB * l.incomePerKB), 0);
  
  return {
    licensesWithAds,
    regularBandwidth,
    adIncome,
    regularIncome,
    totalIncome: adIncome + regularIncome,
  };
};
```

- [ ] **Step 7: Update income calculation to include ads**

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    setState(prev => {
      const derived = computeDerivedValues(prev);
      
      return {
        ...prev,
        money: prev.money + derived.totalIncome,
        incomePerSecond: derived.totalIncome,
        // Update licenses with ad usage tracked
        licenses: derived.licensesWithAds,
      };
    });
  }, 1000);
  
  return () => clearInterval(interval);
}, []);
```

- [ ] **Step 8: Commit**

---

### Task 3: Update Hosting Tab UI

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/GameUI.tsx`

- [ ] **Step 1: Add AdSlotsSection component**

```tsx
interface AdSlotsSectionProps {
  advertisements: Advertisement[];
  adSlots: number;
  lastAdRefresh: number;
  onRefreshAd: () => void;
  onAssignAd: (adId: string, licenseId: string) => void;
  licenses: License[];
}

function AdSlotsSection({ advertisements, adSlots, lastAdRefresh, onRefreshAd, onAssignAd, licenses }: AdSlotsSectionProps) {
  const [timeLeft, setTimeLeft] = useState(0);
  
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
  
  return (
    <div className="ad-slots-section">
      <div className="ad-header">
        <h3 className="heading-label">Advertisement Slots ({advertisements.length}/{adSlots})</h3>
        <button 
          className="btn btn-secondary" 
          disabled={!canRefresh}
          onClick={onRefreshAd}
        >
          {canRefresh ? 'Find New Ad' : `Wait ${minutes}:${seconds.toString().padStart(2, '0')}`}
        </button>
      </div>
      
      {advertisements.map(ad => {
        const assignedLicense = licenses.find(l => l.id === ad.licenseId);
        const adIncome = ad.licenseId ? (ad.cost * ad.incomePerKB) : 0;
        
        return (
          <div key={ad.id} className="ad-slot">
            <span className="ad-name">{ad.name}</span>
            <span className="ad-stars">Vol: {'★'.repeat(ad.volume)}{'☆'.repeat(5-ad.volume)}</span>
            <span className="ad-stars">Mar: {'★'.repeat(ad.margin)}{'☆'.repeat(5-ad.margin)}</span>
            <span className="ad-cost">-{formatBandwidth(ad.cost)}</span>
            <span className="ad-income">+${adIncome.toFixed(2)}/s</span>
            <select 
              value={ad.licenseId} 
              onChange={(e) => onAssignAd(ad.id, e.target.value)}
            >
              <option value="">Unassigned</option>
              {licenses.filter(l => l.unlocked).map(l => {
                const cap = calculateCap(l.baseCap, l.capPerLevel, l.level);
                const otherAds = advertisements
                  .filter(a => a.id !== ad.id && a.licenseId === l.id)
                  .reduce((sum, a) => sum + a.cost, 0);
                const available = cap - otherAds;
                return (
                  <option key={l.id} value={l.id} disabled={available < ad.cost}>
                    {l.name} ({formatBandwidth(available)} free)
                  </option>
                );
              })}
            </select>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Update HostingTabProps**

```typescript
interface HostingTabProps {
  // ... existing fields ...
  advertisements: Advertisement[];
  adSlots: number;
  lastAdRefresh: number;
  onRefreshAd: () => void;
  onAssignAd: (adId: string, licenseId: string) => void;
}
```

- [ ] **Step 3: Add AdSlotsSection to HostingTab**

Add at the top of HostingTab, before the bandwidth summary.

- [ ] **Step 4: Update license display to show remaining bandwidth**

In the license row, show: regular allocated + "/" + (cap - adAllocated) for available

- [ ] **Step 5: Commit**

---

### Task 4: Add CSS Styles

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/GameUI.css`

- [ ] **Step 1: Add ad-slots-section styles**

```css
.ad-slots-section {
  padding: 16px;
  background: var(--bg-secondary, #1a1a2e);
  border-radius: 8px;
  margin-bottom: 20px;
}

.ad-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.ad-slot {
  display: grid;
  grid-template-columns: 1fr 80px 80px 80px 80px 180px;
  gap: 12px;
  align-items: center;
  padding: 12px;
  background: var(--bg-tertiary, #16162a);
  border-radius: 8px;
  margin-top: 8px;
}

.ad-name {
  font-weight: 600;
  font-size: 14px;
}

.ad-stars {
  font-size: 11px;
  color: var(--color-primary, #4a9eff);
}

.ad-cost {
  font-size: 12px;
  color: var(--color-warning, #ffaa00);
}

.ad-income {
  font-size: 12px;
  color: var(--color-success, #4aff4a);
}
```

- [ ] **Step 2: Commit**

---

### Task 5: Run and Verify

**Files:**
- Test: `src/Brmble.Web`

- [ ] **Step 1: Run build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 2: Run client**

Run: `dotnet run --project src/Brmble.Client`
Expected: Game loads with ad slots in Hosting tab

- [ ] **Step 3: Verify functionality**
- Click "Find New Ad" generates random ad
- Assign ad to license works
- Unassign ad works (select "Unassigned")
- Cannot assign if not enough capacity
- Income increases with ads
- Slider max decreases when ad assigned
- Cooldown timer counts down in real-time
- Show ad income contribution

- [ ] **Step 4: Commit**
