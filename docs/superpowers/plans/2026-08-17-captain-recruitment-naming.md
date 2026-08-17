# Captain Recruitment Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player name a Captain in a confirmation dialog before the existing Captain purchase and run reset are applied.

**Architecture:** Add a small `CaptainRecruitmentDialog` component that owns only temporary input state and calls `onConfirm(trimmedName)`. `NeonDGame` owns whether the dialog is open and passes the next generated default name. `useGameEngine.buyCaptain(name)` remains the single state-mutating path and creates the Captain with the confirmed name after validating it.

**Tech Stack:** React 19, TypeScript 5.9, Vitest, Testing Library, Vite.

## Global Constraints

- Surrounding whitespace is removed before the name is saved.
- The Confirm action is disabled for an empty or whitespace-only value.
- The engine ignores empty or whitespace-only names as a defensive safeguard.
- No additional name-length or uniqueness rule is introduced in this change.
- Existing Captain cost, prestige/run reset, assignment, persistence, and later rename behavior remain unchanged.
- Normal dealer recruitment is unchanged.

---

## File Map

- Modify `src/Brmble.Web/src/components/NeonD/dealers.ts` to expose the generated default-name rule and allow `createCaptain` to receive a confirmed name.
- Modify `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts` to accept and validate a Captain name before creating the Captain.
- Modify `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx` to open the dialog, pass the default name, and submit the confirmed name to the engine.
- Modify `src/Brmble.Web/src/components/NeonD/NeonD.module.css` with focused dialog layout styles.
- Create `src/Brmble.Web/src/components/NeonD/CaptainRecruitmentDialog.tsx` for the accessible name-entry modal.
- Modify `src/Brmble.Web/src/components/NeonD/__tests__/dealers.test.ts` for the default-name and explicit-name contract.
- Modify `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts` for engine-level naming and invalid-name behavior.
- Create `src/Brmble.Web/src/components/NeonD/__tests__/CaptainRecruitmentDialog.test.tsx` for dialog behavior.
- Modify `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx` for the integrated recruitment flow.

### Task 1: Add the engine Captain-name contract

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/dealers.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`
- Test: `src/Brmble.Web/src/components/NeonD/__tests__/dealers.test.ts`
- Test: `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`

**Interfaces:**
- Produces `getCaptainDefaultName(index: number): string`.
- Changes `createCaptain(index: number, name?: string): Captain` so omitted names retain the generated `Captain N` fallback.
- Changes `useGameEngine().buyCaptain` to accept `name: string` from the recruitment dialog.

- [ ] **Step 1: Write the failing unit tests for explicit Captain names.**

Append to `dealers.test.ts`:

```ts
it('uses a supplied Captain name while retaining the generated default', () => {
  expect(createCaptain(2, '  Nightshade  ')).toMatchObject({ name: '  Nightshade  ' });
  expect(createCaptain(2)).toMatchObject({ name: 'Captain 2' });
});
```

Add this engine test near the existing Captain purchase tests in `useGameEngine.test.ts`:

```ts
it('creates a Captain with the confirmed name', () => {
  const { result } = renderSeededGame({
    cash: 7_500_000,
    runEarnings: 7_500_000,
  });

  act(() => result.current.buyCaptain('  Nightshade  '));

  expect(result.current.state.captains[0].name).toBe('Nightshade');
  expect(result.current.state.cash).toBe(100);
});

it('does not recruit or charge for an empty Captain name', () => {
  const { result } = renderSeededGame({
    cash: 7_500_000,
    runEarnings: 7_500_000,
  });

  act(() => result.current.buyCaptain('   '));

  expect(result.current.state.captains).toEqual([]);
  expect(result.current.state.cash).toBe(7_500_000);
});
```

Update existing direct engine calls in this file from `buyCaptain()` to `buyCaptain('Captain 1')` or the relevant expected generated name so they exercise the new required caller contract without changing their existing assertions.

- [ ] **Step 2: Run the focused tests and verify they fail for the missing name behavior.**

Run from `src/Brmble.Web`:

```text
npm run test -- src/components/NeonD/__tests__/dealers.test.ts src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
```

Expected result: FAIL because `createCaptain` does not yet accept a name and `buyCaptain` does not yet accept or preserve the submitted name.

- [ ] **Step 3: Implement the minimal engine changes.**

In `dealers.ts`, add the shared fallback helper and update Captain creation:

```ts
export const getCaptainDefaultName = (index: number) => `Captain ${index}`;

