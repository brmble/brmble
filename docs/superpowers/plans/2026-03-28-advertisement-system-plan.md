# Advertisement System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add advertisement system with ad types, license bonuses, and stacking efficiency

**Architecture:** Add Advertisement types with type/margin/volume, state logic with 60% rule, and UI to existing Game component

**Tech Stack:** React, TypeScript

---

## File Structure

**Modify:**
- `src/Brmble.Web/src/components/Game/types.ts` - Advertisement interface with type, update License/GameState
- `src/Brmble.Web/src/components/Game/useGameState.ts` - Ad state logic with stacking efficiency, license bonuses
- `src/Brmble.Web/src/components/Game/GameUI.tsx` - Hosting tab with ad slots, license bonuses display
- `src/Brmble.Web/src/components/Game/GameUI.css` - Ad slot styles

---

### Task 1: Update Types

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/types.ts`

- [ ] **Step 1: Add AdType enum**

```typescript
export type AdType = 'video' | 'banner' | 'popup' | 'sponsored';
```

- [ ] **Step 2: Add Advertisement interface**

```typescript
export interface Advertisement {
  id: string;
  name: string;
  type: AdType;
  volume: number;      // 1-5 stars (percentage of ad-space)
  margin: number;     // 1-5 stars ($ per KB)
  licenseId: string;  // which license it's assigned to (empty = unassigned)
}
```

- [ ] **Step 3: Update License interface**

```typescript
export interface License {
  // ... existing fields ...
  adAllocated: number; // KB/s used by ads
  bonus: {            // License-specific ad bonuses
    capacityBonus: number;   // e.g., 0.3 for Game Servers = +30%
    marginBonus: number;     // e.g., 0.2 for Blogs = +20%
    efficiencyBonus: number; // e.g., 0.1 = 10% less efficiency penalty
  };
}
```

- [ ] **Step 4: Add ad-related fields to GameState**

```typescript
export interface GameState {
  // ... existing fields ...
  advertisements: Advertisement[];
  adSlots: number;
  lastAdRefresh: number;
}
```

- [ ] **Step 5: Update INITIAL_LICENSES with bonuses**

```typescript
// Add to each license:
bonus: {
  capacityBonus: 0,    // default
  marginBonus: 0,
  efficiencyBonus: 0,
}
// Blog Hosting:
bonus: { capacityBonus: 0, marginBonus: 0.2, efficiencyBonus: 0 } // +20% margin for low volume
// Game Servers:
bonus: { capacityBonus: 0.3, marginBonus: 0, efficiencyBonus: 0 } // +30% capacity for high volume
```

- [ ] **Step 6: Update INITIAL_STATE**

```typescript
export const INITIAL_STATE: GameState = {
  // ... existing fields ...
  advertisements: [],
  adSlots: 1,
  lastAdRefresh: 0,
};
```

- [ ] **Step 7: Update GameActions interface**

```typescript
export interface GameActions {
  // ... existing fields ...
  refreshAdvertisement: () => void;
  assignAdToLicense: (adId: string, licenseId: string) => void;
  buyAdSlot: () => void;
}
```

- [ ] **Step 8: Commit**

---

### Task 2: Update Game State Logic

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts`

- [ ] **Step 1: Add ad type definitions**

```typescript
const AD_TYPES = ['video', 'banner', 'popup', 'sponsored'] as const;

const AD_TYPE_NAMES = {
  video: ['StreamHub', 'VidMax', 'TubePro', 'ClipStream', 'MovieBox'],
  banner: ['AdPlace', 'BannerHub', 'WebAd', 'DisplayNet', 'AdSpot'],
  popup: ['PopGen', 'AdPop', 'SpotPop', 'QuickAd', 'AlertBox'],
  sponsored: ['BrandSync', 'SponsorHub', 'PartnerPro', 'ContentPlus', 'BrandDeal'],
};

const AD_ADJECTIVES = {
  video: ['Pro', 'Plus', 'Max', 'Ultra', 'Elite'],
  banner: ['Basic', 'Standard', 'Prime', 'Premium', 'Plus'],
  popup: ['Quick', 'Fast', 'Swift', 'Rapid', 'Instant'],
  sponsored: ['Premium', 'Exclusive', 'Partner', 'Brand', 'VIP'],
};
```

- [ ] **Step 2: Add helper functions**

