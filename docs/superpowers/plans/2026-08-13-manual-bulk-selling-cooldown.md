# Manual Bulk Selling Cooldown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove automatic bulk selling and add a persisted, global 20-minute cooldown to successful manual bulk sales.

**Architecture:** Keep bulk-sale rules in `simulation.ts`, with the action receiving the current game-clock timestamp and returning an unchanged state when locked or empty. Store `lastBulkSellAt` in `GameState`; remove `autoBulkEnabled` and all simulation-side automatic bulk calls. Update `ProductionPanel` to derive a visible countdown from `state.lastTickAt` and pass the timestamp through the hook action. Extend save parsing with an explicit v2-to-v3 migration.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, Vite.

## Global Constraints

- Bulk selling is manual-only; no automatic replacement behavior is introduced.
- The cooldown is exactly `20 * 60 * 1000` milliseconds and is global across products.
- A successful sale starts the cooldown; an empty/no-op sale does not.
- Existing 500g retention, 90% value multiplier, unlock threshold, and unlock cost remain unchanged.
- Existing v2 saves remain loadable; missing `lastBulkSellAt` migrates to `0`, and legacy `autoBulkEnabled` is discarded.
- Production code is written only after a failing test has been observed.

---

### Task 1: Update game-state constants and types

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/types.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/constants.ts`
- Test: `src/Brmble.Web/src/components/NeonD/__tests__/constants.test.ts`
- Test: `src/Brmble.Web/src/components/NeonD/__tests__/gameData.test.ts`

**Interfaces:**
- Produces `BULK_SELL_COOLDOWN_MS = 20 * 60 * 1000`.
- Produces `GameState.lastBulkSellAt: number`.
- Removes `GameState.autoBulkEnabled`.
- `createBaseGameState(now)` returns `schemaVersion: 3` and `lastBulkSellAt: now`.

- [ ] **Step 1: Write the failing tests**

Add assertions that a base state has schema version 3, initializes `lastBulkSellAt` to the supplied timestamp, and exposes the cooldown constant as 1,200,000 milliseconds. Update fixtures that currently assign `autoBulkEnabled` so they no longer expect that property.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run from `C:\PrOgram project\brmble\brmble\src\Brmble.Web`:

```powershell
npm run test -- src/components/NeonD/__tests__/constants.test.ts src/components/NeonD/__tests__/gameData.test.ts
```

Expected: FAIL because the state still has schema version 2 and no `lastBulkSellAt`/cooldown constant.

- [ ] **Step 3: Implement the minimal state changes**

Update the type and base-state factory, remove the auto-bulk boolean, add the cooldown constant, and remove obsolete auto-bulk constants only if no remaining production/test reference needs them.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/Brmble.Web/src/components/NeonD/types.ts src/Brmble.Web/src/components/NeonD/constants.ts src/Brmble.Web/src/components/NeonD/__tests__/constants.test.ts src/Brmble.Web/src/components/NeonD/__tests__/gameData.test.ts
git commit -m "feat: add bulk sale cooldown state"
```

### Task 2: Make bulk selling manual-only with cooldown enforcement

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/simulation.ts`
- Test: `src/Brmble.Web/src/components/NeonD/__tests__/simulation.test.ts`

**Interfaces:**
- Consumes `GameState.lastBulkSellAt` and `BULK_SELL_COOLDOWN_MS`.
- Produces `sellBulkOverflow(state, productId, now): GameState`.
- Removes `applyAutoBulk` and all automatic bulk-selling calls from deterministic and offline simulation.

- [ ] **Step 1: Write the failing tests**

Update the manual sale test to call `sellBulkOverflow(state, 'weed', 10_000)` and assert `lastBulkSellAt` becomes `10_000`. Add tests with stock above 500g showing that a sale at `10_000` blocks a second sale at `10_000 + 1_199_999`, allows one at `10_000 + 1_200_000`, and leaves state unchanged for a no-op sale. Add deterministic and offline-progress cases with stock over 1,500g that assert stock is not reduced by an automatic bulk operation.

- [ ] **Step 2: Run the focused test file to verify it fails**

```powershell
npm run test -- src/components/NeonD/__tests__/simulation.test.ts
```

Expected: FAIL because the helper has no timestamp/cooldown behavior and simulation still auto-sells.

- [ ] **Step 3: Implement the minimal simulation changes**

Change the helper signature to accept `now`, return the original state when bulk selling is locked, compute the existing overflow sale, and set `lastBulkSellAt: now` only for a successful sale. Delete `applyAutoBulk` and remove its invocation from `advanceDeterministicState` and the offline-progress loop. Preserve ordinary production, dealer, captain, and offline earnings calculations.

- [ ] **Step 4: Run the focused test file to verify it passes**

```powershell
npm run test -- src/components/NeonD/__tests__/simulation.test.ts
```

Expected: PASS with no automatic stock reduction.

- [ ] **Step 5: Commit**

```powershell
git add -- src/Brmble.Web/src/components/NeonD/simulation.ts src/Brmble.Web/src/components/NeonD/__tests__/simulation.test.ts
git commit -m "feat: enforce manual bulk sale cooldown"
```

### Task 3: Wire the manual action and countdown into the game engine and panel

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/ProductionPanel.tsx`
- Modify: `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx` only if prop types require it
- Test: `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`
- Test: `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`

