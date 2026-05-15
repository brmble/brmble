# Neon-D Pending Dealer Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dealer equipment upgrades spend money immediately, persist the dealer's three upgrade options, and prevent rerolling by closing and reopening the modal.

**Architecture:** Persist pending dealer upgrade choices on the `Dealer` model and move upgrade-roll ownership into `useGameEngine` so the same state drives autosave, UI reopening, and upgrade resolution. Keep `NeonDGame` as a thin view layer that opens a dealer's stored pending options and removes the cancel path that currently behaves like a reroll.

**Tech Stack:** React, TypeScript, Vitest, Testing Library

---

## File Structure

- Modify: `src/Brmble.Web/src/components/NeonD/types.ts`
  - Extend `Dealer` with persisted pending-upgrade fields.
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`
  - Normalize legacy saves, add a "start equipment upgrade" action, make "resolve equipment upgrade" consume pending dealer options, and clear pending choices when a dealer is fired.
- Modify: `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx`
  - Stop generating transient modal options in component state and render the modal from dealer state instead.
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`
  - Add engine-level TDD coverage for pending choice persistence, charging behavior, resolution, cleanup on fire, and migration defaults.
- Modify: `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`
  - Add UI coverage that reopening the modal reuses stored dealer options and that the dismiss reroll path is gone.

### Task 1: Persist Pending Upgrade State On Dealers

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/types.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`

- [ ] **Step 1: Write the failing migration test**

Add this test near the existing legacy-save migration coverage in `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`:

```ts
  it('restores older saves by filling in missing pending dealer upgrade fields', () => {
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
        isProtected: false,
        isArrested: false,
        nextArrestCheckAt: Date.now() + 10_000,
      }],
    }));

    const { result } = renderHook(() => useGameEngine());
    const dealer = result.current.state.activeDealers[0];

    expect(dealer?.hasPendingUpgrade).toBe(false);
    expect(dealer?.pendingUpgradeOptions).toEqual([]);
  });
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```powershell
npm run test -- src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
```

Expected: FAIL because `hasPendingUpgrade` and `pendingUpgradeOptions` do not exist yet on `Dealer`.

- [ ] **Step 3: Add the new dealer fields and normalize them**

Update `src/Brmble.Web/src/components/NeonD/types.ts`:

```ts
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
  hasPendingUpgrade: boolean;
  pendingUpgradeOptions: DealerUpgrade[];
}
```

Update `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts` in `generateRandomDealer` and `normalizeDealerRiskState`:

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
    hasPendingUpgrade: false,
    pendingUpgradeOptions: [],
  };
```

```ts
const normalizeDealerRiskState = (dealer: Dealer): Dealer => ({
  ...dealer,
  isProtected: dealer.isProtected ?? false,
  isArrested: dealer.isArrested ?? false,
  nextArrestCheckAt: dealer.nextArrestCheckAt ?? (Date.now() + ARREST_CHECK_INTERVAL_MS.min),
  hasPendingUpgrade: dealer.hasPendingUpgrade ?? false,
  pendingUpgradeOptions: dealer.pendingUpgradeOptions ?? [],
});
```

Also extend the migration check:

```ts
        dealer.nextArrestCheckAt === undefined ||
        dealer.hasPendingUpgrade === undefined ||
        dealer.pendingUpgradeOptions === undefined
```

- [ ] **Step 4: Run the targeted test to verify it passes**

Run:

```powershell
npm run test -- src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
```

Expected: PASS for the new migration test and no regression in existing hook tests.

- [ ] **Step 5: Commit**

```powershell
git add -- src/Brmble.Web/src/components/NeonD/types.ts src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
git commit -m "feat: persist pending neon-d dealer upgrades"
```

### Task 2: Move Upgrade Roll Ownership Into The Game Engine

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`

- [ ] **Step 1: Write the failing behavior tests for starting and resolving dealer upgrades**

Add these tests inside the existing `equipment upgrades` describe block in `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`:

```ts
    it('startDealerUpgrade charges once and stores three pending options', () => {
      vi.spyOn(Math, 'random')
        .mockReturnValueOnce(0.9)
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(0.9)
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(0.9)
        .mockReturnValueOnce(0);

      const { result } = setupWithMoney();
      const moneyBefore = result.current.state.money;

      act(() => {
        result.current.startDealerUpgrade('test-dealer');
      });

      const dealer = result.current.state.activeDealers[0];
      expect(result.current.state.money).toBeCloseTo(moneyBefore - 500, 1);
      expect(dealer?.hasPendingUpgrade).toBe(true);
      expect(dealer?.pendingUpgradeOptions).toHaveLength(3);
    });

    it('startDealerUpgrade reuses an existing pending roll without charging twice', () => {
      vi.spyOn(Math, 'random')
        .mockReturnValueOnce(0.9)
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(0.9)
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(0.9)
        .mockReturnValueOnce(0);

      const { result } = setupWithMoney();

      act(() => {
        result.current.startDealerUpgrade('test-dealer');
      });

      const moneyAfterFirstRoll = result.current.state.money;
      const firstOptions = result.current.state.activeDealers[0]?.pendingUpgradeOptions;

      act(() => {
        result.current.startDealerUpgrade('test-dealer');
      });

      expect(result.current.state.money).toBeCloseTo(moneyAfterFirstRoll, 1);
      expect(result.current.state.activeDealers[0]?.pendingUpgradeOptions).toEqual(firstOptions);
    });

    it('buyEquipment applies the chosen pending upgrade and clears it', () => {
      const { result } = setupWithMoney();

      act(() => {
        result.current.startDealerUpgrade('test-dealer');
      });

      const chosen = result.current.state.activeDealers[0]!.pendingUpgradeOptions[0];

      act(() => {
        result.current.buyEquipment('test-dealer', chosen);
      });

      const dealer = result.current.state.activeDealers[0];
      expect(dealer?.equipmentCount).toBe(1);
      expect(dealer?.hasPendingUpgrade).toBe(false);
      expect(dealer?.pendingUpgradeOptions).toEqual([]);
    });

    it('fireDealer clears any pending equipment choice with the dealer', () => {
      const { result } = setupWithMoney();

      act(() => {
        result.current.startDealerUpgrade('test-dealer');
      });

      act(() => {
        result.current.fireDealer('test-dealer');
      });

      expect(result.current.state.activeDealers[0]).toBeNull();
    });
```

- [ ] **Step 2: Run the targeted hook test to verify it fails**

Run:

```powershell
npm run test -- src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
```

Expected: FAIL because `startDealerUpgrade` does not exist and `buyEquipment` still charges money directly instead of resolving a stored pending upgrade.

- [ ] **Step 3: Implement the engine-owned pending upgrade flow**

In `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`, extract the current weighted option logic into a helper near the other helper functions:

```ts
const generateDealerUpgradeOptions = (dealer: Dealer, unlockedProduction: string[]): DealerUpgrade[] => {
  const options: DealerUpgrade[] = [];
  const sideHustleProducts = unlockedProduction.filter(id => id !== dealer.selling);

  const commonUpgrades: DealerUpgrade[] = [
    { type: 'VOLUME', label: 'Armed Gang', description: 'Volume +15%', value: 0.15 },
    { type: 'MARGIN', label: 'Ferrari', description: 'Margin +15%', value: 0.15 },
    { type: 'ALL_AROUNDER', label: 'Copter', description: 'Volume & Margin +5%', value: 0.05 },
  ];

  const uncommonUpgrades: DealerUpgrade[] = [
    { type: 'BULK', label: 'The Crew', description: 'Volume +35%, Margin -10%', value: 0.35, marginPenalty: 0.1 },
  ];

  for (let i = 0; i < 3; i++) {
    const roll = Math.random();
    if (roll < 0.10 && sideHustleProducts.length > 0) {
      options.push({
        type: 'SIDE_HUSTLE',
        label: 'JACKPOT: Side Hustle',
        description: 'Add 10% side volume bleed',
        value: 0.1,
        sideVolumeValue: 0.1,
      });
      continue;
    }

    if (roll < 0.30) {
      const upgrade = uncommonUpgrades[Math.floor(Math.random() * uncommonUpgrades.length)];
      options.push({ ...upgrade });
      continue;
    }

    const upgrade = commonUpgrades[Math.floor(Math.random() * commonUpgrades.length)];
    options.push({ ...upgrade });
  }

  return options;
};
```

Add a new action:

```ts
  const startDealerUpgrade = (dealerId: string) => {
    setState(prev => {
      const dealer = prev.activeDealers.find(d => d?.id === dealerId);
      if (!dealer || dealer.equipmentCount >= 3) return prev;

      if (dealer.hasPendingUpgrade && dealer.pendingUpgradeOptions.length === 3) {
        return prev;
      }

      const upgradeCost = 500 * Math.pow(2.5, dealer.equipmentCount);
      if (prev.money < upgradeCost) return prev;

      const pendingUpgradeOptions = generateDealerUpgradeOptions(dealer, prev.unlockedProduction);

      return {
        ...prev,
        money: prev.money - upgradeCost,
        activeDealers: prev.activeDealers.map(current =>
          current?.id === dealerId
            ? {
                ...current,
                hasPendingUpgrade: true,
                pendingUpgradeOptions,
              }
            : current
        ),
      };
    });
  };
```

Update `buyEquipment` so it resolves only a stored pending choice and no longer charges again:

```ts
  const buyEquipment = (dealerId: string, upgrade: DealerUpgrade) => {
    setState(prev => {
      const dealer = prev.activeDealers.find(d => d?.id === dealerId);
      if (!dealer || dealer.equipmentCount >= 3) return prev;
      if (!dealer.hasPendingUpgrade || dealer.pendingUpgradeOptions.length !== 3) return prev;

      const matchedUpgrade = dealer.pendingUpgradeOptions.find(option =>
        option.type === upgrade.type &&
        option.label === upgrade.label &&
        option.description === upgrade.description &&
        option.value === upgrade.value &&
        option.marginPenalty === upgrade.marginPenalty &&
        option.sideVolumeValue === upgrade.sideVolumeValue
      );

      if (!matchedUpgrade) return prev;

      const nextDealers = prev.activeDealers.map(d => {
        if (d?.id !== dealerId) return d;

        const newDealer = {
          ...d,
          equipmentCount: d.equipmentCount + 1,
          hasPendingUpgrade: false,
          pendingUpgradeOptions: [],
        };

        if (matchedUpgrade.type === 'VOLUME') newDealer.volumeBonus += matchedUpgrade.value;
        if (matchedUpgrade.type === 'MARGIN') newDealer.marginBonus += matchedUpgrade.value;
        if (matchedUpgrade.type === 'ALL_AROUNDER') {
          newDealer.volumeBonus += matchedUpgrade.value;
          newDealer.marginBonus += matchedUpgrade.value;
        }
        if (matchedUpgrade.type === 'BULK') {
          newDealer.volumeBonus += matchedUpgrade.value;
          newDealer.marginBonus -= matchedUpgrade.marginPenalty || 0.1;
        }
        if (matchedUpgrade.type === 'SIDE_HUSTLE') {
          newDealer.sideVolume = (newDealer.sideVolume ?? 0) + (matchedUpgrade.sideVolumeValue ?? 0.10);
        }

        return newDealer;
      });

      return { ...prev, activeDealers: nextDealers };
    });
  };
```

Return the new action from the hook:

```ts
    startDealerUpgrade,
```

- [ ] **Step 4: Run the targeted hook test to verify it passes**

Run:

```powershell
npm run test -- src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
```

Expected: PASS for the new start/reopen/resolve/fire behavior plus the existing upgrade tests after adjusting the old "cost deducts" assertion to call `startDealerUpgrade` before `buyEquipment`.

- [ ] **Step 5: Commit**

```powershell
git add -- src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
git commit -m "feat: move neon-d dealer upgrade rolls into game state"
```

### Task 3: Update The UI To Reopen Stored Dealer Choices Without Rerolling

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`
- Modify: `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx`

- [ ] **Step 1: Write the failing UI test for reopening the same stored options**

Add a focused UI test in `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx` using `render`, `screen`, and `fireEvent`:

```ts
it('reopens the same pending dealer upgrade options instead of rerolling', async () => {
  const startDealerUpgrade = vi.fn();
  const buyEquipment = vi.fn();

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
          isProtected: false,
          isArrested: false,
          nextArrestCheckAt: Date.now() + 60_000,
          hasPendingUpgrade: true,
          pendingUpgradeOptions: [
            { type: 'VOLUME', label: 'Armed Gang', description: 'Volume +15%', value: 0.15 },
            { type: 'MARGIN', label: 'Ferrari', description: 'Margin +15%', value: 0.15 },
            { type: 'ALL_AROUNDER', label: 'Copter', description: 'Volume & Margin +5%', value: 0.05 },
          ],
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
      startDealerUpgrade,
      buyEquipment,
      toggleDealerProtection: vi.fn(),
      payDealerBail: vi.fn(),
      forceArrestDealer: vi.fn(),
    }),
  }));

  const { NeonDGame: PendingNeonDGame } = await import('../NeonDGame');
  render(<PendingNeonDGame />);

  fireEvent.click(screen.getByRole('button', { name: /upgrade/i }));
  expect(screen.getByText('Armed Gang')).toBeInTheDocument();
  expect(screen.getByText('Ferrari')).toBeInTheDocument();
  expect(screen.getByText('Copter')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  expect(startDealerUpgrade).toHaveBeenCalledWith('dealer-ui');
});
```

- [ ] **Step 2: Run the UI test to verify it fails**

Run:

```powershell
npm run test -- src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Expected: FAIL because the component still generates modal options locally and still shows a cancel button.