```typescript
// Calculate efficiency based on number of ads on same license
const getEfficiency = (adCountOnLicense: number, efficiencyBonus: number = 0): number => {
  const baseEfficiency = adCountOnLicense === 1 ? 1.0 : adCountOnLicense === 2 ? 0.8 : adCountOnLicense === 3 ? 0.6 : 0.4;
  return Math.min(1.0, baseEfficiency + efficiencyBonus);
};

// Calculate effective cap (60% + license bonus)
const getEffectiveCap = (license: License): number => {
  const baseAdCap = 0.6;
  return baseAdCap + license.bonus.capacityBonus;
};

// Check if low volume (1-2 stars)
const isLowVolume = (volume: number): boolean => volume <= 2;

// Check if high volume (4-5 stars)
const isHighVolume = (volume: number): boolean => volume >= 4;
```

- [ ] **Step 3: Add ad name generator**

```typescript
const generateAdName = (type: AdType): string => {
  const names = AD_TYPE_NAMES[type];
  const adj = AD_ADJECTIVES[type];
  const name = names[Math.floor(Math.random() * names.length)];
  const a = adj[Math.floor(Math.random() * adj.length)];
  return `${a} ${name}`;
};
```

- [ ] **Step 4: Add adSlotCost constant**

```typescript
const getAdSlotCost = (currentSlots: number): number => {
  return Math.floor(10000 * Math.pow(2, currentSlots - 1));
};
```

- [ ] **Step 5: Add refreshAdvertisement action**

```typescript
const refreshAdvertisement = useCallback(() => {
  setState(prev => {
    const now = Date.now();
    const cooldown = 5 * 60 * 1000; // 5 minutes
    
    if (now - prev.lastAdRefresh < cooldown) {
      return prev; // Still cooling down
    }
    
    // Random ad type
    const type = AD_TYPES[Math.floor(Math.random() * AD_TYPES.length)];
    const volume = Math.floor(Math.random() * 5) + 1; // 1-5
    const margin = Math.floor(Math.random() * 5) + 1; // 1-5
    
    const newAd: Advertisement = {
      id: crypto.randomUUID(),
      name: generateAdName(type),
      type,
      volume,
      margin,
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

- [ ] **Step 6: Add assignAdToLicense action**

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
    
    // Calculate capacity used by OTHER ads on this license
    const otherAdsOnLicense = prev.advertisements
      .filter(a => a.id !== adId && a.licenseId === licenseId)
      .reduce((sum, a) => sum + getAdVolumeKB(a, license), 0);
    
    const cap = calculateCap(license, license.level);
    const effectiveCap = getEffectiveCap(license);
    const maxAdKB = cap * effectiveCap;
    const available = maxAdKB - otherAdsOnLicense;
    const adKB = getAdVolumeKB(ad, license);
    
    if (adKB > available) return prev; // Not enough capacity
    
    return {
      ...prev,
      advertisements: prev.advertisements.map(a =>
        a.id === adId ? { ...a, licenseId } : a
      ),
    };
  });
}, []);

// Helper to get ad volume in KB
const getAdVolumeKB = (ad: Advertisement, license: License): number => {
  const cap = calculateCap(license, license.level);
  const effectiveCap = getEffectiveCap(license);
  const maxAdKB = cap * effectiveCap;
  const volumePercent = ad.volume / 5; // 0.2 to 1.0
  return maxAdKB * volumePercent;
};
```

- [ ] **Step 7: Add buyAdSlot action**

```typescript
const buyAdSlot = useCallback(() => {
  setState(prev => {
    const cost = getAdSlotCost(prev.adSlots);
    if (prev.money < cost) return prev;
    if (prev.advertisements.length >= prev.adSlots) return prev;
    
    return {
      ...prev,
      money: prev.money - cost,
      adSlots: prev.adSlots + 1,
    };
  });
}, []);
```

- [ ] **Step 8: Add computeDerivedState helper**

