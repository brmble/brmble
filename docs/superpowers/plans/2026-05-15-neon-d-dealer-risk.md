# Neon-D Dealer Risk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dealer arrest risk, a per-dealer `Pay off cops` toggle with a 15% income penalty, and income-scaled bail recovery to Neon-D.

**Architecture:** Extend the persisted dealer model with protection and arrest state, move arrest and bail math into Neon-D constants plus the game engine hook, and update the dealer card UI to expose risk, protection, and bail actions. Implement the behavior test-first in the existing `useGameEngine` hook tests, then add minimal UI coverage for arrested/protected rendering.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Vite

---

## File Structure

**Modify:**
- `src/Brmble.Web/src/components/NeonD/types.ts`
  Adds dealer protection/arrest fields and any small helper types needed for risk labels.
- `src/Brmble.Web/src/components/NeonD/constants.ts`
  Adds product arrest-risk config, bail constants, helper labels, and updates `INITIAL_GAME_STATE` compatibility.
- `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`
  Implements protection toggling, arrest scheduling, bail, and zero-income arrested behavior.
- `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx`
  Renders `Pay off cops`, risk labels, and arrested-state actions.
- `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`
  Adds TDD coverage for protection, arrest, bail, and persistence-facing behavior.

**Create:**
- `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`
  Verifies the dealer card renders protection and arrested states correctly.

