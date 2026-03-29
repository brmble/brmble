# Ad System Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement complete ad system overhaul with strategic investment gameplay - passive income, margin income, breach fees, progress tracking, and cancel functionality.

**Architecture:** Ads have 4 properties (volume, margin, passiveIncome, timeLimitMs). Income has 3 components: passive $/sec while active, margin $/KB paid at completion, and breach fee for early cancel. Progress calculated from elapsed × license.allocated bandwidth.

**Tech Stack:** React + TypeScript (frontend), Vitest (tests), localStorage (persistence)

---

## File Structure

### Modified Files
- `src/Brmble.Web/src/components/Game/types.ts` - Update interfaces
- `src/Brmble.Web/src/components/Game/useGameState.ts` - Core game logic
- `src/Brmble.Web/src/components/Game/useGameState.test.ts` - Unit tests
- `src/Brmble.Web/src/components/Game/GameUI.tsx` - UI components
- `src/Brmble.Web/src/components/Game/GameUI.css` - Styles

---

## Phase 1: Type Definitions

### Task 1: Update Advertisement Interface

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/types.ts:1-15`

- [ ] **Step 1: Update Advertisement interface**

```typescript
export interface Advertisement {
  id: string;
  name: string;
  type: AdType;
  volume: number;           // 1-5 stars (KB to process)
  margin: number;          // 1-5 stars (profit per KB)
  passiveIncome: number;   // 1-5 stars (fixed $/sec while active)
  timeLimitMs: number;     // deadline in ms
  licenseId: string;
  buyPrice: number;        // cost to "invest"
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No errors (no other files reference this yet)

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/types.ts
git commit -m "feat: update Advertisement interface for new ad system"
```

---

### Task 2: Update ActiveInvestment Interface

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/types.ts:17-25`

- [ ] **Step 1: Update ActiveInvestment interface**

```typescript
export interface ActiveInvestment {
  adId: string;
  licenseId: string;
  startTime: number;
  volumeKB: number;              // total KB to process
  passiveIncomePerSec: number;   // $/sec earned while active
  marginPerKB: number;          // $/KB earned at completion
  buyPrice: number;              // initial investment cost
  breachFee: number;             // cost to cancel early
  expectedTotalPayout: number;   // for breach calculation
  status: InvestmentStatus;
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/types.ts
git commit -m "feat: update ActiveInvestment interface"
```

---

## Phase 2: Core Game Logic

### Task 3: Weighted Random Helper

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts:1-50`

- [ ] **Step 1: Add weighted random helper functions after imports**

```typescript
// Star rating distribution:
// 1-3 stars: 70-80% total (~23-27% each)
// 4 stars: 15-20%
// 5 stars: 5-10%

const STAR_WEIGHTS = [
  { stars: 1, weight: 0.25 },
  { stars: 2, weight: 0.25 },
  { stars: 3, weight: 0.28 },
  { stars: 4, weight: 0.15 },
  { stars: 5, weight: 0.07 },
];

function getWeightedStarRating(): number {
  const rand = Math.random();
  let cumulative = 0;
  for (const { stars, weight } of STAR_WEIGHTS) {
    cumulative += weight;
    if (rand < cumulative) return stars;
  }
  return 3;
}

// Passive income values by stars ($/sec)
const PASSIVE_INCOME_BY_STARS: Record<number, number> = {
  1: 0.10,
  2: 0.25,
  3: 0.50,
  4: 1.50,
  5: 4.00,
};

// Margin multiplier by stars
const MARGIN_MULTIPLIER_BY_STARS: Record<number, number> = {
  1: 0.8,
  2: 1.0,
  3: 1.2,
  4: 1.6,
  5: 2.5,
};

// Volume KB by stars (base, scales with highest unlocked tier)
const VOLUME_KB_BY_STARS: Record<number, number> = {
  1: 512,
  2: 1024,
  3: 2048,
  4: 4096,
  5: 8192,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/Game/useGameState.ts
git commit -m "feat: add weighted random helpers for ad generation"
```

---

### Task 4: Update generateAdOptions

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts:451-469`

- [ ] **Step 1: Update generateAdOptions function**

Replace the current implementation:

```typescript
const generateAdOptions = useCallback((): Advertisement[] => {
  const options: Advertisement[] = [];
  
  // Find highest tier unlocked for scaling volume
  const highestTier = Math.max(...state.licenses
    .filter(l => l.unlocked)
    .map(l => l.tier));
  
  const tierMultiplier = Math.pow(2, highestTier - 1);
  
  for (let i = 0; i < 3; i++) {
    const type = AD_TYPES[Math.floor(Math.random() * AD_TYPES.length)];
    const volume = getWeightedStarRating();
    const margin = getWeightedStarRating();
    const passiveIncome = getWeightedStarRating();
    
    // Calculate volume KB scaled by tier
    const volumeKB = VOLUME_KB_BY_STARS[volume] * tierMultiplier;
    
    // Calculate time limit: volumeKB / 1024 KB/s base * random factor
    const baseSeconds = volumeKB / 1024;
    const randomFactor = 0.7 + Math.random() * 0.6; // 0.7 to 1.3
    const timeLimitMs = Math.floor(baseSeconds * randomFactor * 1000);
    
    // Calculate buy price (20-30% of expected payout)
    const passivePerSec = PASSIVE_INCOME_BY_STARS[passiveIncome];
    const marginMult = MARGIN_MULTIPLIER_BY_STARS[margin];
    
    // Estimate duration for passive income calc
    const estimatedDurationSec = volumeKB / 1024; // rough estimate
    const expectedPassive = passivePerSec * estimatedDurationSec;
    const expectedMargin = volumeKB * 0.001 * marginMult; // base incomePerKB * marginMult
    const expectedTotal = expectedPassive + expectedMargin;
    
    const buyPrice = expectedTotal * (0.20 + Math.random() * 0.10);
    
    options.push({
      id: crypto.randomUUID(),
      name: generateAdName(type),
      type,
      volume,
      margin,
      passiveIncome,
      volumeKB,
      timeLimitMs,
      licenseId: '',
      buyPrice: Math.round(buyPrice * 100) / 100,
    });
  }
  return options;
}, [state.licenses]);
```

- [ ] **Step 2: Run tests**

Run: `cd src/Brmble.Web && npm test -- --run src/components/Game/useGameState.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/useGameState.ts
git commit -m "feat: update generateAdOptions with new ad system"
```

---

### Task 5: Update startInvestment

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts:530-580`

- [ ] **Step 1: Update startInvestment to calculate investment values**

```typescript
const startInvestment = useCallback((adId: string, licenseId: string) => {
  setState(prev => {
    const ad = prev.advertisements.find(a => a.id === adId);
    if (!ad) return prev;
    
    const license = prev.licenses.find(l => l.id === licenseId);
    if (!license || !license.unlocked) return prev;
    
    // Check tier max volume
    const maxVolume = (TIER_MAX_VOLUME as Record<number, number>)[license.tier] ?? 2;
    if (ad.volume > maxVolume) return prev;
    
    // Check for existing investment on this ad
    const hasRunningForAd = prev.activeInvestments.some(
      i => i.adId === adId && i.status === 'running'
    );
    if (hasRunningForAd) return prev;
    
    // Check for running investment on this license
    const hasRunningForLicense = prev.activeInvestments.some(
      i => i.licenseId === licenseId && i.status === 'running'
    );
    if (hasRunningForLicense) return prev;
    
    // Calculate investment values
    const passivePerSec = PASSIVE_INCOME_BY_STARS[ad.passiveIncome];
    const marginMult = MARGIN_MULTIPLIER_BY_STARS[ad.margin];
    const marginPerKB = license.incomePerKB * marginMult;
    
    // Expected payout for breach calculation
    const expectedDurationSec = ad.volumeKB / Math.max(license.allocated, 1);
    const expectedPassive = passivePerSec * expectedDurationSec;
    const expectedMargin = ad.volumeKB * marginPerKB;
    const expectedTotal = expectedPassive + expectedMargin;
    
    // Breach fee = buy price + 20% penalty
    const breachFee = ad.buyPrice + (expectedTotal * 0.20);
    
    if (prev.money < ad.buyPrice) return prev;
    
    const newInvestment: ActiveInvestment = {
      adId,
      licenseId,
      startTime: Date.now(),
      volumeKB: ad.volumeKB,
      passiveIncomePerSec: passivePerSec,
      marginPerKB,
      buyPrice: ad.buyPrice,
      breachFee: Math.round(breachFee * 100) / 100,
      expectedTotalPayout: Math.round(expectedTotal * 100) / 100,
      status: 'running',
    };
    
    return {
      ...prev,
      money: prev.money - ad.buyPrice,
      activeInvestments: [...prev.activeInvestments, newInvestment],
      advertisements: prev.advertisements.map(a =>
        a.id === adId ? { ...a, licenseId } : a
      ),
    };
  });
}, []);
```

- [ ] **Step 2: Run tests**

Run: `cd src/Brmble.Web && npm test -- --run src/components/Game/useGameState.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/useGameState.ts
git commit -m "feat: update startInvestment with breach fee calculation"
```

---

### Task 6: Add cancelInvestment Action

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts` (add after collectInvestment)

- [ ] **Step 1: Add cancelInvestment function**

Add this after the `collectInvestment` function:

```typescript
const cancelInvestment = useCallback((adId: string) => {
  setState(prev => {
    const investment = prev.activeInvestments.find(i => i.adId === adId);
    if (!investment || investment.status !== 'running') return prev;
    
    const elapsedSec = (Date.now() - investment.startTime) / 1000;
    const passiveEarned = elapsedSec * investment.passiveIncomePerSec;
    
    const newMoney = prev.money - investment.breachFee + passiveEarned;
    
    return {
      ...prev,
      money: Math.max(0, newMoney),
      activeInvestments: prev.activeInvestments.filter(i => i.adId !== adId),
      advertisements: prev.advertisements.filter(a => a.id !== adId),
    };
  });
}, []);
```

- [ ] **Step 2: Add to GameActions interface in types.ts**

```typescript
cancelInvestment: (adId: string) => void;
```

- [ ] **Step 3: Add to actions object in useGameState.ts**

```typescript
const actions: GameActions = {
  // ... existing actions
  cancelInvestment,
};
```

- [ ] **Step 4: Run tests**

Run: `cd src/Brmble.Web && npm test -- --run src/components/Game/useGameState.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Game/useGameState.ts src/Brmble.Web/src/components/Game/types.ts
git commit -m "feat: add cancelInvestment action"
```

---

### Task 7: Update collectInvestment

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts:554-568`

- [ ] **Step 1: Update collectInvestment to include margin income**

Replace the current implementation:

```typescript
const collectInvestment = useCallback((adId: string) => {
  setState(prev => {
    const investment = prev.activeInvestments.find(i => i.adId === adId);
    if (!investment || investment.status !== 'ready') return prev;
    
    // Calculate passive income earned
    const elapsedSec = (Date.now() - investment.startTime) / 1000;
    const passiveEarned = elapsedSec * investment.passiveIncomePerSec;
    
    // Calculate margin income (full payout since completed)
    const marginEarned = investment.volumeKB * investment.marginPerKB;
    
    const totalPayout = passiveEarned + marginEarned;
    
    return {
      ...prev,
      money: prev.money + totalPayout,
      activeInvestments: prev.activeInvestments.filter(i => i.adId !== adId),
      advertisements: prev.advertisements.filter(ad => ad.id !== adId),
    };
  });
}, []);
```

- [ ] **Step 2: Run tests**

Run: `cd src/Brmble.Web && npm test -- --run src/components/Game/useGameState.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/useGameState.ts
git commit -m "feat: update collectInvestment to include margin payout"
```

---

### Task 8: Update Income Ticker for Passive Income

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts:168-232`

- [ ] **Step 1: Review current income ticker logic**

The current income ticker handles passive ad income. We need to ensure it:
1. Skips ads with running investments (they have their own passive income tracking)
2. Correctly calculates income for non-investment ads

Read the current implementation around line 168.

- [ ] **Step 2: No changes needed**

The current income ticker already:
- Skips ads with running investments ✓
- Uses `license.allocated` for bandwidth ✓
- Calculates income per KB ✓

The passive income from investments will be tracked separately in the UI (calculated on render from startTime and elapsed time).

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: verify income ticker handles new system correctly"
```

---

### Task 9: Update Time Limit Expiration Logic

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts:597-625`

- [ ] **Step 1: Update investment timer to check time limit**

Read the current investment interval around line 597.

- [ ] **Step 2: Update the interval to track time limit**

Replace the investment timer interval with:

```typescript
const interval = setInterval(() => {
  setState(prev => {
    const now = Date.now();
    let hasChanges = false;
    
    const updatedInvestments = prev.activeInvestments.map(inv => {
      if (inv.status !== 'running') return inv;
      
      const elapsed = now - inv.startTime;
      
      // Check time limit
      if (elapsed >= inv.volumeKB * 1000) { // Simplified: 1 KB per second base
        hasChanges = true;
        return { ...inv, status: 'ready' as InvestmentStatus };
      }
      
      return inv;
    });
    
    if (!hasChanges) return prev;
    return { ...prev, activeInvestments: updatedInvestments };
  });
}, 1000);
```

Wait, the time limit should be based on the ad's `timeLimitMs`, not calculated from volume. Update to:

```typescript
useEffect(() => {
  if (!hasRunningInvestments) return;
  
  const interval = setInterval(() => {
    setState(prev => {
      const now = Date.now();
      let hasChanges = false;
      
      const updatedInvestments = prev.activeInvestments.map(inv => {
        if (inv.status !== 'running') return inv;
        
        // Find the ad to check its time limit
        const ad = prev.advertisements.find(a => a.id === inv.adId);
        if (!ad) return inv;
        
        const elapsed = now - inv.startTime;
        
        // Check time limit from ad
        if (elapsed >= ad.timeLimitMs) {
          hasChanges = true;
          return { ...inv, status: 'ready' as InvestmentStatus };
        }
        
        return inv;
      });
      
      if (!hasChanges) return prev;
      return { ...prev, activeInvestments: updatedInvestments };
    });
  }, 1000);
  
  return () => clearInterval(interval);
}, [hasRunningInvestments]);
```

- [ ] **Step 3: Run tests**

Run: `cd src/Brmble.Web && npm test -- --run src/components/Game/useGameState.test.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Game/useGameState.ts
git commit -m "feat: add time limit enforcement for investments"
```

---

## Phase 3: UI Components

### Task 10: Update AdSelectionModal

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/GameUI.tsx:549-704`

- [ ] **Step 1: Update ad card display**

Replace the ad card content with:

```tsx
{options.map(ad => {
  const selectedLicenseId = selectedLicenses[ad.id] || '';
  const selectedLicense = licenses.find(l => l.id === selectedLicenseId);
  const canAfford = money >= ad.buyPrice;
  const hasCapacity = selectedLicense ? getAvailableKB(selectedLicense) >= ad.volumeKB : false;

  const passivePerSec = PASSIVE_INCOME_BY_STARS[ad.passiveIncome];
  const marginMult = MARGIN_MULTIPLIER_BY_STARS[ad.margin];

  const formatTimeLimit = (ms: number) => {
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const renderStars = (count: number) => '★'.repeat(count) + '☆'.repeat(5 - count);

  return (
    <div key={ad.id} className="ad-card">
      <span className="ad-card-type">{ad.type}</span>
      <span className="ad-card-name">{ad.name}</span>
      
      <div className="ad-card-stats">
        <span>Volume: {renderStars(ad.volume)}</span>
        <span>Margin: {renderStars(ad.margin)}</span>
        <span>Passive Income: ${passivePerSec.toFixed(2)}/s {renderStars(ad.passiveIncome)}</span>
        <span>Time Limit: {formatTimeLimit(ad.timeLimitMs)}</span>
      </div>
      
      <div className="ad-card-license-select">
        {/* existing license select */}
      </div>

      <button 
        className="btn btn-primary invest-btn" 
        onClick={() => handleInvest(ad)}
        disabled={!selectedLicenseId || !canAfford || !hasCapacity}
      >
        {selectedLicenseId 
          ? (canAfford ? `Invest $${ad.buyPrice.toFixed(2)}` : 'Insufficient Funds')
          : 'Select Hosting First'}
      </button>
    </div>
  );
})}
```

- [ ] **Step 2: Run build**

Run: `cd src/Brmble.Web && npm run build`
Expected: Compiles without errors

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/GameUI.tsx
git commit -m "feat: update AdSelectionModal with new ad display"
```

---

### Task 11: Update AdSlotsSection with Progress

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/GameUI.tsx:706-844`

- [ ] **Step 1: Update ad slot display with progress bars**

Replace the ad slot rendering:

```tsx
{advertisements.map((ad) => {
  const investment = getInvestmentForAd(ad.id);
  const isRunning = isInvestmentRunning(ad.id);
  const canCollect = isInvestmentReady(ad.id);
  
  const elapsed = isRunning ? Date.now() - (investment?.startTime || 0) : 0;
  const license = licenses.find(l => l.id === ad.licenseId);
  
  // Calculate progress
  let kbProcessed = 0;
  let kbRemaining = ad.volumeKB;
  let progressPct = 0;
  let passiveEarned = 0;
  
  if (investment && license) {
    const allocatedKBps = license.allocated / 1000; // KB per second
    kbProcessed = Math.min(allocatedKBps * (elapsed / 1000), ad.volumeKB);
    kbRemaining = ad.volumeKB - kbProcessed;
    progressPct = (kbProcessed / ad.volumeKB) * 100;
    passiveEarned = (elapsed / 1000) * (investment.passiveIncomePerSec || 0);
  }
  
  const formatKB = (kb: number) => {
    if (kb >= 1073741824) return (kb / 1073741824).toFixed(2) + ' TB';
    if (kb >= 1048576) return (kb / 1048576).toFixed(2) + ' GB';
    if (kb >= 1024) return (kb / 1024).toFixed(2) + ' MB';
    return kb.toFixed(0) + ' KB';
  };
  
  const timeLeft = ad.timeLimitMs - elapsed;
  const formatTime = (ms: number) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div key={ad.id} className={`ad-slot ${isRunning ? 'running' : ''} ${canCollect ? 'ready' : ''}`}>
      <span className="ad-type">{ad.type}</span>
      <span className="ad-name">{ad.name}</span>
      
      {isRunning && (
        <div className="ad-progress">
          <div className="progress-bar-container large">
            <div 
              className="progress-bar-fill" 
              style={{ width: `${Math.min(progressPct, 100)}%` }}
            />
          </div>
          <span className="progress-text">{progressPct.toFixed(1)}%</span>
        </div>
      )}
      
      <div className="ad-stats">
        <span>KB: {formatKB(kbRemaining)} remaining</span>
        {isRunning && <span>Income: ${passiveEarned.toFixed(2)}</span>}
        {isRunning && <span>Time Left: {formatTime(Math.max(0, timeLeft))}</span>}
      </div>
      
      {canCollect ? (
        <button 
          className="btn btn-primary collect-btn"
          onClick={() => onCollectInvestment(ad.id)}
        >
          Collect (${(passiveEarned + (investment?.volumeKB || 0) * (investment?.marginPerKB || 0)).toFixed(2)})
        </button>
      ) : !isRunning && (
        <>
          {ad.licenseId ? (
            <span className="ad-license-name">
              {licenses.find(l => l.id === ad.licenseId)?.name}
            </span>
          ) : (
            <span className="ad-license-name unassigned">Unassigned</span>
          )}
        </>
      )}
      
      {isRunning && (
        <button 
          className="btn btn-danger cancel-btn"
          onClick={() => {
            if (window.confirm(`Cancel investment? This will cost $${investment?.breachFee.toFixed(2)} in breach fees.`)) {
              onCancelInvestment(ad.id);
            }
          }}
        >
          Cancel (${investment?.breachFee.toFixed(2)})
        </button>
      )}
    </div>
  );
})}
```

- [ ] **Step 2: Update props interface**

Add `onCancelInvestment` to AdSlotsSectionProps:

```typescript
interface AdSlotsSectionProps {
  // ... existing props
  onCancelInvestment: (adId: string) => void;
}
```

- [ ] **Step 3: Update GameUI component to pass cancelInvestment**

```typescript
<AdSlotsSection
  // ... existing props
  onCancelInvestment={actions.cancelInvestment}
/>
```

- [ ] **Step 4: Run build**

Run: `cd src/Brmble.Web && npm run build`
Expected: Compiles without errors

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Game/GameUI.tsx
git commit -m "feat: update AdSlotsSection with progress bars"
```

---

### Task 12: Update LicenseRow with Ad Progress

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/GameUI.tsx:857-921`

- [ ] **Step 1: Update LicenseRow to show ad progress**

Add `activeInvestments` prop and update display:

```typescript
interface LicenseRowProps {
  // ... existing props
  activeInvestments: ActiveInvestment[];
  advertisements: Advertisement[];
}

// In the component, add ad progress display
function LicenseRow({ 
  // ... existing props
  activeInvestments,
  advertisements,
}: LicenseRowProps) {
  // Find investment on this license
  const investment = activeInvestments.find(
    i => i.licenseId === license.id && i.status === 'running'
  );
  const ad = investment ? advertisements.find(a => a.id === investment.adId) : null;
  
  // Calculate progress if ad is active
  const elapsed = investment ? Date.now() - investment.startTime : 0;
  const allocatedKBps = license.allocated / 1000;
  const kbProcessed = ad ? Math.min(allocatedKBps * (elapsed / 1000), ad.volumeKB) : 0;
  const progressPct = ad ? (kbProcessed / ad.volumeKB) * 100 : 0;
  
  return (
    <div className="license-row">
      {/* ... existing info */}
      
      {ad && (
        <div className="license-ad-progress">
          <div className="mini-progress-bar">
            <div className="mini-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="ad-name">{ad.name}</span>
          <span className="ad-income">+${investment.passiveIncomePerSec.toFixed(2)}/s</span>
        </div>
      )}
      
      {/* ... slider and upgrade button */}
    </div>
  );
}
```

- [ ] **Step 2: Update HostingTab to pass new props**

```typescript
// In HostingTab component
<LicenseRow
  key={license.id}
  license={license}
  // ... existing props
  activeInvestments={activeInvestments}
  advertisements={advertisements}
/>
```

- [ ] **Step 3: Run build**

Run: `cd src/Brmble.Web && npm run build`
Expected: Compiles without errors

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Game/GameUI.tsx
git commit -m "feat: update LicenseRow with ad progress display"
```

---

### Task 13: Add CSS Styles

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/GameUI.css`

- [ ] **Step 1: Add progress bar and cancel button styles**

Add these styles to GameUI.css:

```css
/* Ad Progress */
.ad-progress {
  margin: 0.5rem 0;
}

.ad-progress .progress-bar-container.large {
  height: 1.5rem;
  background: var(--bg-secondary);
  border-radius: 4px;
  overflow: hidden;
}

.ad-progress .progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary));
  transition: width 0.3s ease;
}

