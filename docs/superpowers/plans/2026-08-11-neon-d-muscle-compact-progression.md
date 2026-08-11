# Neon-D Muscle Compact Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tall Muscle / Respect worker-card stack with a compact progression list that defaults to every owned tier plus the next two tiers and can reveal the full catalog.

**Architecture:** Keep economy, game-engine, and save-state interfaces unchanged. Add one pure catalog-visibility helper, then let `MusclePanel` combine that derivation with local expanded/collapsed UI state while rendering compact token-styled rows. Verify the helper independently and cover the user interaction through the existing Neon-D integration test.

**Tech Stack:** React 19, TypeScript 5.9, CSS Modules, Vitest 4, Testing Library, user-event.

## Global Constraints

- Base all work on PR #633 commit `8f02ab37979399f54d66036d99b52a0931a16849` plus the approved design commit.
- Do not change economy formulas, worker prices, growth rates, Respect generation, purchase callbacks, persistence, or save format.
- Collapsed mode shows every owned worker and exactly the next two catalog entries after the highest owned catalog index, or all remaining entries when fewer than two remain.
- Fresh state shows Hood Rat and Young Thug.
- Expanded mode shows the complete catalog and remains expanded across purchases until the user collapses it.
- The expanded/collapsed choice is local component state and is never persisted.
- Later tiers remain accessible through `Show all N later tiers`; never describe them as mechanically locked.
- Use native buttons and expose `aria-expanded` plus `aria-controls` on the reveal control.
- Use existing Brmble design tokens only; add no hardcoded colors, sizes, spacing, radii, shadows, or transitions.
- Preserve the unrelated untracked `Brmble-Run.bat` file in the worktree.

## File Structure

- Create `src/Brmble.Web/src/components/NeonD/muscleVisibility.ts`: pure collapsed-catalog derivation.
- Create `src/Brmble.Web/src/components/NeonD/__tests__/muscleVisibility.test.ts`: edge-case coverage for that derivation.
- Modify `src/Brmble.Web/src/components/NeonD/MusclePanel.tsx`: local reveal state, compact semantic rows, and unchanged callbacks.
- Modify `src/Brmble.Web/src/components/NeonD/NeonD.module.css`: Muscle-only compact layout and responsive stacking.
- Modify `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`: integration coverage for collapsed/expanded behavior, compact structure, purchase callback, and disabled state.

---

### Task 1: Derive the Collapsed Muscle Catalog

**Files:**
- Create: `src/Brmble.Web/src/components/NeonD/muscleVisibility.ts`
- Create: `src/Brmble.Web/src/components/NeonD/__tests__/muscleVisibility.test.ts`

**Interfaces:**
- Consumes: `MUSCLE_CATALOG` and `GameState['muscleOwned']`.
- Produces: `getCollapsedMuscleWorkers(owned: GameState['muscleOwned']): readonly MuscleWorkerDefinition[]` and `COLLAPSED_FUTURE_MUSCLE_TIER_COUNT`.

- [ ] **Step 1: Write the failing visibility tests**

Create `src/Brmble.Web/src/components/NeonD/__tests__/muscleVisibility.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createBaseGameState, MUSCLE_CATALOG } from '../constants';
import { getCollapsedMuscleWorkers } from '../muscleVisibility';

const workerNames = (workers: ReturnType<typeof getCollapsedMuscleWorkers>) =>
  workers.map((worker) => worker.name);

describe('getCollapsedMuscleWorkers', () => {
  it('shows the first two tiers when no workers are owned', () => {
    const owned = createBaseGameState(0).muscleOwned;

    expect(workerNames(getCollapsedMuscleWorkers(owned))).toEqual([
      'Hood Rat',
      'Young Thug',
    ]);
  });

  it('keeps every owned tier and adds two tiers after the highest owned tier', () => {
    const owned = {
      ...createBaseGameState(0).muscleOwned,
      hoodRat: 2,
      hiredGoon: 1,
    };

    expect(workerNames(getCollapsedMuscleWorkers(owned))).toEqual([
      'Hood Rat',
      'Hired Goon',
      'Crooked Cop',
      'Bought Judge',
    ]);
  });

  it('returns the complete catalog when every tier is owned', () => {
    const owned = Object.fromEntries(
      MUSCLE_CATALOG.map((worker) => [worker.id, 1]),
    ) as ReturnType<typeof createBaseGameState>['muscleOwned'];

    expect(getCollapsedMuscleWorkers(owned)).toEqual(MUSCLE_CATALOG);
  });
});
```

- [ ] **Step 2: Run the test and verify the red state**

Run:

```powershell
cd src/Brmble.Web
npm.cmd test -- src/components/NeonD/__tests__/muscleVisibility.test.ts
```