**Interfaces:**
- `bulkSellProduct(productId)` calls `sellBulkOverflow(prev, productId, Date.now())` inside the state updater.
- `ProductionPanel` receives no auto-bulk setter and derives `cooldownRemainingMs` from `lastBulkSellAt` and `lastTickAt`.

- [ ] **Step 1: Write the failing tests**

Add a hook test that seeds a bulk-unlocked state with overflow stock, performs one manual sale, then verifies a second immediate action does not alter cash or stock. Add component assertions that the Auto Bulk control is absent, the manual button shows a cooldown label after a successful sale, and the button is disabled while the cooldown remains.

- [ ] **Step 2: Run the focused tests to verify they fail**

```powershell
npm run test -- src/components/NeonD/hooks/__tests__/useGameEngine.test.ts src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Expected: FAIL because the hook does not pass time, the panel still renders Auto Bulk, and no cooldown UI exists.

- [ ] **Step 3: Implement the minimal UI/engine changes**

Remove `setAutoBulkEnabled` from the hook return and component props. Pass `Date.now()` into the simulation helper. In `ProductionPanel`, use `state.lastTickAt` as the render clock, compute the remaining milliseconds, disable the button when remaining time is positive, and render a concise remaining-time suffix such as `Bulk sell overflow (19m 59s)`. Keep the stock threshold disabled state and ensure the action handler still guards the rule.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts src/Brmble.Web/src/components/NeonD/ProductionPanel.tsx src/Brmble.Web/src/components/NeonD/NeonDGame.tsx src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx
git commit -m "feat: show manual bulk sale cooldown"
```

### Task 4: Migrate and validate persisted saves

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/saveFormat.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/__tests__/saveFormat.test.ts`

**Interfaces:**
- `NEON_D_SAVE_VERSION` becomes `3`.
- `parseNeonDSave` accepts current v3 envelopes and legacy v2 envelopes, returning a v3 `GameState`.
- Legacy migration removes `autoBulkEnabled` and supplies `lastBulkSellAt: 0`.

- [ ] **Step 1: Write the failing tests**

Update current save fixtures to the v3 shape. Add a v3 round-trip assertion for `lastBulkSellAt`. Add a v2 fixture containing `autoBulkEnabled` and assert parsing returns schema version 3, `lastBulkSellAt === 0`, and no `autoBulkEnabled` property. Add invalid-save cases for a negative, non-finite, or missing v3 `lastBulkSellAt`.

- [ ] **Step 2: Run the save-format tests to verify they fail**

```powershell
npm run test -- src/components/NeonD/__tests__/saveFormat.test.ts
```

Expected: FAIL because validation requires the old exact keys/version and cannot migrate v2.

- [ ] **Step 3: Implement v2-to-v3 migration and validation**

Update the exact-key list and validator for `lastBulkSellAt`, remove `autoBulkEnabled`, set the current version to 3, and normalize legacy v2 state before validating it as v3. Preserve rejection of unknown keys and malformed nested state. A migrated state must be a fresh object with `schemaVersion: 3`, `lastBulkSellAt: 0`, and all other v2 values unchanged.

- [ ] **Step 4: Run the save-format tests to verify they pass**

```powershell
npm run test -- src/components/NeonD/__tests__/saveFormat.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/Brmble.Web/src/components/NeonD/saveFormat.ts src/Brmble.Web/src/components/NeonD/__tests__/saveFormat.test.ts
git commit -m "feat: migrate NeonD saves for bulk cooldown"
```

### Task 5: Full verification and cleanup

**Files:**
- Modify: any remaining NeonD tests or source references found by `rg`.

- [ ] **Step 1: Search for removed automatic-bulk references**

```powershell
rg -n "autoBulkEnabled|setAutoBulkEnabled|applyAutoBulk|AUTO_BULK_TRIGGER_STOCK" src/Brmble.Web/src/components/NeonD
```

Expected: no production references; any remaining test references are removed or rewritten to the manual-only behavior.

- [ ] **Step 2: Run the full NeonD test suite**

```powershell
npm run test -- src/components/NeonD
```

Expected: PASS with zero failures.

- [ ] **Step 3: Run type-check and lint**

```powershell
npm run type-check
npm run lint
```

Expected: both commands exit 0 with no new errors.

- [ ] **Step 4: Run the production build**

```powershell
npm run build
```

Expected: TypeScript compilation and Vite build complete successfully.

- [ ] **Step 5: Inspect the final diff and commit any cleanup**

```powershell
git diff HEAD~4 --check
git status --short --branch
```

Expected: only the intended implementation/test changes are present; unrelated `Brmble-Run.bat` and `Brmble-Server.bat` remain untouched.