## Task 1: Extend Dealer Types And Constants

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/types.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/constants.ts`
- Test: `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`

- [ ] **Step 1: Write the failing type-and-constant test**

Add a new test block near the top of `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`:

```ts
it('newly hired dealers start unprotected, unarrested, and with a scheduled risk check', () => {
  const { result } = renderHook(() => useGameEngine());

  act(() => {
    result.current.hireDealer(makeDealer({ id: 'dealer-state' }), 0);
  });

  const dealer = result.current.state.activeDealers[0];
  expect(dealer?.isProtected).toBe(false);
  expect(dealer?.isArrested).toBe(false);
  expect(typeof dealer?.nextArrestCheckAt).toBe('number');
  expect((dealer?.nextArrestCheckAt ?? 0)).toBeGreaterThan(Date.now());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
```

Expected: FAIL with TypeScript or runtime errors because `isProtected`, `isArrested`, and `nextArrestCheckAt` do not exist yet.

- [ ] **Step 3: Add minimal dealer state and risk constants**

Update `src/Brmble.Web/src/components/NeonD/types.ts`:

```ts
export type DealerRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Dealer {
  id: string;
  name: string;
  selling: string;
  volume: number;
  margin: number;
  volumeBonus: number;
  marginBonus: number;
  sideVolume: number;
  equipmentCount: number;
  baseVolumeGps: number;
  baseMarginMult: number;
  volumeStars: number;
  marginStars: number;
  isProtected: boolean;
  isArrested: boolean;
  nextArrestCheckAt: number;
}
```

Update `src/Brmble.Web/src/components/NeonD/constants.ts` with focused config:

```ts
export const DEALER_PROTECTION_INCOME_MULTIPLIER = 0.85;
export const ARREST_CHECK_INTERVAL_MS = {
  min: 300_000,
  max: 600_000,
} as const;

export const BAIL_BASE_FLOOR = 500;
export const BAIL_INCOME_MULTIPLIER = 45;

export const PRODUCT_ARREST_RISK: Record<string, { chance: number; label: 'LOW' | 'MEDIUM' | 'HIGH' }> = {
  weed: { chance: 0.10, label: 'LOW' },
  mushrooms: { chance: 0.12, label: 'LOW' },
  blueLotus: { chance: 0.15, label: 'MEDIUM' },
  frostBite: { chance: 0.17, label: 'MEDIUM' },
  electricLace: { chance: 0.20, label: 'MEDIUM' },
  meth: { chance: 0.25, label: 'HIGH' },
  pharmGrade: { chance: 0.28, label: 'HIGH' },
  khole: { chance: 0.30, label: 'HIGH' },
  lunarRegolith: { chance: 0.33, label: 'HIGH' },
  martianSpores: { chance: 0.36, label: 'HIGH' },
  nebulaMist: { chance: 0.40, label: 'HIGH' },
  voidCrystals: { chance: 0.45, label: 'HIGH' },
  chronoSalt: { chance: 0.50, label: 'HIGH' },
  stardustResin: { chance: 0.55, label: 'HIGH' },
  darkMatterInk: { chance: 0.60, label: 'HIGH' },
  singularityShards: { chance: 0.65, label: 'HIGH' },
  neutronFlakes: { chance: 0.70, label: 'HIGH' },
  galacticCore: { chance: 0.75, label: 'HIGH' },
};
```

- [ ] **Step 4: Seed generated dealers with the new fields**

Update the object returned by `generateRandomDealer` in `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`:

```ts
return {
  id: crypto.randomUUID(),
  name: `${fName} "${lName}"`,
  selling: drug,
  volume: baseVolumeGps,
  margin: baseMarginMult,
  volumeBonus: 0,
  marginBonus: 0,
  sideVolume: 0,
  equipmentCount: 0,
  baseVolumeGps,
  baseMarginMult,
  volumeStars,
  marginStars,
  isProtected: false,
  isArrested: false,
  nextArrestCheckAt: Date.now() + ARREST_CHECK_INTERVAL_MS.min,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npm run test -- src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
```

Expected: PASS for the new initialization test, with old tests either still passing or exposing the next engine changes needed.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/NeonD/types.ts src/Brmble.Web/src/components/NeonD/constants.ts src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
git commit -m "feat: add neon-d dealer risk state"
```

## Task 2: Implement Protection Toggle And Arrested Income Stop

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`

- [ ] **Step 1: Write failing engine tests for protection and arrested income**

Add these tests to `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`:

```ts
it('protected dealers earn 15 percent less than unprotected dealers', () => {
  const { result } = renderHook(() => useGameEngine());

  act(() => {
    result.current.upgrade('weed');
    result.current.hireDealer(makeDealer({ id: 'protected-check', margin: 10, volume: 1, sideVolume: 0 }), 0);
  });

  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  const baseline = result.current.state.lastEarningsPerDealer['protected-check'];

  act(() => {
    result.current.toggleDealerProtection('protected-check');
    vi.advanceTimersByTime(1_000);
  });

  const protectedIncome = result.current.state.lastEarningsPerDealer['protected-check'];
  expect(protectedIncome).toBeCloseTo(baseline * 0.85, 5);
});

it('arrested dealers generate zero earnings per tick', () => {
  const { result } = renderHook(() => useGameEngine());

  act(() => {
    result.current.upgrade('weed');
    result.current.hireDealer(makeDealer({ id: 'arrested-check', isArrested: true, nextArrestCheckAt: Date.now() + 999999 }), 0);
  });

  act(() => {
    vi.advanceTimersByTime(1_000);
  });

  expect(result.current.state.lastEarningsPerDealer['arrested-check']).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
```

Expected: FAIL because `toggleDealerProtection` does not exist and the tick loop still pays arrested dealers.

- [ ] **Step 3: Add a protection toggle action**

Add this action to `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`:

```ts
const scheduleNextArrestCheck = (now: number) =>
  now + ARREST_CHECK_INTERVAL_MS.min + Math.floor(Math.random() * (ARREST_CHECK_INTERVAL_MS.max - ARREST_CHECK_INTERVAL_MS.min));

const toggleDealerProtection = (dealerId: string) => {
  setState(prev => ({
    ...prev,
    activeDealers: prev.activeDealers.map(dealer => {
      if (!dealer || dealer.id !== dealerId || dealer.isArrested) return dealer;
      const nextProtected = !dealer.isProtected;
      return {
        ...dealer,
        isProtected: nextProtected,
        nextArrestCheckAt: nextProtected ? dealer.nextArrestCheckAt : scheduleNextArrestCheck(Date.now()),
      };
    }),
  }));
};
```

- [ ] **Step 4: Apply the protection penalty and arrest skip in the tick**

Update the dealer loop in `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`:

```ts
prev.activeDealers.forEach((dealer) => {
  if (!dealer) return;
  if (dealer.isArrested) {
    nextEarnings[dealer.id] = 0;
    return;
  }

  let dealerGross = 0;
  // existing primary + side-hustle sale math

  if (dealer.isProtected) {
    dealerGross *= DEALER_PROTECTION_INCOME_MULTIPLIER;
  }

  nextEarnings[dealer.id] = dealerGross;
  totalEarnedThisTick += dealerGross;
});
```

- [ ] **Step 5: Export the new action from the hook**

Update the return object in `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`:

```ts
return {
  state,
  upgrade,
  unlockProduction,
  hireDealer,
  fireDealer,
  refreshPool,
  resetGame,
  unlockSlot,
  setDealerSelling,
  buyEquipment,
  toggleDealerProtection,
};
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
npm run test -- src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
```

Expected: PASS for the new protection and arrested-income tests.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
git commit -m "feat: add neon-d dealer protection toggle"
```

## Task 3: Implement Arrest Checks And Bail Recovery

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/constants.ts`

- [ ] **Step 1: Write failing engine tests for arrest checks and bail**

Add these tests to `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`:

```ts
it('unprotected dealers use current product risk when the arrest timer expires', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);

  const { result } = renderHook(() => useGameEngine());
  act(() => {
    result.current.hireDealer(makeDealer({
      id: 'risk-check',
      selling: 'meth',
      isProtected: false,
      isArrested: false,
      nextArrestCheckAt: Date.now() - 1,
    }), 0);
  });

  act(() => {
    vi.advanceTimersByTime(1_000);
  });

  expect(result.current.state.activeDealers[0]?.isArrested).toBe(true);
});

it('protected dealers never get arrested when the timer expires', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);

  const { result } = renderHook(() => useGameEngine());
  act(() => {
    result.current.hireDealer(makeDealer({
      id: 'safe-check',
      selling: 'meth',
      isProtected: true,
      isArrested: false,
      nextArrestCheckAt: Date.now() - 1,
    }), 0);
  });

  act(() => {
    vi.advanceTimersByTime(1_000);
  });

  expect(result.current.state.activeDealers[0]?.isArrested).toBe(false);
});

it('payBail uses current total income per second with a minimum floor', () => {
  const { result } = renderHook(() => useGameEngine());
  act(() => {
    result.current.upgrade('weed');
    result.current.hireDealer(makeDealer({ id: 'earner', margin: 10, volume: 1, sideVolume: 0 }), 0);
    vi.advanceTimersByTime(1_000);
  });

  const dealerIncome = result.current.state.lastEarningsPerDealer['earner'];
  const expectedCost = Math.max(500, dealerIncome * 45);

  act(() => {
    result.current.forceArrestDealer('earner');
  });

  const moneyBefore = result.current.state.money;
  act(() => {
    result.current.payDealerBail('earner');
  });

  expect(result.current.state.money).toBeCloseTo(moneyBefore - expectedCost, 5);
  expect(result.current.state.activeDealers[0]?.isArrested).toBe(false);
  expect(result.current.state.activeDealers[0]?.isProtected).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
```

Expected: FAIL because arrest evaluation and bail actions are not implemented.

- [ ] **Step 3: Add engine helpers for risk, bail, and scheduling**

At the top of `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`, add:

```ts
const scheduleNextArrestCheck = (now: number) =>
  now + ARREST_CHECK_INTERVAL_MS.min + Math.floor(Math.random() * (ARREST_CHECK_INTERVAL_MS.max - ARREST_CHECK_INTERVAL_MS.min));

const getDealerRisk = (productId: string) =>
  PRODUCT_ARREST_RISK[productId] ?? { chance: 0.10, label: 'LOW' as const };

const getCurrentTotalIncomePerSecond = (earnings: Record<string, number>) =>
  Object.values(earnings).reduce((sum, value) => sum + value, 0);

const getBailCost = (earnings: Record<string, number>) =>
  Math.max(BAIL_BASE_FLOOR, getCurrentTotalIncomePerSecond(earnings) * BAIL_INCOME_MULTIPLIER);
```

- [ ] **Step 4: Evaluate arrest checks during the tick**

In the state update inside `tick`, compute `now` once and update dealer state after earnings:

```ts
const now = Date.now();
let nextDealers = prev.activeDealers.map(dealer => dealer ? { ...dealer } : null);

nextDealers = nextDealers.map(dealer => {
  if (!dealer || dealer.isArrested || dealer.isProtected) return dealer;
  if (dealer.nextArrestCheckAt > now) return dealer;

  const risk = getDealerRisk(dealer.selling);
  const rolledArrest = Math.random() < risk.chance;

  if (rolledArrest) {
    return {
      ...dealer,
      isArrested: true,
      isProtected: false,
    };
  }

  return {
    ...dealer,
    nextArrestCheckAt: scheduleNextArrestCheck(now),
  };
});

return {
  ...prev,
  money: prev.money + totalEarnedThisTick,
  totalEarned: prev.totalEarned + totalEarnedThisTick,
  production: nextProduction,
  activeDealers: nextDealers,
  lastEarningsPerDealer: nextEarnings,
};
```

- [ ] **Step 5: Add bail and force-arrest actions**

Add these actions to `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`:

```ts
const forceArrestDealer = (dealerId: string) => {
  setState(prev => ({
    ...prev,
    activeDealers: prev.activeDealers.map(dealer =>
      dealer?.id === dealerId
        ? { ...dealer, isArrested: true, isProtected: false }
        : dealer
    ),
  }));
};

const payDealerBail = (dealerId: string) => {
  setState(prev => {
    const bailCost = getBailCost(prev.lastEarningsPerDealer);
    if (prev.money < bailCost) return prev;

    return {
      ...prev,
      money: prev.money - bailCost,
      activeDealers: prev.activeDealers.map(dealer =>
        dealer?.id === dealerId
          ? {
              ...dealer,
              isArrested: false,
              isProtected: false,
              nextArrestCheckAt: scheduleNextArrestCheck(Date.now()),
            }
          : dealer
      ),
    };
  });
};
```

Expose both methods in the returned hook API so they can be used by the UI and targeted tests.

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
npm run test -- src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
```

Expected: PASS for arrest timing, protection immunity, and bail scaling tests.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/NeonD/constants.ts src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
git commit -m "feat: add neon-d dealer arrests and bail"
```

## Task 4: Update Dealer Card UI For Protection, Risk, And Arrested State

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx`
- Create: `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`

- [ ] **Step 1: Write the failing UI test**

Create `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx` with:

```ts
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { NeonDGame } from '../NeonDGame';

vi.mock('../hooks/useGameEngine', () => ({
  useGameEngine: () => ({
    state: {
      money: 10_000,
      totalEarned: 0,
      researchSpeed: 1,
      production: {
        weed: { id: 'weed', name: 'Weed', stock: 100, rate: 1, yieldPerLevel: 0.2, costMultiplier: 1.12, level: 1, upgradeCost: 16 },
      },
      unlockedProduction: ['weed'],
      activeDealers: [{
        id: 'dealer-ui',
        name: 'Test Dealer',
        selling: 'weed',
        volume: 1,
        margin: 10,
        volumeBonus: 0,
        marginBonus: 0,
        sideVolume: 0,
        equipmentCount: 0,
        baseVolumeGps: 1,
        baseMarginMult: 10,
        volumeStars: 3,
        marginStars: 3,
        isProtected: true,
        isArrested: false,
        nextArrestCheckAt: Date.now() + 60_000,
      }],
      availableDealers: [],
      unlockedSlots: 1,
      lastRefreshTime: 0,
      lastEarningsPerDealer: { 'dealer-ui': 8.5 },
    },
    upgrade: vi.fn(),
    unlockProduction: vi.fn(),
    hireDealer: vi.fn(),
    fireDealer: vi.fn(),
    refreshPool: vi.fn(),
    resetGame: vi.fn(),
    unlockSlot: vi.fn(),
    setDealerSelling: vi.fn(),
    buyEquipment: vi.fn(),
    toggleDealerProtection: vi.fn(),
    payDealerBail: vi.fn(),
  }),
}));

it('shows protection state and risk label on an active dealer card', () => {
  render(<NeonDGame />);
  expect(screen.getByText(/protected/i)).toBeInTheDocument();
  expect(screen.getByText(/low risk/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /pay off cops/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Expected: FAIL because the UI does not yet render protection labels or a payoff toggle.

- [ ] **Step 3: Wire the new hook actions into the component**

Update the hook destructuring in `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx`:

```ts
const {
  state,
  upgrade,
  unlockProduction,
  hireDealer,
  fireDealer,
  refreshPool,
  resetGame,
  unlockSlot,
  setDealerSelling,
  buyEquipment,
  toggleDealerProtection,
  payDealerBail,
} = useGameEngine();
```

- [ ] **Step 4: Render risk and protection for active dealers**

In the active dealer card block, add:

```tsx
<div className={styles.statRow}>
  <span className={styles.label}>Risk:</span>
  <span style={{ color: 'var(--accent-secondary)' }}>
    {PRODUCT_ARREST_RISK[slot.selling]?.label ?? 'LOW'} Risk
  </span>
</div>

{slot.isProtected && (
  <div className={styles.statRow}>
    <span className={styles.label}>Status:</span>
    <span style={{ color: 'var(--accent-success)' }}>Protected</span>
  </div>
)}

<button
  className={styles.buyButton}
  onClick={() => toggleDealerProtection(slot.id)}
  disabled={slot.isArrested}
>
  {slot.isProtected ? 'Pay off cops: On (-15%)' : 'Pay off cops: Off'}
</button>
```

- [ ] **Step 5: Render arrested-state controls**

Replace the normal body for arrested dealers with:

```tsx
if (slot.isArrested) {
  return (
    <div key={slot.id} className={`glass-panel ${styles.distributionCard}`} style={{ padding: 0, overflow: 'hidden', marginBottom: 'var(--space-md)' }}>
      <div className={styles.dealerHeader}>
        {slot.name} ({state.production[slot.selling]?.name})
      </div>
      <div style={{ padding: 'var(--space-md)' }}>
        <div className={styles.statRow}>
          <span className={styles.label}>Status:</span>
          <span style={{ color: 'var(--accent-secondary)' }}>Arrested</span>
        </div>
        <div className={styles.statRow}>
          <span className={styles.label}>Earnings:</span>
          <span>$0.00/s</span>
        </div>
        <div style={{ display: 'grid', gap: 'var(--space-xs)', marginTop: 'var(--space-md)' }}>
          <button className={styles.buyButton} onClick={() => payDealerBail(slot.id)}>
            Pay Bail
          </button>
          <button className={styles.dangerButton} onClick={() => fireDealer(slot.id)}>
            Fire Dealer
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
npm run test -- src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Expected: PASS for the active protected dealer rendering test.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/NeonD/NeonDGame.tsx src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx
git commit -m "feat: show neon-d dealer risk controls"
```

## Task 5: Regression And Persistence Verification

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`
- Test: `src/Brmble.Web/src/components/NeonD/hooks/usePersistedGameState.ts`

- [ ] **Step 1: Add a save-migration regression test**

Append this test to `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`:

```ts
it('restores older saves by filling in missing dealer risk fields', () => {
  localStorage.setItem('brmble_neon_d_save', JSON.stringify({
    activeDealers: [{
      id: 'legacy',
      name: 'Legacy Dealer',
      selling: 'weed',
      volume: 1,
      margin: 1,
      volumeBonus: 0,
      marginBonus: 0,
      sideVolume: 0,
      equipmentCount: 0,
      baseVolumeGps: 1,
      baseMarginMult: 1,
      volumeStars: 1,
      marginStars: 1,
    }],
  }));

  const { result } = renderHook(() => useGameEngine());
  const dealer = result.current.state.activeDealers[0];

  expect(dealer?.isProtected).toBe(false);
  expect(dealer?.isArrested).toBe(false);
  expect(typeof dealer?.nextArrestCheckAt).toBe('number');
});
```

- [ ] **Step 2: Add an arrested UI regression test**

Add this second case to `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`:

```ts
it('shows bail and fire actions for arrested dealers', async () => {
  vi.resetModules();
  vi.doMock('../hooks/useGameEngine', () => ({
    useGameEngine: () => ({
      state: {
        money: 10_000,
        totalEarned: 0,
        researchSpeed: 1,
        production: {
          weed: { id: 'weed', name: 'Weed', stock: 100, rate: 1, yieldPerLevel: 0.2, costMultiplier: 1.12, level: 1, upgradeCost: 16 },
        },
        unlockedProduction: ['weed'],
        activeDealers: [{
          id: 'dealer-arrested',
          name: 'Arrested Dealer',
          selling: 'weed',
          volume: 1,
          margin: 10,
          volumeBonus: 0,
          marginBonus: 0,
          sideVolume: 0,
          equipmentCount: 1,
          baseVolumeGps: 1,
          baseMarginMult: 10,
          volumeStars: 3,
          marginStars: 3,
          isProtected: false,
          isArrested: true,
          nextArrestCheckAt: Date.now() + 60_000,
        }],
        availableDealers: [],
        unlockedSlots: 1,
        lastRefreshTime: 0,
        lastEarningsPerDealer: { 'dealer-arrested': 0 },
      },
      upgrade: vi.fn(),
      unlockProduction: vi.fn(),
      hireDealer: vi.fn(),
      fireDealer: vi.fn(),
      refreshPool: vi.fn(),
      resetGame: vi.fn(),
      unlockSlot: vi.fn(),
      setDealerSelling: vi.fn(),
      buyEquipment: vi.fn(),
      toggleDealerProtection: vi.fn(),
      payDealerBail: vi.fn(),
    }),
  }));

  const { NeonDGame: ArrestedNeonDGame } = await import('../NeonDGame');
  render(<ArrestedNeonDGame />);

  expect(screen.getByText(/arrested/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /pay bail/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /fire dealer/i })).toBeInTheDocument();
  vi.resetModules();
  vi.doUnmock('../hooks/useGameEngine');
});
```

- [ ] **Step 3: Run focused Neon-D tests**

Run:

```bash
npm run test -- src/components/NeonD/hooks/__tests__/useGameEngine.test.ts src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Expected: PASS for all new Neon-D risk tests.

- [ ] **Step 4: Run the broader web test suite**

Run:

```bash
npm run test
```

Expected: PASS with no regressions outside Neon-D.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx
git commit -m "test: cover neon-d dealer risk regression cases"
```

## Self-Review

**Spec coverage:**  
The plan covers product-only arrest checks, per-dealer protection toggles, the 15% income penalty, bail scaling from current income per second, arrested dealer recovery/removal, UI exposure of risk/protection/arrest state, and save compatibility.

**Placeholder scan:**  
No `TBD`, `TODO`, or “handle appropriately” placeholders remain. Each task names exact files, concrete tests, commands, and implementation targets.

**Type consistency:**  
The plan consistently uses `isProtected`, `isArrested`, `nextArrestCheckAt`, `toggleDealerProtection`, `payDealerBail`, and `forceArrestDealer`. Bail constants and protection constants are named consistently across tasks.