- [ ] **Step 3: Make `NeonDGame` read pending dealer choices from the hook**

In `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx`:

- Remove the `Dealer` import if it becomes unused.
- Replace the local state shape so it tracks only the open dealer id:

```ts
  const [upgradingDealerId, setUpgradingDealerId] = useState<string | null>(null);
```

- Read the new hook action:

```ts
    startDealerUpgrade,
```

- Delete the local `generateUpgradeOptions` helper entirely.

- Derive the open dealer from state:

```ts
  const upgradingDealer = upgradingDealerId
    ? state.activeDealers.find(dealer => dealer?.id === upgradingDealerId) ?? null
    : null;
```

- Update the dealer upgrade button:

```ts
                        <button
                          className={styles.buyButton}
                          disabled={isMaxed || state.money < upgradeCost}
                          onClick={() => {
                            if (isMaxed) return;
                            startDealerUpgrade(dealer.id);
                            setUpgradingDealerId(dealer.id);
                          }}
                        >
```

- Render the modal from persisted options:

```ts
      {upgradingDealer && upgradingDealer.hasPendingUpgrade && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="glass-panel" style={{ padding: 'var(--space-xl)', maxWidth: '500px' }}>
            <h3 className={styles.columnHeader}>Select Equipment</h3>
            <div style={{ display: 'grid', gap: '10px', marginTop: '20px' }}>
              {upgradingDealer.pendingUpgradeOptions.map((opt, i) => (
                <button
                  key={`${opt.label}-${i}`}
                  className={opt.type === 'SIDE_HUSTLE' ? styles.dangerButton : styles.buyButton}
                  style={opt.type === 'SIDE_HUSTLE'
                    ? { border: '2px solid gold', boxShadow: '0 0 20px rgba(255, 215, 0, 0.5)' }
                    : {}}
                  onClick={() => {
                    buyEquipment(upgradingDealer.id, opt);
                    setUpgradingDealerId(null);
                  }}
                >
                  <div style={{ fontWeight: 'bold' }}>{opt.label}</div>
                  <div style={{ fontSize: '10px', opacity: 0.8 }}>{opt.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
```

- Add a tiny effect so the modal closes itself if the pending upgrade gets consumed or the dealer disappears:

```ts
  if (upgradingDealerId && (!upgradingDealer || !upgradingDealer.hasPendingUpgrade)) {
    setUpgradingDealerId(null);
  }
```

If you prefer to avoid a render-time state update, implement that same logic with `useEffect`.

- [ ] **Step 4: Run the UI tests to verify they pass**

Run:

```powershell
npm run test -- src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Expected: PASS for the new reopening test and the existing dealer card UI tests.

- [ ] **Step 5: Commit**

```powershell
git add -- src/Brmble.Web/src/components/NeonD/NeonDGame.tsx src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx
git commit -m "feat: reuse pending neon-d dealer upgrade choices in ui"
```

### Task 4: Final Verification

**Files:**
- Modify: none
- Test: `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`
- Test: `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`

- [ ] **Step 1: Run the hook test file**

Run:

```powershell
npm run test -- src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
```

Expected: PASS

- [ ] **Step 2: Run the UI test file**

Run:

```powershell
npm run test -- src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Expected: PASS

- [ ] **Step 3: Run both targeted test files together**

Run:

```powershell
npm run test -- src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Expected: PASS with no new warnings or errors.

- [ ] **Step 4: Commit the verification checkpoint**

```powershell
git add -- docs/superpowers/plans/2026-05-15-neon-d-pending-dealer-upgrade.md
git commit -m "docs: add neon-d pending dealer upgrade plan"
```