Expected: FAIL because `../muscleVisibility` does not exist.

- [ ] **Step 3: Implement the pure visibility helper**

Create `src/Brmble.Web/src/components/NeonD/muscleVisibility.ts`:

```ts
import { MUSCLE_CATALOG } from './constants';
import type { GameState, MuscleWorkerDefinition } from './types';

export const COLLAPSED_FUTURE_MUSCLE_TIER_COUNT = 2;

export const getCollapsedMuscleWorkers = (
  owned: GameState['muscleOwned'],
): readonly MuscleWorkerDefinition[] => {
  const highestOwnedIndex = MUSCLE_CATALOG.reduce(
    (highest, worker, index) => owned[worker.id] > 0 ? index : highest,
    -1,
  );
  const lastFutureIndex = highestOwnedIndex + COLLAPSED_FUTURE_MUSCLE_TIER_COUNT;

  return MUSCLE_CATALOG.filter((worker, index) =>
    owned[worker.id] > 0
      || (index > highestOwnedIndex && index <= lastFutureIndex),
  );
};
```

- [ ] **Step 4: Run the helper tests and the existing catalog tests**

Run:

```powershell
npm.cmd test -- src/components/NeonD/__tests__/muscleVisibility.test.ts src/components/NeonD/__tests__/gameData.test.ts
```

Expected: both test files PASS with 0 failures.

- [ ] **Step 5: Commit the helper and tests**

```powershell
git add -- src/Brmble.Web/src/components/NeonD/muscleVisibility.ts src/Brmble.Web/src/components/NeonD/__tests__/muscleVisibility.test.ts
git commit -m "feat: derive compact muscle progression"
```

---

### Task 2: Render the Compact Progression List

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/MusclePanel.tsx:1-81`
- Modify: `src/Brmble.Web/src/components/NeonD/NeonD.module.css:149-217,455-517,555-575`
- Modify: `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx:272-296`

**Interfaces:**
- Consumes: `getCollapsedMuscleWorkers(owned)` from Task 1, existing `MusclePanelProps`, `MUSCLE_CATALOG`, and all existing economy helpers.
- Produces: local `showAllWorkers` UI state, `#neond-muscle-workers`, a `role="list"` worker list, labelled `role="listitem"` rows, and an accessible show-all/hide control.

- [ ] **Step 1: Replace the obsolete header assertion and add the failing compact-list interaction test**

In `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`, replace lines 282-288 in the existing tab-switching test with:

```ts
  const hoodRatRow = screen.getByRole('listitem', { name: 'Hood Rat' });
  expect(hoodRatRow.className).toContain('muscleWorkerRow');
  expect(hoodRatRow).toHaveTextContent('Owned 0');
```

Then add this test immediately after the tab-switching test:

