# Advertisement System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add advertisement system to game - ads placed on licenses take bandwidth and sell at higher rates

**Architecture:** Add Advertisement types, state logic, and UI to existing Game component. License capacity is split between regular hosting and ads.

**Tech Stack:** React, TypeScript

---

## File Structure

**Modify:**
- `src/Brmble.Web/src/components/Game/types.ts` - Advertisement interface, update License/GameState
- `src/Brmble.Web/src/components/Game/useGameState.ts` - Ad state logic, refresh timer
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
  licenseId: string;  // which license it's assigned to
}
```

- [ ] **Step 2: Update License interface to track ads**

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

- [ ] **Step 2: Add refreshAdvertisement action**

```typescript
const refreshAdvertisement = useCallback(() => {
  setState(prev => {
    const now = Date.now();
    const cooldown = 5 * 60 * 1000; // 5 minutes
    
    if (now - prev.lastAdRefresh < cooldown) {
      return prev; // Still cooling down
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
    
    return {
      ...prev,
      advertisements: [newAd],
      lastAdRefresh: now,
    };
  });
}, []);
```

- [ ] **Step 3: Add assignAdToLicense action**

```typescript
const assignAdToLicense = useCallback((adId: string, licenseId: string) => {
  setState(prev => {
    const ad = prev.advertisements.find(a => a.id === adId);
    if (!ad) return prev;
    
    const license = prev.licenses.find(l => l.id === licenseId);
    if (!license) return prev;
    
    // Check if license has enough capacity
    const currentAdUsage = prev.advertisements
      .filter(a => a.id !== adId && a.licenseId === licenseId)
      .reduce((sum, a) => sum + a.cost, 0);
    
    const cap = calculateCap(license, license.level);
    const available = cap - currentAdUsage;
    
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

- [ ] **Step 4: Add buyAdSlot action**

```typescript
const buyAdSlot = useCallback(() => {
  setState(prev => {
    if (prev.money < adSlotCost) return prev;
    
    return {
      ...prev,
      money: prev.money - adSlotCost,
      adSlots: prev.adSlots + 1,
    };
  });
}, []);
```

- [ ] **Step 5: Update income calculation to include ads**

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    setState(prev => {
      // Regular license income
      const regularIncome = prev.licenses
        .filter(l => l.unlocked)
        .reduce((sum, l) => {
          const cap = calculateCap(l, l.level);
          const adUsage = prev.advertisements
            .filter(a => a.licenseId === l.id)
            .reduce((aSum, a) => aSum + a.cost, 0);
          const availableKB = Math.max(0, cap - adUsage);
          return sum + (availableKB * l.incomePerKB);
        }, 0);
      
      // Ad income
      const adIncome = prev.advertisements
        .filter(a => a.licenseId)
        .reduce((sum, a) => sum + (a.cost * a.incomePerKB), 0);
      
      const totalIncome = regularIncome + adIncome;
      
      return {
        ...prev,
        money: prev.money + totalIncome,
        incomePerSecond: totalIncome,
      };
    });
  }, 1000);
  
  return () => clearInterval(interval);
}, []);
```

- [ ] **Step 6: Commit**

---

### Task 3: Update Hosting Tab UI

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/GameUI.tsx`

- [ ] **Step 1: Add AdSlotsSection component**

```tsx
function AdSlotsSection({ advertisements, adSlots, lastRefresh, onRefresh, onAssign, licenses }: AdSlotsSectionProps) {
  const now = Date.now();
  const cooldown = 5 * 60 * 1000;
  const canRefresh = now - lastRefresh >= cooldown;
  const timeLeft = Math.max(0, cooldown - (now - lastRefresh));
  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);
  
  return (
    <div className="ad-slots-section">
      <h3 className="heading-label">Advertisement Slots ({advertisements.length}/{adSlots})</h3>
      <button 
        className="btn btn-secondary" 
        disabled={!canRefresh}
        onClick={onRefresh}
      >
        {canRefresh ? 'Find New Ad' : `Wait ${minutes}:${seconds.toString().padStart(2, '0')}`}
      </button>
      
      {advertisements.map(ad => (
        <div key={ad.id} className="ad-slot">
          <span className="ad-name">{ad.name}</span>
          <span className="ad-stars">Volume: {'★'.repeat(ad.volume)}{'☆'.repeat(5-ad.volume)}</span>
          <span className="ad-stars">Margin: {'★'.repeat(ad.margin)}{'☆'.repeat(5-ad.margin)}</span>
          <span className="ad-cost">-{formatBandwidth(ad.cost)}</span>
          <select 
            value={ad.licenseId} 
            onChange={(e) => onAssign(ad.id, e.target.value)}
          >
            <option value="">Select license...</option>
            {licenses.filter(l => l.unlocked).map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      ))}
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

- [ ] **Step 4: Commit**

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

.ad-slot {
  display: grid;
  grid-template-columns: 1fr 120px 120px 100px 150px;
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
  font-size: 12px;
  color: var(--color-primary, #4a9eff);
}

.ad-cost {
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
- Click "Find New Ad" generates random ad
- Assign ad to license works
- Income increases with ads
- Slider max decreases when ad assigned

- [ ] **Step 4: Commit**
