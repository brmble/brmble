# Captain Card Rename Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a discoverable pencil button to owned Captain card headers that opens an inline rename editor and reuses the existing Captain rename persistence behavior.

**Architecture:** Keep transient edit state inside `DistributionPanel`, where Captain cards are rendered. Add a shared `pencil` icon to `Icon.tsx`, use the existing token-based card action styles, and call the existing `onRenameCaptain(captainId, name)` callback after trim/validation. The game engine and save format remain unchanged.

**Tech Stack:** React 19, TypeScript, CSS Modules, Vitest, Testing Library, user-event, Vite.

## Global Constraints

- Use the existing `renameCaptain` engine behavior; do not change save schema or engine API.
- The rename control must work for assigned and unassigned Captain cards.
- Enter and blur commit trimmed names; Escape cancels; blank names do not call the rename callback.
- Use the shared `Icon` component and CSS custom-property tokens; do not hardcode visual values.
- Follow `docs/UI_GUIDE.md`, especially the shared icon and compact button patterns.
- Use test-first development: each production change follows a test that failed for the intended missing behavior.

---

### Task 1: Add failing coverage for Captain card rename interaction

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/__tests__/DistributionPanel.test.tsx`
- Read: `src/Brmble.Web/src/components/NeonD/DistributionPanel.tsx`
- Read: `src/Brmble.Web/src/components/NeonD/__tests__/testFixtures.ts`

**Interfaces:**
- Consumes: `DistributionPanel` props, `makeReferenceCaptain`, Testing Library, `userEvent`.
- Produces: Regression coverage describing the rename button label, editor input label, commit behavior, cancel behavior, and blank-name behavior.

- [ ] **Step 1: Write the failing tests**

Add a Captain-specific describe block to `DistributionPanel.test.tsx`. Use a fresh props object per test so the callback call count is isolated. The tests should render at least one unassigned Captain and one assigned Captain, proving both card forms expose the same control.

```tsx
describe('Captain card rename control', () => {
  const captain = makeReferenceCaptain({ id: 'captain-rename', name: 'Captain Rename' });

  const renderCaptainPanel = (
    overrides: Partial<typeof state> = {},
    onRenameCaptain = vi.fn(),
  ) => {
    render(
      <DistributionPanel
        {...panelProps}
        onRenameCaptain={onRenameCaptain}
        state={{
          ...state,
          activeDealers: [null, { ...captain, id: 'captain-assigned', name: 'Assigned Captain' }],
          captains: [captain, { ...captain, id: 'captain-assigned', name: 'Assigned Captain' }],
          ...overrides,
        }}
      />,
    );
    return onRenameCaptain;
  };

  it('shows a rename button for assigned and unassigned Captain cards', () => {
    renderCaptainPanel();

    expect(screen.getByRole('button', { name: 'Rename Captain Rename' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename Assigned Captain' })).toBeInTheDocument();
  });

  it('opens the current name, commits a trimmed name, and closes the editor', async () => {
    const user = userEvent.setup();
    const onRenameCaptain = renderCaptainPanel();

    await user.click(screen.getByRole('button', { name: 'Rename Captain Rename' }));
    const input = screen.getByRole('textbox', { name: 'Name for Captain Rename' });
    expect(input).toHaveValue('Captain Rename');

    await user.clear(input);
    await user.type(input, '  Nightshade  ');
    await user.keyboard('{Enter}');

    expect(onRenameCaptain).toHaveBeenCalledWith('captain-rename', 'Nightshade');
    expect(screen.queryByRole('textbox', { name: 'Name for Captain Rename' })).not.toBeInTheDocument();
  });

  it('cancels with Escape without renaming', async () => {
    const user = userEvent.setup();
    const onRenameCaptain = renderCaptainPanel();

    await user.click(screen.getByRole('button', { name: 'Rename Captain Rename' }));
    const input = screen.getByRole('textbox', { name: 'Name for Captain Rename' });
    await user.clear(input);
    await user.type(input, 'Temporary');
    await user.keyboard('{Escape}');

    expect(onRenameCaptain).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Name for Captain Rename' })).not.toBeInTheDocument();
  });

  it('rejects a whitespace-only name when the editor loses focus', async () => {
    const user = userEvent.setup();
    const onRenameCaptain = renderCaptainPanel();

    await user.click(screen.getByRole('button', { name: 'Rename Captain Rename' }));
    const input = screen.getByRole('textbox', { name: 'Name for Captain Rename' });
    await user.clear(input);
    await user.type(input, '   ');
    await user.tab();

    expect(onRenameCaptain).not.toHaveBeenCalled();
  });
});
```

Use the callback passed in `panelProps` as the spy for the assertions; if the shared object makes tests leak calls, create `const onRenameCaptain = vi.fn()` inside the render helper and pass it through the props, returning it from the helper.

- [ ] **Step 2: Run the focused tests and verify the failure is for missing UI**

Run from `src/Brmble.Web`:

```powershell
npm run test -- src/components/NeonD/__tests__/DistributionPanel.test.tsx
```

Expected: the new tests fail because the Captain card has no rename button/input yet. Existing hiring-entry tests should remain passing; if the test file errors instead of failing assertions, fix the test setup before writing production code.

### Task 2: Implement the icon and Captain card rename editor

**Files:**
- Modify: `src/Brmble.Web/src/components/Icon/Icon.tsx`
- Modify: `docs/UI_GUIDE.md`
- Modify: `src/Brmble.Web/src/components/NeonD/DistributionPanel.tsx`
- Modify: `src/Brmble.Web/src/components/NeonD/NeonD.module.css`
- Test: `src/Brmble.Web/src/components/NeonD/__tests__/DistributionPanel.test.tsx`

**Interfaces:**
- Consumes: `Captain`, `DistributionPanelProps.onRenameCaptain`, shared `Icon`, existing `.cardHeaderActions` and `.cardCollapseButton` styles.
- Produces: `<Icon name="pencil" />`, a header button labeled `Rename ${captain.name}`, and an inline input labeled `Name for ${captain.name}`.

- [ ] **Step 1: Add the shared pencil icon**

In the UI actions section of `Icon.tsx`, add a Lucide-style pencil entry:

```tsx
'pencil': {
  paths: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
},
```

Update the UI guide’s available-icon table to list `pencil` under UI actions. Do not add a new icon component or hardcoded visual values.

- [ ] **Step 2: Add local editor state and commit/cancel handlers**

In `DistributionPanel`, add:

```tsx
const [editingCaptainId, setEditingCaptainId] = useState<string | null>(null);
const [captainDraftName, setCaptainDraftName] = useState('');
const captainRenameInputRef = useRef<HTMLInputElement>(null);

useEffect(() => {
  if (editingCaptainId) {
    captainRenameInputRef.current?.focus();
    captainRenameInputRef.current?.select();
  }
}, [editingCaptainId]);

const startCaptainRename = (captain: Captain) => {
  setCaptainDraftName(captain.name);
  setEditingCaptainId(captain.id);
};

const cancelCaptainRename = () => {
  setEditingCaptainId(null);
  setCaptainDraftName('');
};

const commitCaptainRename = (captainId: string) => {
  const trimmedName = captainDraftName.trim();
  if (trimmedName) props.onRenameCaptain(captainId, trimmedName);
  cancelCaptainRename();
};
```

Import `useEffect` if it is not already imported. Keep only one editor active at a time. In the Captain header, compute `isEditing = editingCaptainId === captain.id` and render a `cardHeaderActions` wrapper containing the pencil button and existing collapse button. The pencil button must use `type="button"`, `aria-label={`Rename ${captain.name}`}`, `aria-expanded={isEditing}`, and `aria-controls={`captain-rename-${captain.id}`}`. Clicking it calls `startCaptainRename(captain)` and does not toggle collapse.

When `isEditing`, render a compact editor immediately after the header with a stable `id`, a label, and the controlled input. The input should use `value={captainDraftName}`, update draft state on change, commit on blur, and handle keyboard input as follows:

```tsx
onKeyDown={(event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitCaptainRename(captain.id);
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    cancelCaptainRename();
  }
}}
```

Use the current captain name in the label so the control remains understandable after a rename. Because the editor is local and the callback updates the parent state, it should close after every commit or cancel.

- [ ] **Step 3: Add token-based compact styles**

Reuse `.cardHeaderActions` for the header button group and `.cardCollapseButton` as the base visual pattern. Add only the editor layout styles needed in `NeonD.module.css`, using existing tokens:

```css
.captainRenameEditor {
  display: grid;
  gap: var(--space-2xs);
  padding: var(--space-xs);
  background: var(--bg-surface);
}

.captainRenameEditor label {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.captainRenameEditor input {
  min-width: 0;
  padding: var(--space-2xs) var(--space-xs);
  border: var(--border-width-thin) solid var(--glass-border);
  border-radius: var(--radius-xs);
  background: var(--bg-deep);
  color: var(--text-primary);
}

.captainRenameButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.captainRenameButton:hover,
.captainRenameButton:focus-visible {
  background: color-mix(in srgb, currentColor 15%, transparent);
}
```

If an existing token-specific surface or input style is a better fit at implementation time, reuse it rather than duplicating declarations; preserve the same compact layout and token-only rule.

- [ ] **Step 4: Run focused tests and verify green**

Run:

```powershell
npm run test -- src/components/NeonD/__tests__/DistributionPanel.test.tsx
```

Expected: all tests in the file pass, including the four new Captain rename tests and the existing hiring-entry tests. If Enter causes a duplicate callback through blur, use `preventDefault()` and close the editor in the Enter handler, then rerun the test.

- [ ] **Step 5: Commit the implementation**

```powershell
git add -- src/Brmble.Web/src/components/Icon/Icon.tsx docs/UI_GUIDE.md src/Brmble.Web/src/components/NeonD/DistributionPanel.tsx src/Brmble.Web/src/components/NeonD/NeonD.module.css src/Brmble.Web/src/components/NeonD/__tests__/DistributionPanel.test.tsx
git commit -m "feat: add Captain card rename control"
```

### Task 3: Run full relevant verification

**Files:**
- Read: `src/Brmble.Web/package.json`
- Verify: `src/Brmble.Web/src/components/NeonD/__tests__/DistributionPanel.test.tsx`
- Verify: `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`
- Verify: `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`

**Interfaces:**
- Consumes: completed Captain card rename implementation and existing Neon-D tests.
- Produces: fresh evidence that the focused tests, type-check, lint, and production build pass.

- [ ] **Step 1: Run the complete Neon-D component test set**

From `src/Brmble.Web`:

```powershell
npm run test -- src/components/NeonD/__tests__
```

Expected: Vitest exits with code 0 and reports zero failed tests.

- [ ] **Step 2: Run the web type-check**

```powershell
npm run type-check
```

Expected: TypeScript exits with code 0 and reports no errors.

- [ ] **Step 3: Run the web lint**

```powershell
npm run lint
```

Expected: ESLint exits with code 0 and reports no errors.

- [ ] **Step 4: Run the production web build**

```powershell
npm run build
```

Expected: TypeScript/Vite exits with code 0 and produces the frontend build output.

- [ ] **Step 5: Inspect the final diff and status**

```powershell
git diff c9742775..HEAD --stat
git diff c9742775..HEAD --check
git status --short
```

Expected: the implementation commit contains only the planned Captain rename/icon/UI-guide files, the diff has no whitespace errors, and unrelated pre-existing user files remain untouched.

- [ ] **Step 6: Commit any verification-only fixes if needed**

If verification reveals a real implementation issue, fix it with a new failing test first, rerun the relevant command, and commit the correction:

```powershell
git add -- <only-fixed-files>
git commit -m "fix: correct Captain rename interaction"
```