```typescript
const computeDerivedValues = (state: GameState) => {
  // Calculate ad usage per license
  const licensesWithAds = state.licenses.map(license => {
    const adsOnLicense = state.advertisements.filter(a => a.licenseId === license.id);
    const adUsage = adsOnLicense.reduce((sum, ad) => sum + getAdVolumeKB(ad, license), 0);
    return { ...license, adAllocated: adUsage };
  });
  
  // Calculate income
  let totalAdIncome = 0;
  let totalRegularIncome = 0;
  
  for (const license of licensesWithAds) {
    if (!license.unlocked) continue;
    
    const cap = calculateCap(license, license.level);
    const effectiveCap = getEffectiveCap(license);
    const maxAdKB = cap * effectiveCap;
    const adsOnLicense = state.advertisements.filter(a => a.licenseId === license.id);
    
    // Calculate ad income with stacking efficiency
    for (let i = 0; i < adsOnLicense.length; i++) {
      const ad = adsOnLicense[i];
      const efficiency = getEfficiency(i + 1, license.bonus.efficiencyBonus);
      const volumeKB = getAdVolumeKB(ad, license);
      
      // Calculate margin with license bonus
      let marginRate = ad.margin * 0.001; // Base rate
      if (isLowVolume(ad.volume) && license.bonus.marginBonus > 0) {
        marginRate *= (1 + license.bonus.marginBonus);
      }
      
      // Efficiency only affects margin, not volume
      const effectiveMargin = marginRate * efficiency;
      
      totalAdIncome += volumeKB * effectiveMargin;
    }
    
    // Regular hosting income (cap - ad usage, but minimum 40% remains)
    const minContent = cap * 0.4;
    const regularKB = Math.max(0, cap - license.adAllocated - minContent);
    totalRegularIncome += regularKB * license.incomePerKB;
  }
  
  return {
    licensesWithAds,
    adIncome: totalAdIncome,
    regularIncome: totalRegularIncome,
    totalIncome: totalAdIncome + totalRegularIncome,
  };
};
```

- [ ] **Step 9: Update income calculation useEffect**

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    setState(prev => {
      const derived = computeDerivedValues(prev);
      
      return {
        ...prev,
        money: prev.money + derived.totalIncome,
        incomePerSecond: derived.totalIncome,
        licenses: derived.licensesWithAds,
      };
    });
  }, 1000);
  
  return () => clearInterval(interval);
}, []);
```

- [ ] **Step 10: Commit**

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
  
  const getAdVolumeKB = (ad: Advertisement, license: License): number => {
    const cap = calculateCap(license.baseCap, license.capPerLevel, license.level);
    const effectiveCap = 0.6 + license.bonus.capacityBonus;
    const maxAdKB = cap * effectiveCap;
    return maxAdKB * (ad.volume / 5);
  };
  
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
      
      {advertisements.map((ad, index) => {
        const assignedLicense = licenses.find(l => l.id === ad.licenseId);
        const adsOnSameLicense = advertisements.filter(a => a.licenseId === ad.licenseId && a.id !== ad.id).length + 1;
        const efficiency = adsOnSameLicense === 1 ? 1.0 : adsOnSameLicense === 2 ? 0.8 : adsOnSameLicense === 3 ? 0.6 : 0.4;
        
        return (
          <div key={ad.id} className="ad-slot">
            <span className="ad-type">{ad.type}</span>
            <span className="ad-name">{ad.name}</span>
            <span className="ad-stars">Vol: {'★'.repeat(ad.volume)}{'☆'.repeat(5-ad.volume)}</span>
            <span className="ad-stars">Mar: {'★'.repeat(ad.margin)}{'☆'.repeat(5-ad.margin)}</span>
            <span className="ad-efficiency">{Math.round(efficiency * 100)}%</span>
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
                return (
                  <option key={l.id} value={l.id} disabled={available < adKB}>
                    {l.name} ({formatBandwidth(Math.max(0, available))} ad space)
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

- [ ] **Step 4: Update license display**

Show: regular allocated + "/" + maxAdSpace + " (" + adsOnLicense + " ads)"

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
  grid-template-columns: 80px 1fr 80px 80px 80px 180px;
  gap: 12px;
  align-items: center;
  padding: 12px;
  background: var(--bg-tertiary, #16162a);
  border-radius: 8px;
  margin-top: 8px;
}

.ad-type {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--color-primary, #4a9eff);
}

.ad-name {
  font-weight: 600;
  font-size: 14px;
}

.ad-stars {
  font-size: 11px;
  color: var(--text-muted, #888);
}

.ad-efficiency {
  font-size: 12px;
  color: var(--color-warning, #ffaa00);
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
- Click "Find New Ad" generates random ad with type
- Ad shows type, volume stars, margin stars
- Assign ad to license works
- Show stacking efficiency percentage
- Unassign ad works
- Cannot assign if not enough ad-space (60% limit)
- Income calculation correct with efficiency penalty
- License bonuses apply correctly

- [ ] **Step 4: Commit**
