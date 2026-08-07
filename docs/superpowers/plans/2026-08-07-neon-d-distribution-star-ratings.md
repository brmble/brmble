# Neon-D Distribution Star Ratings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace normal dealer Volume and Margin numbers in the Neon-D Distribution panel with five-star visual ratings while keeping the exact multipliers available on hover and keyboard focus.

**Architecture:** Add a focused `DealerRating` presentation component in the Neon-D component directory. It will round and clamp the existing dealer multiplier to a whole-star count, render five accessible star elements, and expose the original multiplier through `title` and an accessible label. `DistributionPanel` will use it for normal candidate and active dealer cards only; gameplay and data modules remain unchanged.

**Tech Stack:** React 19, TypeScript, CSS Modules, Vitest, Testing Library, existing Neon-D design tokens.

## Global Constraints

- Do not change simulation, save data, dealer generation, or multiplier calculations.
- Apply ratings to normal dealer candidates and active dealers only.
- Keep Main sales and Earnings as numeric rates.
- Keep Captain Volume and Margin as numeric base metrics.
- Round the existing multiplier to the nearest whole star, so `1.3` displays as 1 star and `1.6` displays as 2 stars.
- Use filled and empty stars only; do not render half-stars.
- Do not add a dependency or icon library.
- The rating is display-only and must not be interactive.

---

## File Map

- Create `src/Brmble.Web/src/components/NeonD/DealerRating.tsx`: reusable display component and pure multiplier-to-rating conversion.
- Create `src/Brmble.Web/src/components/NeonD/DealerRating.module.css`: filled and empty star presentation plus focus/hover affordance.
- Modify `src/Brmble.Web/src/components/NeonD/DistributionPanel.tsx`: replace normal dealer Volume and Margin numeric rows with `DealerRating`.
- Modify `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`: update obsolete star absence coverage and add candidate/active dealer rendering and exact-value accessibility assertions.
- Create `src/Brmble.Web/src/components/NeonD/__tests__/DealerRating.test.tsx`: unit tests for whole-star rounding, clamping, and accessible text.

## Task 1: Add the tested rating conversion and component

**Files:**
- Create: `src/Brmble.Web/src/components/NeonD/DealerRating.tsx`
- Create: `src/Brmble.Web/src/components/NeonD/DealerRating.module.css`
- Test: `src/Brmble.Web/src/components/NeonD/__tests__/DealerRating.test.tsx`

**Interfaces:**
- Consumes: `label: 'Volume' | 'Margin'` and `multiplier: number`.
- Produces: `DealerRating` React component and an exported `getDealerStarRating(multiplier: number): number` helper returning a clamped whole-star value from `0` through `5`.

- [ ] **Step 1: Write failing conversion and rendering tests**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DealerRating, getDealerStarRating } from '../DealerRating';

describe('getDealerStarRating', () => {
  it.each([
    [1.3, 1],
    [1.6, 2],
  ])('rounds %s multiplier to %s whole stars', (multiplier, expected) => {
    expect(getDealerStarRating(multiplier)).toBe(expected);
  });

  it('clamps malformed out-of-range values to the visible scale', () => {
    expect(getDealerStarRating(0)).toBe(0);
    expect(getDealerStarRating(5)).toBe(5);
  });
});