.ad-stats {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.ad-stats span {
  display: flex;
  justify-content: space-between;
}

/* Cancel Button */
.cancel-btn {
  background: var(--danger, #dc3545);
  color: white;
  margin-top: 0.5rem;
  width: 100%;
}

/* License Ad Progress */
.license-ad-progress {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.5rem 0;
  padding: 0.5rem;
  background: var(--bg-tertiary);
  border-radius: 4px;
}

.mini-progress-bar {
  flex: 1;
  height: 0.5rem;
  background: var(--bg-secondary);
  border-radius: 2px;
  overflow: hidden;
}

.mini-progress-fill {
  height: 100%;
  background: var(--accent-primary);
  transition: width 0.3s ease;
}

.license-ad-progress .ad-name {
  font-size: 0.8rem;
  color: var(--text-primary);
}

.license-ad-progress .ad-income {
  font-size: 0.8rem;
  color: var(--income, #28a745);
}

/* Ad Card Stats */
.ad-card-stats {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--bg-tertiary);
  border-radius: 4px;
  margin: 0.5rem 0;
}

.ad-card-stats span {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
}
```

- [ ] **Step 2: Run build**

Run: `cd src/Brmble.Web && npm run build`
Expected: Compiles without errors

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/GameUI.css
git commit -m "feat: add CSS styles for ad progress bars"
```

---

## Phase 4: Testing & Integration

### Task 14: Update Tests

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.test.ts`

- [ ] **Step 1: Update test save objects with new fields**

All test saves need `volumeKB` on ads. Update the tests to include the new ad structure.

- [ ] **Step 2: Run all tests**

Run: `cd src/Brmble.Web && npm test -- --run src/components/Game/useGameState.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/useGameState.test.ts
git commit -m "test: update tests for new ad system"
```

---

### Task 15: Integration Test

**Files:**
- Test in browser

- [ ] **Step 1: Build and copy to client**

```bash
cd src/Brmble.Web && npm run build
cp -r dist/* src/Brmble.Client/bin/Debug/net10.0-windows/web/
```

- [ ] **Step 2: Run client**

```bash
dotnet run --project src/Brmble.Client/Brmble.Client.csproj
```

- [ ] **Step 3: Manual verification checklist**

- [ ] Click "Find New Ad" - see 3 options with stars
- [ ] Each ad shows Volume, Margin, Passive Income, Time Limit
- [ ] Select a hosting license
- [ ] Click Invest - money deducted
- [ ] Ad appears in slots with progress bar
- [ ] Progress bar decreases over time
- [ ] Passive income accumulates
- [ ] Cancel button shows breach fee
- [ ] Hosting tab shows ad progress
- [ ] Ad completes and can be collected

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: complete ad system redesign integration"
```

---

## Self-Review Checklist

- [ ] All spec requirements covered by tasks?
- [ ] No TBD/TODO placeholders in steps?
- [ ] Type definitions consistent across files?
- [ ] Function names match across tasks?
- [ ] Tests actually test the new functionality?

---

**Plan complete and saved to `docs/superpowers/plans/2026-03-29-ad-system-redesign.md`**

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