```ts
it('keeps Muscle compact and reveals every later tier on request', async () => {
  const user = userEvent.setup();
  mockState({ cash: 100 });
  render(<NeonDGame />);

  await user.click(screen.getByRole('tab', { name: 'Muscle' }));

  const muscleList = screen.getByRole('list', { name: 'Muscle workers' });
  expect(within(muscleList).getByRole('listitem', { name: 'Hood Rat' })).toBeInTheDocument();
  expect(within(muscleList).getByRole('listitem', { name: 'Young Thug' })).toBeInTheDocument();
  expect(within(muscleList).queryByRole('listitem', { name: 'Hired Goon' })).not.toBeInTheDocument();

  const hoodRatRow = within(muscleList).getByRole('listitem', { name: 'Hood Rat' });
  const youngThugRow = within(muscleList).getByRole('listitem', { name: 'Young Thug' });
  await user.click(within(hoodRatRow).getByRole('button', { name: 'Buy one Hood Rat for $80' }));

  expect(mockNeonD.buyMuscleWorkerMock).toHaveBeenCalledWith('hoodRat');
  expect(
    within(youngThugRow).getByRole('button', { name: 'Buy one Young Thug for $1,000' }),
  ).toBeDisabled();

  const revealButton = screen.getByRole('button', { name: 'Show all 8 later tiers' });
  expect(revealButton).toHaveAttribute('aria-expanded', 'false');
  expect(revealButton).toHaveAttribute('aria-controls', 'neond-muscle-workers');

  await user.click(revealButton);

  expect(screen.getByRole('button', { name: 'Hide later tiers' })).toHaveAttribute('aria-expanded', 'true');
  expect(within(muscleList).getByRole('listitem', { name: 'Orbital Ion Cannon' })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Hide later tiers' }));

  expect(within(muscleList).queryByRole('listitem', { name: 'Orbital Ion Cannon' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Add a failing CSS-structure assertion**

Add this test after the compact-list interaction test:

```ts
it('uses compact Muscle rows and a two-column progression action grid', () => {
  const cssPath = resolve(process.cwd(), 'src/components/NeonD/NeonD.module.css');
  const css = readFileSync(cssPath, 'utf8');

  expect(css).toMatch(
    /\.muscleActionGrid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
  expect(css).toMatch(
    /\.muscleWorkerRow\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/,
  );
  expect(css).toMatch(/\.muscleBuyButton\s*\{[\s\S]*width:\s*auto/);
});
```

- [ ] **Step 3: Run the focused UI test and verify the red state**

Run:

```powershell
npm.cmd test -- src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Expected: FAIL because the worker list, accessible reveal control, compact row markup, and new CSS classes do not exist.

- [ ] **Step 4: Replace `MusclePanel.tsx` with the compact implementation**

Replace `src/Brmble.Web/src/components/NeonD/MusclePanel.tsx` with:

```tsx
import { useState } from 'react';
import { MUSCLE_CATALOG } from './constants';
import {
  getDiscountCost,
  getDiscountMultiplier,
  getMuscleWorkerCost,
  getRespectPerSecond,
  getTerritoryCost,
} from './economy';
import { getCollapsedMuscleWorkers } from './muscleVisibility';
import type { GameState, MuscleWorkerId } from './types';
import styles from './NeonD.module.css';

type MusclePanelProps = {
  state: GameState;
  buyMuscleWorker: (workerId: MuscleWorkerId) => void;
  buyTerritory: () => void;
  buyDiscount: () => void;
};

const formatMoney = (value: number) => `$${Math.round(value).toLocaleString()}`;

export function MusclePanel(props: MusclePanelProps) {
  const [showAllWorkers, setShowAllWorkers] = useState(false);
  const respectPerSecond = getRespectPerSecond(props.state);
  const collapsedWorkers = getCollapsedMuscleWorkers(props.state.muscleOwned);
  const visibleWorkers = showAllWorkers ? MUSCLE_CATALOG : collapsedWorkers;
  const hiddenWorkerCount = MUSCLE_CATALOG.length - collapsedWorkers.length;

  return (
    <section className={styles.panel} aria-labelledby="neond-muscle-heading">
      <h3 id="neond-muscle-heading" className={styles.columnHeader}>Muscle / Respect</h3>
      <div className={styles.prestigeSummary}>
        <span>Respect: {Math.floor(props.state.respect).toLocaleString()}</span>
        <strong>Respect/sec: {respectPerSecond.toFixed(2)}</strong>
      </div>
      <div className={styles.muscleActionGrid}>
        <button
          className={styles.unlockButton}
          onClick={props.buyTerritory}
          disabled={props.state.respect < getTerritoryCost(props.state.territoryLevel)}
        >
          Territory {props.state.territoryLevel} · Capacity {props.state.activeDealers.length} - {Math.round(getTerritoryCost(props.state.territoryLevel)).toLocaleString()} Respect
        </button>
        <button
          className={styles.unlockButton}
          onClick={props.buyDiscount}
          disabled={props.state.respect < getDiscountCost(props.state.discountLevel)}
        >
          Discount {props.state.discountLevel} · {(getDiscountMultiplier(props.state.discountLevel) * 100).toFixed(1)}% cash prices - {Math.round(getDiscountCost(props.state.discountLevel)).toLocaleString()} Respect
        </button>
      </div>

      <div
        id="neond-muscle-workers"
        className={styles.muscleWorkerList}
        role="list"
        aria-label="Muscle workers"
      >
        {visibleWorkers.map((worker) => {
          const owned = props.state.muscleOwned[worker.id];
          const cost = getMuscleWorkerCost(worker.id, owned, props.state.discountLevel);
          const headingId = `neond-muscle-worker-${worker.id}`;
          return (
            <article
              key={worker.id}
              className={styles.muscleWorkerRow}
              role="listitem"
              aria-labelledby={headingId}
            >
              <div className={styles.muscleWorkerDetails}>
                <div className={styles.muscleWorkerHeading}>
                  <h4 id={headingId} className={styles.productTitle}>{worker.name}</h4>
                  <span>Owned {owned.toLocaleString()}</span>
                </div>
                <div className={styles.muscleWorkerMetrics}>
                  <span>{worker.respectPerSecond.toLocaleString()} Respect/sec each</span>
                  <strong>{(owned * worker.respectPerSecond).toLocaleString()} Respect/sec total</strong>
                </div>
              </div>
              <button
                className={`${styles.buyButton} ${styles.muscleBuyButton}`}
                onClick={() => props.buyMuscleWorker(worker.id)}
                disabled={props.state.cash < cost}
                aria-label={`Buy one ${worker.name} for ${formatMoney(cost)}`}
              >
                Buy - {formatMoney(cost)}
              </button>
            </article>
          );
        })}
      </div>

      {hiddenWorkerCount > 0 ? (
        <button
          type="button"
          className={styles.muscleRevealButton}
          aria-expanded={showAllWorkers}
          aria-controls="neond-muscle-workers"
          onClick={() => setShowAllWorkers((current) => !current)}
        >
          {showAllWorkers ? 'Hide later tiers' : `Show all ${hiddenWorkerCount} later tiers`}
        </button>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 5: Replace the Muscle card CSS with compact token-based styles**

In `src/Brmble.Web/src/components/NeonD/NeonD.module.css`, replace the existing `.muscleWorkerRow`, `.muscleHeader`, and `.muscleBody` block at lines 184-217 with:

```css
.muscleActionGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2xs);
  margin-top: var(--space-xs);
}

