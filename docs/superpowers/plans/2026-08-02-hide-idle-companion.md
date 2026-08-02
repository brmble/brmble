# Hide Idle Local Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted Interface setting that hides the local companion while the companion overlay is idle, while preserving all activity displays.

**Architecture:** Extend `OverlaySettings` with a backward-compatible default. Add the toggle to the existing Interface settings tab. Pass the setting into the overlay display resolver so idle resolution returns `null` when disabled; activity resolution remains unchanged.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Vite.

## Global Constraints

- Preserve existing behavior by default: `showLocalCompanionWhenIdle` defaults to `true`.
- Keep the scope limited to overlay settings, Interface settings UI, overlay resolution, and tests.
- Follow the existing settings toggle and CSS token patterns documented in `docs/UI_GUIDE.md`.
- Use test-first development: each behavior test must fail before its implementation is added.

---

### Task 1: Extend overlay settings with a backward-compatible default

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.ts`
- Test: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.test.ts`

**Interfaces:**
- Produces `OverlaySettings.showLocalCompanionWhenIdle: boolean` for the settings UI and overlay model.
- `normalizeOverlaySettings` must return `true` when the property is absent from persisted or bridge-provided settings.

- [ ] **Step 1: Write the failing tests**

Add assertions showing that `DEFAULT_OVERLAY.showLocalCompanionWhenIdle` is `true` and that `normalizeOverlaySettings({ showLocalCompanionWhenIdle: false })` preserves `false`, while `normalizeOverlaySettings({})` restores the default `true`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run from `src/Brmble.Web`:

```powershell
npm run test -- src/components/SettingsModal/InterfaceSettingsTypes.test.ts
```

Expected: FAIL because the setting does not yet exist on `OverlaySettings`/`DEFAULT_OVERLAY`.

- [ ] **Step 3: Write the minimal implementation**

Add `showLocalCompanionWhenIdle: boolean` to `OverlaySettings` and add `showLocalCompanionWhenIdle: true` to `DEFAULT_OVERLAY`. Existing object-spread normalization then supplies the default for older settings automatically.

- [ ] **Step 4: Run the focused test to verify it passes**

Run the same command and expect the settings type/default tests to pass.

- [ ] **Step 5: Commit the task**

```powershell
git add -- src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.ts src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.test.ts
git commit -m "feat: add idle companion setting"
```

### Task 2: Add the Interface settings toggle

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx`

**Interfaces:**
- Consumes `OverlaySettings.showLocalCompanionWhenIdle` from Task 1.
- Produces an accessible checkbox labeled `Show My Companion When Idle` that calls `onOverlayChange` with the toggled setting.

- [ ] **Step 1: Write the failing test**

In the existing overlay controls test, render `InterfaceSettingsTab` with the default settings, click `screen.getByLabelText('Show My Companion When Idle')`, and assert that `onOverlayChange` receives an object containing `{ showLocalCompanionWhenIdle: false }`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
npm run test -- src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx
```

Expected: FAIL because the new label/control is not rendered.

- [ ] **Step 3: Write the minimal implementation**

Add a settings-toggle row in the existing In-Game Overlay section using the established pattern:

```tsx
<div className="settings-item settings-toggle">
  <label htmlFor="overlay-show-local-idle">Show My Companion When Idle</label>
  <label className="brmble-toggle">
    <input
      id="overlay-show-local-idle"
      type="checkbox"
      checked={overlaySettings.showLocalCompanionWhenIdle}
      onChange={() => onOverlayChange({
        ...overlaySettings,
        showLocalCompanionWhenIdle: !overlaySettings.showLocalCompanionWhenIdle,
      })}
    />
    <span className="brmble-toggle-slider"></span>
  </label>
</div>
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run the same test command and expect the settings tab tests to pass.

- [ ] **Step 5: Commit the task**

```powershell
git add -- src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx src/Brmble.Web/src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx
git commit -m "feat: add idle companion toggle"
```

### Task 3: Hide the idle display in the overlay model

**Files:**
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts`

**Interfaces:**
- Consumes `OverlaySettings.showLocalCompanionWhenIdle` from Task 1.
- Updates `resolveFullCompanionDisplay(snapshot, now, settings)` to use the setting when creating the fallback idle display.

- [ ] **Step 1: Write the failing tests**

Update the existing idle-display tests to pass `DEFAULT_OVERLAY` as the third argument. Add a test that calls `resolveFullCompanionDisplay(createOverlaySnapshot('7', 'Raid'), 1_000, { ...DEFAULT_OVERLAY, showLocalCompanionWhenIdle: false })` and asserts `activeDisplay` is `null`. Add an activity regression assertion using the same disabled setting: append a channel message, resolve it, and assert the active display is `kind: 'chat'`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
npm run test -- src/components/CompanionOverlay/overlayModel.test.ts
```

Expected: FAIL because the resolver currently accepts only two arguments and always creates an idle display.

- [ ] **Step 3: Write the minimal implementation**

Change the resolver signature to accept `settings: OverlaySettings`. At the final idle fallback, create `idleDisplay(...)` only when `settings.showLocalCompanionWhenIdle` is true; otherwise return the snapshot with `activeDisplay: null` while preserving queues and other state. Update all resolver call sites to pass the current overlay settings, including App event/speaker paths and existing tests.

- [ ] **Step 4: Run the focused test to verify it passes**

Run the same command and expect all overlay model tests to pass, including the existing default-idle and activity tests.

- [ ] **Step 5: Commit the task**

```powershell
git add -- src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts src/Brmble.Web/src/App.tsx
git commit -m "feat: hide local companion while overlay is idle"
```

### Task 4: Run complete frontend verification

**Files:**
- Verify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.ts`
- Verify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`
- Verify: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts`
- Verify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Run the focused regression tests**

```powershell
cd src/Brmble.Web
npm run test -- src/components/SettingsModal/InterfaceSettingsTypes.test.ts src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx src/components/CompanionOverlay/overlayModel.test.ts
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 2: Run the frontend type check/build**

```powershell
npm run build
```

Expected: TypeScript compilation and Vite build complete successfully.

- [ ] **Step 3: Inspect the final diff**

```powershell
git diff feature/all-broadcast...HEAD --stat
git status --short --branch
```

Expected: only the approved spec, plan, implementation, and tests from this feature are committed; pre-existing unrelated working-tree changes remain untouched.