export const createCaptain = (
  index: number,
  name: string = getCaptainDefaultName(index),
): Captain => ({
  id: crypto.randomUUID(),
  name,
  selling: 'weed',
  equipmentIds: [],
  personalEarnings: 0,
  lastLevelUpEarnings: 0,
  level: 0,
  talentPoints: 0,
  talentRanks: { red: [0, 0, 0], yellow: [0, 0, 0], blue: [0, 0, 0] },
  ledgerUnlocked: false,
  kingpinAvailable: false,
});
```

In `useGameEngine.ts`, change the action to validate before entering the state updater and pass the trimmed value into `createCaptain`:

```ts
const buyCaptain = (name: string) => {
  const trimmedName = name.trim();
  if (!trimmedName) return;

  setState((prev) => {
    if (!isCaptainVisible(prev)) return prev;

    const cost = getCaptainCost(prev);
    if (prev.cash < cost) return prev;

    const captain = createCaptain(
      prev.captains.length + prev.kingpins + 1,
      trimmedName,
    );
    return resetRunPreservingPrestige(
      [...prev.captains, captain],
      prev.kingpins,
      Date.now(),
    );
  });
};
```

- [ ] **Step 4: Run the focused tests and verify they pass.**

Run:

```text
npm run test -- src/components/NeonD/__tests__/dealers.test.ts src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
```

Expected result: PASS, including the existing cost, reset, persistence, and prestige tests.

- [ ] **Step 5: Commit the engine slice.**

```text
git add -- src/Brmble.Web/src/components/NeonD/dealers.ts src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts src/Brmble.Web/src/components/NeonD/__tests__/dealers.test.ts src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
git commit -m "feat: support naming Captains during recruitment"
```

### Task 2: Build the recruitment name dialog

**Files:**
- Create: `src/Brmble.Web/src/components/NeonD/CaptainRecruitmentDialog.tsx`
- Modify: `src/Brmble.Web/src/components/NeonD/NeonD.module.css`
- Test: `src/Brmble.Web/src/components/NeonD/__tests__/CaptainRecruitmentDialog.test.tsx`

**Interfaces:**
- Consumes `defaultName: string`, `onConfirm: (name: string) => void`, and `onClose: () => void`.
- Produces an accessible `role="dialog"` named `Name your Captain`, a textbox named `Captain name`, a Confirm button named `Confirm Captain name`, and a Cancel button named `Cancel Captain naming`.

- [ ] **Step 1: Write the failing dialog tests.**

Create `CaptainRecruitmentDialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CaptainRecruitmentDialog } from '../CaptainRecruitmentDialog';