describe('DealerRating', () => {
  it('exposes the exact multiplier through its label and title', () => {
    render(<DealerRating label="Volume" multiplier={1.23} />);

    const rating = screen.getByRole('img', { name: 'Volume: 1.23x' });
    expect(rating).toHaveAttribute('title', 'Volume: 1.23x');
    expect(rating.querySelectorAll('[data-star-state="full"]')).toHaveLength(1);
    expect(rating.querySelectorAll('[data-star-state="half"]')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run from `src/Brmble.Web`:

```powershell
npm run test -- src/components/NeonD/__tests__/DealerRating.test.tsx
```

Expected: FAIL because `DealerRating.tsx` does not exist yet.

- [ ] **Step 3: Write the minimal component and styles**

Implement `getDealerStarRating` by rounding the multiplier to the nearest whole number and clamping it to `0`–`5`. Render five star positions with `data-star-state="full|empty"` and `aria-hidden="true"` inside a non-interactive, keyboard-focusable `role="img"` wrapper whose `aria-label` and `title` are `Volume: 1.23x` or `Margin: 0.87x`. Use `tabIndex={0}` on that wrapper so keyboard users can reach the exact-value label and visible focus styling without making the rating actionable.

Use existing Neon-D CSS module tokens. Keep stars on one line, distinguish full/empty states, and add visible hover and `:focus-visible` treatments. Do not add a dependency, button behavior, or click handling.

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```powershell
npm run test -- src/components/NeonD/__tests__/DealerRating.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the component and unit tests**

```powershell
git add -- src/Brmble.Web/src/components/NeonD/DealerRating.tsx src/Brmble.Web/src/components/NeonD/DealerRating.module.css src/Brmble.Web/src/components/NeonD/__tests__/DealerRating.test.tsx
git commit -m "feat: add neon-d dealer star rating"
```

## Task 2: Integrate ratings into DistributionPanel

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/DistributionPanel.tsx`
- Test: `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`

**Interfaces:**
- Consumes: `DealerRating` from `../DealerRating` with existing `Dealer.volumeMultiplier` and `Dealer.marginMultiplier` values.
- Produces: normal candidate and active dealer cards that show star ratings while preserving numeric Main sales, Earnings, and Captain base metrics.

- [ ] **Step 1: Replace numeric normal-dealer rows with the component**

Import `DealerRating` and replace the Volume and Margin numeric rows in both `CandidateCard` and the active-dealer branch with:

```tsx
<DealerRating label="Volume" multiplier={candidate.volumeMultiplier} />
<DealerRating label="Margin" multiplier={candidate.marginMultiplier} />
```

and:

```tsx
<DealerRating label="Volume" multiplier={dealer.volumeMultiplier} />
<DealerRating label="Margin" multiplier={dealer.marginMultiplier} />
```

Do not change calls to `getNormalDealerMainSaleRate`, earnings formatting, arrest handling, equipment behavior, or any Captain rows.

- [ ] **Step 2: Update the existing UI test from absence to presence**

In `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`, replace the obsolete assertion that dealer star ratings are absent with a Research Speed-only assertion:

```tsx
it('does not render Research Speed', () => {
  render(<NeonDGame />);

  expect(screen.queryByText(/research speed/i)).not.toBeInTheDocument();
});
```

Extend dealer UI coverage with accessible exact-value assertions such as:

```tsx
expect(screen.getAllByRole('img', { name: /volume: 1\.23x/i }).length).toBeGreaterThan(0);
expect(screen.getAllByRole('img', { name: /margin: 0\.87x/i }).length).toBeGreaterThan(0);
expect(screen.getAllByText(/main sales/i).length).toBeGreaterThan(0);
expect(screen.getByText(/1\.5x base/i)).toBeInTheDocument();
```

In the candidate-pool test, query Candidate One’s card and assert its Volume and Margin rating accessible names contain `1.23x` and `0.87x`. This covers both empty-slot candidates and the active dealer card.

- [ ] **Step 3: Run the focused Neon-D test to verify integration**

Run:

```powershell
npm run test -- src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Expected: PASS, including the unchanged gameplay assertions.

- [ ] **Step 4: Commit the panel integration and UI tests**

```powershell
git add -- src/Brmble.Web/src/components/NeonD/DistributionPanel.tsx src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx
git commit -m "feat: show neon-d dealer metrics as stars"
```

## Task 3: Run complete verification

**Files:**
- Verify: `src/Brmble.Web/src/components/NeonD/DealerRating.tsx`
- Verify: `src/Brmble.Web/src/components/NeonD/DistributionPanel.tsx`
- Verify: `src/Brmble.Web/src/components/NeonD/__tests__/DealerRating.test.tsx`
- Verify: `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`

**Interfaces:**
- Consumes: completed component and panel changes from Tasks 1–2.
- Produces: verified display-only behavior with no gameplay or persistence changes.

- [ ] **Step 1: Run all Neon-D tests**

Run from `src/Brmble.Web`:

```powershell
npm run test -- src/components/NeonD
```

Expected: PASS for all Neon-D tests.

- [ ] **Step 2: Run the web type-check and lint**

Run:

```powershell
npm run type-check
npm run lint
```

Expected: both commands complete successfully with no new diagnostics.

- [ ] **Step 3: Inspect the final diff for gameplay isolation**

Run from the repository root:

```powershell
git diff HEAD~2 -- src/Brmble.Web/src/components/NeonD
```

Confirm that only `DealerRating` presentation files, `DistributionPanel.tsx`, and their tests changed; `dealers.ts`, `economy.ts`, `simulation.ts`, `saveFormat.ts`, and `types.ts` must not be modified.

- [ ] **Step 4: Commit any verification-only cleanup if needed**

Only if the prior checks require a small presentation/test correction, run the focused test again and commit the correction with:

```powershell
git add -- src/Brmble.Web/src/components/NeonD
git commit -m "test: verify neon-d dealer star ratings"
```