.muscleWorkerList {
  display: grid;
  gap: var(--space-xs);
}

.muscleWorkerRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs);
  background: var(--bg-surface);
  border: var(--border-width-thin) solid var(--glass-border);
  border-left: var(--space-2xs) solid var(--accent-primary);
  border-radius: var(--radius-md);
}

.muscleWorkerDetails {
  display: grid;
  min-width: 0;
  gap: var(--space-2xs);
}

.muscleWorkerHeading,
.muscleWorkerMetrics {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs);
}

.muscleWorkerHeading span,
.muscleWorkerMetrics {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.muscleWorkerHeading span,
.muscleWorkerMetrics strong {
  text-align: right;
}

.muscleWorkerMetrics strong {
  color: var(--text-primary);
}

.muscleBuyButton {
  width: auto;
  white-space: nowrap;
}

.muscleRevealButton {
  width: 100%;
  padding: var(--space-2xs) var(--space-xs);
  border: var(--border-width-thin) solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  transition: color var(--transition-fast), border-color var(--transition-fast);
}

.muscleRevealButton:hover,
.muscleRevealButton:focus-visible {
  border-color: var(--accent-primary);
  color: var(--accent-primary);
}

.muscleRevealButton:focus-visible {
  outline: var(--border-width-strong) solid var(--accent-primary);
  outline-offset: var(--space-2xs);
}
```

Keep `.actionStack` unchanged because Distribution still uses it. Inside the existing `@media (max-width: 900px)` block, add:

```css
  .muscleActionGrid,
  .muscleWorkerRow {
    grid-template-columns: 1fr;
  }

  .muscleBuyButton {
    width: 100%;
  }
```

- [ ] **Step 6: Run the focused UI test and confirm green**

Run:

```powershell
npm.cmd test -- src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Expected: PASS with all tests in `NeonDGame.test.tsx` green and no unexpected warnings.

- [ ] **Step 7: Run the complete Neon-D and frontend verification set**

Run each command from `src/Brmble.Web`:

```powershell
npm.cmd test -- src/components/NeonD
npm.cmd run type-check
npx.cmd eslint src/components/NeonD/MusclePanel.tsx src/components/NeonD/muscleVisibility.ts src/components/NeonD/__tests__/muscleVisibility.test.ts src/components/NeonD/__tests__/NeonDGame.test.tsx
npm.cmd run build
```

Then run from the worktree root:

```powershell
git diff --check
git status --short
```

Expected:

- all Neon-D tests PASS;
- TypeScript exits 0;
- ESLint exits 0;
- the production build exits 0;
- `git diff --check` prints nothing;
- status lists only the intended Muscle files, this plan file if not already committed, and the unrelated untracked `Brmble-Run.bat`.

- [ ] **Step 8: Inspect the final Muscle UI at desktop and narrow widths**

Run:

```powershell
npm.cmd run dev -- --host 127.0.0.1
```

Open Neon-D, switch to Muscle, and verify:

- Hood Rat and Young Thug are the only fresh-state worker rows;
- both compact rows show owned count, individual rate, total contribution, and price;
- Territory and Discount share one row at desktop width;
- `Show all 8 later tiers` reveals every worker and `Hide later tiers` collapses them;
- the purchase action stacks below worker details and fills the row at the existing narrow breakpoint;
- no horizontal scrolling, clipped prices, or inaccessible focus states appear.

Stop the development server after inspection.

- [ ] **Step 9: Commit the compact UI**

```powershell
git add -- src/Brmble.Web/src/components/NeonD/MusclePanel.tsx src/Brmble.Web/src/components/NeonD/NeonD.module.css src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx
git commit -m "feat: compact muscle progression"
```

Do not stage or commit `Brmble-Run.bat`.