describe('CaptainRecruitmentDialog', () => {
  it('starts with the generated default and confirms a trimmed name', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <CaptainRecruitmentDialog
        defaultName="Captain 2"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Captain name' });
    expect(input).toHaveValue('Captain 2');

    await user.clear(input);
    await user.type(input, '  Nightshade  ');
    await user.click(screen.getByRole('button', { name: 'Confirm Captain name' }));

    expect(onConfirm).toHaveBeenCalledWith('Nightshade');
  });

  it('disables confirmation for a whitespace-only name', async () => {
    const user = userEvent.setup();

    render(
      <CaptainRecruitmentDialog
        defaultName="Captain 2"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Captain name' });
    await user.clear(input);
    await user.type(input, '   ');

    expect(screen.getByRole('button', { name: 'Confirm Captain name' })).toBeDisabled();
  });

  it('closes without confirming when cancelled or escaped', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <CaptainRecruitmentDialog
        defaultName="Captain 2"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel Captain naming' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the dialog test and verify it fails because the component does not exist.**

Run:

```text
npm run test -- src/components/NeonD/__tests__/CaptainRecruitmentDialog.test.tsx
```

Expected result: FAIL with the missing-component/import failure.

- [ ] **Step 3: Implement the accessible dialog.**

Create `CaptainRecruitmentDialog.tsx` with this behavior:

```tsx
import { useEffect, useRef, useState } from 'react';
import styles from './NeonD.module.css';

type CaptainRecruitmentDialogProps = {
  defaultName: string;
  onConfirm: (name: string) => void;
  onClose: () => void;
};

export function CaptainRecruitmentDialog({
  defaultName,
  onConfirm,
  onClose,
}: CaptainRecruitmentDialogProps) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const trimmedName = name.trim();

  return (
    <div
      className={styles.captainRecruitmentBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.captainRecruitmentDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="captain-recruitment-title"
      >
        <h2 id="captain-recruitment-title" className="heading-title modal-title">Name your Captain</h2>
        <p className={styles.label}>Give your new Captain a name before recruiting him.</p>
        <form onSubmit={(event) => { event.preventDefault(); if (trimmedName) onConfirm(trimmedName); }}>
          <label className={styles.captainRecruitmentField}>
            <span>Captain name</span>
            <input
              ref={inputRef}
              className="brmble-input"
              value={name}
              aria-label="Captain name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className={styles.captainRecruitmentActions}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel Captain naming
            </button>
            <button type="submit" className="btn btn-primary" disabled={!trimmedName}>
              Confirm Captain name
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

Add the dialog backdrop, panel, field, and action-row styles beside the existing Neon-D modal styles. Keep the modal centered, constrain the input row to the existing panel width, and ensure the action buttons wrap on narrow screens without changing unrelated dealer or Captain card styles.

- [ ] **Step 4: Run the dialog tests and verify they pass.**

Run:

```text
npm run test -- src/components/NeonD/__tests__/CaptainRecruitmentDialog.test.tsx
```

Expected result: PASS with no console errors.

- [ ] **Step 5: Commit the dialog slice.**

```text
git add -- src/Brmble.Web/src/components/NeonD/CaptainRecruitmentDialog.tsx src/Brmble.Web/src/components/NeonD/NeonD.module.css src/Brmble.Web/src/components/NeonD/__tests__/CaptainRecruitmentDialog.test.tsx
git commit -m "feat: add Captain recruitment naming dialog"
```

### Task 3: Wire the dialog into the Captain milestone card

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx`
- Test: `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`

**Interfaces:**
- Consumes `CaptainRecruitmentDialog`, `getCaptainDefaultName`, and `buyCaptain(name)`.
- Produces a recruitment flow where the existing **Hire Captain** button opens the dialog, and only dialog confirmation invokes the engine.

- [ ] **Step 1: Replace the existing immediate-recruitment integration test with the failing dialog flow.**

Update the existing `shows the Captain prestige controls and invokes buyCaptain` test in `NeonDGame.test.tsx` to assert deferred recruitment:

```tsx
it('opens Captain naming before invoking recruitment', async () => {
  const user = userEvent.setup();
  mockState({
    cash: CAPTAIN_COSTS[1],
    runEarnings: CAPTAIN_VISIBLE_EARNINGS,
    captains: [],
    kingpins: 0,
  });

  render(<NeonDGame />);
  await user.click(screen.getByRole('button', { name: /hire captain/i }));

  const dialog = screen.getByRole('dialog', { name: 'Name your Captain' });
  expect(dialog).toBeInTheDocument();
  const input = within(dialog).getByRole('textbox', { name: 'Captain name' });
  expect(input).toHaveValue('Captain 1');
  expect(mockNeonD.buyCaptainMock).not.toHaveBeenCalled();

  await user.clear(input);
  await user.type(input, 'Nightshade');
  await user.click(within(dialog).getByRole('button', { name: 'Confirm Captain name' }));

  expect(mockNeonD.buyCaptainMock).toHaveBeenCalledWith('Nightshade');
  expect(screen.queryByRole('dialog', { name: 'Name your Captain' })).not.toBeInTheDocument();
});
```

Add a second integration test that clicks **Hire Captain**, presses **Cancel Captain naming**, and asserts `buyCaptainMock` was not called.

- [ ] **Step 2: Run the integration tests and verify they fail.**

Run:

```text
npm run test -- src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Expected result: FAIL because the existing button still calls `buyCaptain` directly and the dialog is not rendered.

- [ ] **Step 3: Implement the parent-owned dialog state and submit path.**

In `NeonDGame.tsx`:

1. Import `CaptainRecruitmentDialog` and `getCaptainDefaultName`.
2. Add `const [isCaptainRecruitmentOpen, setIsCaptainRecruitmentOpen] = useState(false);` beside the existing local UI state.
3. Compute `const captainDefaultName = getCaptainDefaultName(state.captains.length + state.kingpins + 1);` from the current state.
4. Change the milestone button from `onClick={buyCaptain}` to `onClick={() => setIsCaptainRecruitmentOpen(true)}`.
5. Render the dialog near the other top-level overlays:

```tsx
{isCaptainRecruitmentOpen && (
  <CaptainRecruitmentDialog
    defaultName={captainDefaultName}
    onClose={() => setIsCaptainRecruitmentOpen(false)}
    onConfirm={(name) => {
      buyCaptain(name);
      setIsCaptainRecruitmentOpen(false);
    }}
  />
)}
```

The dialog must be rendered only while open. Closing it must not call `buyCaptain`; confirming must pass the trimmed value exactly once and then close the dialog.

- [ ] **Step 4: Run the integration tests and verify they pass.**

Run:

```text
npm run test -- src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Expected result: PASS, including existing Captain milestone, reset, distribution, and offline-summary UI tests.

- [ ] **Step 5: Commit the integrated flow.**

```text
git add -- src/Brmble.Web/src/components/NeonD/NeonDGame.tsx src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx
git commit -m "feat: name Captain before purchase"
```

### Task 4: Run the complete verification suite

**Files:**
- Verify: all files changed by Tasks 1–3.

- [ ] **Step 1: Run the complete Neon-D test suite.**

Run from `src/Brmble.Web`:

```text
npm run test -- src/components/NeonD
```

Expected result: PASS for all Neon-D tests with no unhandled errors.

- [ ] **Step 2: Run the web type-check and production build.**

Run:

```text
npm run type-check
npm run build
```

Expected result: both commands exit successfully with no TypeScript errors or Vite build errors.

- [ ] **Step 3: Run lint on the web project.**

Run:

```text
npm run lint
```

Expected result: no new lint errors or warnings from the Captain recruitment naming change.

- [ ] **Step 4: Inspect the final diff and working tree.**

Run:

```text
git diff --check HEAD~3..HEAD
git status --short
```

Expected result: no whitespace errors; only the intentional feature commits and the user’s pre-existing untracked files remain in the working tree.

- [ ] **Step 5: Record the verification result.**

If verification reveals a defect in the feature, return to the task that owns the failing behavior, add its regression test before changing production code, rerun the failed command, and commit the corrected feature files with a message describing the specific defect. Do not stage any of the branch's pre-existing untracked files.
