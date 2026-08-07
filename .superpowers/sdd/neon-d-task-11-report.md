# Task 11 Report: Rebuild the Neon-D UI

## Status

Implemented Task 11 on branch `improved-neon-D`.

## Summary of changes

- Created `ProductionPanel.tsx`.
  - Renders visible v2 products from `getVisibleProductIds`.
  - Shows stock, producer name/count/cost, production rate, sales rate, signed delta, street/market prices, sequential research/upgrades, and Bulk Selling controls.
  - Uses v2 pure helpers and engine actions only.
- Created `DistributionPanel.tsx`.
  - Renders Territory-backed dealer slots from `state.activeDealers`.
  - Shows the automatic three-candidate pool, numeric Volume/Margin, main sales rates, read-only candidate refresh countdown, protection `-10% income`, arrested/bail/fire state, and fixed equipment catalog.
  - Renders Captain cards with base Volume/Margin, derived level, personal earnings, next threshold, Respect contribution, 4x equipment pricing through `getEquipmentCost`, and Kingpin promotion at level 10.
- Created `MusclePanel.tsx`.
  - Renders all ten canonical Muscle workers.
  - Shows current Respect, Respect/sec, Territory controls, Discount controls, worker owned counts, base Respect/sec, total contribution, next discounted cost, and buy actions.
- Rebuilt `NeonDGame.tsx` as orchestration.
  - Keeps cash, seller income/sec, Respect, Respect/sec, Captain/Kingpin status, Captain purchase/progress, market banner, reset/export/import, and offline summary/dismiss.
  - Passes explicit v2 engine actions into the three panels.
  - Removed obsolete v1 UI concepts from the top-level component.
- Updated `NeonD.module.css`.
  - Added `gameplayGrid` as three equal columns.
  - Added the explicit `900px` stacking breakpoint.
  - Added shared panel/card/equipment/offline summary styling.
- Replaced obsolete v1 `NeonDGame` tests with v2 mocked-state UI tests.
  - Kept export/import/reset coverage against the v2 save format.
  - Added assertions for Production, Distribution, Muscle/Respect, no Research Speed, no stars, production bottleneck metrics, numeric dealer stats, fixed equipment, automatic candidates, Captain controls, offline summary, and bail/fire state.

## TDD evidence

1. Wrote the v2 UI tests first.
2. Ran:

   ```powershell
   npm.cmd test -- src/components/NeonD/__tests__/NeonDGame.test.tsx
   ```

   Result: failed 15/15 against the old v1 monolithic UI because it attempted to read removed v1 fields such as `unlockedProduction`.
3. Implemented the three panels and orchestration refactor.
4. Ran the same focused test until green.

## Verification

Passing:

```powershell
npm.cmd test -- src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Result: 1 test file passed, 15 tests passed.

Clean:

```powershell
git diff --check -- src/Brmble.Web/src/components/NeonD/ProductionPanel.tsx src/Brmble.Web/src/components/NeonD/DistributionPanel.tsx src/Brmble.Web/src/components/NeonD/MusclePanel.tsx src/Brmble.Web/src/components/NeonD/NeonDGame.tsx src/Brmble.Web/src/components/NeonD/NeonD.module.css src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Result: no whitespace errors.

Clean for Task 11 edited files:

```powershell
rg -n "researchSpeed|volumeStars|marginStars|unlockedProduction|unlockSlot|startDealerUpgrade|buyEquipment|SLOT_UNLOCK_COSTS|PRODUCT_ARREST_RISK|pendingUpgradeOptions|equipmentCount|Refresh" src/Brmble.Web/src/components/NeonD/ProductionPanel.tsx src/Brmble.Web/src/components/NeonD/DistributionPanel.tsx src/Brmble.Web/src/components/NeonD/MusclePanel.tsx src/Brmble.Web/src/components/NeonD/NeonDGame.tsx src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Result: only `getRecruitmentRefreshRemainingMs` appeared, which is the required automatic refresh countdown helper.

Additional check:

```powershell
npm.cmd run type-check
```

Result: fails due existing non-Task-11 files:

- `src/components/NeonD/__tests__/constants.test.ts` imports removed v1 exports: `INITIAL_GAME_STATE`, `TIER_DATA`, `PRODUCT_TIERS`, `UNLOCK_COSTS`.
- `src/components/NeonD/constants.ts` has a pre-existing `Object.fromEntries` cast warning in `createBaseGameState`.
- `src/components/NeonD/saveFormat.ts` has a pre-existing equipment-id narrowing error.

The first type-check run also found a new `DistributionPanel.tsx` effect typing issue; that was fixed, and the rerun confirmed no Task 11 edited file remains in the type-check failures.

## Self-review notes

- `NeonDGame.tsx` no longer imports or renders v1-only controls.
- The panel prop surfaces match the Task 11 plan.
- Export/import/reset continue to use `serializeNeonDSave`, `parseNeonDSave`, `resetGame`, and `importGame`.
- The manual candidate refresh button was not reintroduced.
- Fixed equipment renders from `EQUIPMENT_CATALOG` instead of randomized upgrade choices.
- The UI test intentionally uses mocked v2 state so it remains focused on UI rendering and action wiring, not engine behavior.

## Concerns

Project-wide `npm.cmd run type-check` is not green because of pre-existing Neon-D type errors outside the Task 11 file list. Focused UI verification for Task 11 passes.
