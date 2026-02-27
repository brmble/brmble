# Animation Tokenization & Reduced Motion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Tokenize all hardcoded animation durations into CSS custom properties, consolidate duplicate keyframes, and add `prefers-reduced-motion` support.

**Architecture:** Add `--animation-*` duration tokens and `--stagger-step` to `:root` in `index.css`. Replace all hardcoded `animation:` durations with these tokens. Move remaining component-local keyframes to the global sheet where shared. Add a `prefers-reduced-motion: reduce` media query that disables all animations.

**Tech Stack:** CSS custom properties, CSS media queries

---

### Task 1: Add animation duration tokens to `:root`

**Files:**
- Modify: `src/Brmble.Web/src/index.css:34-37` (after existing `--transition-*` variables)

**Step 1: Add the new CSS custom properties**

In `index.css`, after line 37 (`--transition-slow: ...`), add:

```css
  /* Animation Durations — one-shot entrance animations */
  --animation-fast: 150ms;
  --animation-normal: 300ms;
  --animation-slow: 400ms;
  --stagger-step: 50ms;

  /* Animation Durations — continuous/looping UI animations */
  --animation-blink: 0.5s;
  --animation-spin: 0.8s;
  --animation-pulse: 1s;
  --animation-speaking-pulse: 1.5s;
  --animation-loading-dots: 1.5s;
  --animation-badge-pop: 400ms;
  --animation-badge-pulse: 2.4s;
  --animation-badge-pulse-delay: 600ms;
```

**Step 2: Commit**

```
git add src/Brmble.Web/src/index.css
git commit -m "feat: add animation duration CSS custom properties"
```

---

### Task 2: Tokenize one-shot entrance animations (content-fade-in pattern)

These are the `content-fade-in 300ms ease` animations used for staggered content reveals. Replace `300ms` with `var(--animation-normal)`.

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.css`
- Modify: `src/Brmble.Web/src/components/CloseDialog/CloseDialog.css`
- Modify: `src/Brmble.Web/src/components/ConnectModal/ConnectModal.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.css`

**Step 1: SettingsModal.css — replace 3 hardcoded durations + 4 stagger delays**

Line 30: `animation: content-fade-in 300ms ease forwards;` → `animation: content-fade-in var(--animation-normal) ease forwards;`
Line 63: `animation: content-fade-in 300ms ease forwards;` → `animation: content-fade-in var(--animation-normal) ease forwards;`
Line 109: `animation: content-fade-in 300ms ease forwards;` → `animation: content-fade-in var(--animation-normal) ease forwards;`

Lines 34-37, replace stagger delays with `calc()`:
```css
.settings-tab:nth-child(1) { animation-delay: calc(1 * var(--stagger-step)); }
.settings-tab:nth-child(2) { animation-delay: calc(2 * var(--stagger-step)); }
.settings-tab:nth-child(3) { animation-delay: calc(3 * var(--stagger-step)); }
.settings-tab:nth-child(4) { animation-delay: calc(4 * var(--stagger-step)); }
```

Line 64: `animation-delay: 200ms;` → `animation-delay: calc(4 * var(--stagger-step));`
Line 110: `animation-delay: 250ms;` → `animation-delay: calc(5 * var(--stagger-step));`

**Step 2: CloseDialog.css — replace 3 durations + 3 delays**

Line 31: `animation: content-fade-in 300ms ease forwards;` → `animation: content-fade-in var(--animation-normal) ease forwards;`
Line 43: `animation: content-fade-in 300ms ease forwards;` → `animation: content-fade-in var(--animation-normal) ease forwards;`
Line 52: `animation: content-fade-in 300ms ease forwards;` → `animation: content-fade-in var(--animation-normal) ease forwards;`

Line 32: `animation-delay: 100ms;` → `animation-delay: calc(2 * var(--stagger-step));`
Line 44: `animation-delay: 150ms;` → `animation-delay: calc(3 * var(--stagger-step));`
Line 53: `animation-delay: 200ms;` → `animation-delay: calc(4 * var(--stagger-step));`

**Step 3: ConnectModal.css — replace 3 durations + 3 delays**

Line 54: `animation: content-fade-in 300ms ease forwards;` → `animation: content-fade-in var(--animation-normal) ease forwards;`
Line 63: `animation: content-fade-in 300ms ease forwards;` → `animation: content-fade-in var(--animation-normal) ease forwards;`
Line 72: `animation: content-fade-in 300ms ease forwards;` → `animation: content-fade-in var(--animation-normal) ease forwards;`

Line 55: `animation-delay: 50ms;` → `animation-delay: calc(1 * var(--stagger-step));`
Line 64: `animation-delay: 100ms;` → `animation-delay: calc(2 * var(--stagger-step));`
Line 73: `animation-delay: 150ms;` → `animation-delay: calc(3 * var(--stagger-step));`

**Step 4: InterfaceSettingsTab.css — replace 1 duration**

Line 5: `animation: content-fade-in 300ms ease;` → `animation: content-fade-in var(--animation-normal) ease;`

**Step 5: Commit**

```
git add src/Brmble.Web/src/components/SettingsModal/SettingsModal.css \
        src/Brmble.Web/src/components/CloseDialog/CloseDialog.css \
        src/Brmble.Web/src/components/ConnectModal/ConnectModal.css \
        src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.css
git commit -m "refactor: tokenize content-fade-in animations and stagger delays"
```

---

### Task 3: Tokenize remaining one-shot entrance animations

These are entrance animations using various durations (150ms, 200ms, 250ms, 300ms, 400ms) that aren't part of the content-fade-in stagger pattern.

**Files:**
- Modify: `src/Brmble.Web/src/App.css`
- Modify: `src/Brmble.Web/src/components/CertWizard/CertWizard.css`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.css`
- Modify: `src/Brmble.Web/src/components/ServerList/ServerList.css`
- Modify: `src/Brmble.Web/src/components/ContextMenu/ContextMenu.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.css`

**Step 1: App.css**

Line 88: `animation: fadeIn 300ms ease;` → `animation: fadeIn var(--animation-normal) ease;`
Line 120: `animation: slideInLeft 400ms ease backwards;` → `animation: slideInLeft var(--animation-slow) ease backwards;`
Line 124: `animation-delay: 100ms;` → `animation-delay: calc(2 * var(--stagger-step));`
Line 128: `animation-delay: 200ms;` → `animation-delay: calc(4 * var(--stagger-step));`

**Step 2: CertWizard.css**

Line 15: `animation: slideUp 300ms ease;` → `animation: slideUp var(--animation-normal) ease;`

**Step 3: Sidebar.css**

Line 168: `animation: lobby-fade-in 300ms ease backwards;` → `animation: lobby-fade-in var(--animation-normal) ease backwards;`
Line 209: `animation: root-user-appear 200ms ease backwards;` → `animation: root-user-appear var(--animation-fast) ease backwards;`

Note: `200ms` maps to `--animation-fast` (150ms). The original value was 200ms but 150ms is close enough for a subtle entrance. If this feels too fast visually, the token can be adjusted globally later.

**Step 4: ServerList.css**

Line 20: `animation: serverListSlideIn 400ms ease backwards;` → `animation: serverListSlideIn var(--animation-slow) ease backwards;`
Line 89: `animation: serverItemFadeIn 300ms ease backwards;` → `animation: serverItemFadeIn var(--animation-normal) ease backwards;`
Line 202: `animation: formSlideIn 250ms ease;` → `animation: formSlideIn var(--animation-normal) ease;`

Note: `250ms` is between fast (150ms) and normal (300ms). Using `--animation-normal` since both are subtle fade-ins; 50ms difference won't be perceptible.

**Step 5: ContextMenu.css**

Line 10: `animation: contextMenuIn 150ms ease;` → `animation: contextMenuIn var(--animation-fast) ease;`

**Step 6: ShortcutsSettingsTab.css**

Line 29: `animation: shortcut-overlay-fade-in 150ms ease;` → `animation: shortcut-overlay-fade-in var(--animation-fast) ease;`
Line 44: `animation: shortcut-card-slide-in 200ms cubic-bezier(0.4, 0, 0.2, 1);` → `animation: shortcut-card-slide-in var(--animation-fast) cubic-bezier(0.4, 0, 0.2, 1);`

**Step 7: Commit**

```
git add src/Brmble.Web/src/App.css \
        src/Brmble.Web/src/components/CertWizard/CertWizard.css \
        src/Brmble.Web/src/components/Sidebar/Sidebar.css \
        src/Brmble.Web/src/components/ServerList/ServerList.css \
        src/Brmble.Web/src/components/ContextMenu/ContextMenu.css \
        src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.css
git commit -m "refactor: tokenize remaining one-shot entrance animation durations"
```

---

### Task 4: Tokenize continuous/looping animations

**Files:**
- Modify: `src/Brmble.Web/src/components/CertWizard/CertWizard.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.css`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.css`
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.css`
- Modify: `src/Brmble.Web/src/components/ServerList/ServerList.css`

**Step 1: CertWizard.css — spin**

Line 159: `animation: spin 0.8s linear infinite;` → `animation: spin var(--animation-spin) linear infinite;`

**Step 2: AudioSettingsTab.css + ShortcutsSettingsTab.css — pulse**

AudioSettingsTab.css line 10: `animation: pulse 1s infinite;` → `animation: pulse var(--animation-pulse) infinite;`
ShortcutsSettingsTab.css line 10: `animation: pulse 1s infinite;` → `animation: pulse var(--animation-pulse) infinite;`

**Step 3: ChannelTree.css + UserPanel.css — speaking-pulse**

ChannelTree.css line 174: `animation: speaking-pulse 1.5s ease-in-out infinite;` → `animation: speaking-pulse var(--animation-speaking-pulse) ease-in-out infinite;`
UserPanel.css line 177: `animation: speaking-pulse 1.5s ease-in-out infinite;` → `animation: speaking-pulse var(--animation-speaking-pulse) ease-in-out infinite;`

**Step 4: Sidebar.css — status blink**

Line 149: `animation: status-blink 0.5s ease-in-out infinite alternate;` → `animation: status-blink var(--animation-blink) ease-in-out infinite alternate;`
Line 151: `animation: status-blink 0.5s ease-in-out infinite alternate;` → `animation: status-blink var(--animation-blink) ease-in-out infinite alternate;`

**Step 5: UserPanel.css — badge animations**

Line 40: `animation: badgePop 400ms cubic-bezier(0.34, 1.56, 0.64, 1) both;` → `animation: badgePop var(--animation-badge-pop) cubic-bezier(0.34, 1.56, 0.64, 1) both;`
Line 50: `animation: badgePulse 2.4s ease-in-out 600ms infinite;` → `animation: badgePulse var(--animation-badge-pulse) ease-in-out var(--animation-badge-pulse-delay) infinite;`

**Step 6: ServerList.css — loading dots**

Line 41: `animation: loadingDots 1.5s infinite;` → `animation: loadingDots var(--animation-loading-dots) infinite;`

**Step 7: Commit**

```
git add src/Brmble.Web/src/components/CertWizard/CertWizard.css \
        src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.css \
        src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.css \
        src/Brmble.Web/src/components/Sidebar/ChannelTree.css \
        src/Brmble.Web/src/components/Sidebar/Sidebar.css \
        src/Brmble.Web/src/components/UserPanel/UserPanel.css \
        src/Brmble.Web/src/components/ServerList/ServerList.css
git commit -m "refactor: tokenize continuous animation durations with semantic variables"
```

---

### Task 5: Consolidate duplicate fade keyframes

Three keyframes do the same thing (opacity 0 → 1): `fadeIn` (global), `overlay-fade-in` (global), and `shortcut-overlay-fade-in` (ShortcutsSettingsTab.css). Consolidate to use just `fadeIn`.

**Files:**
- Modify: `src/Brmble.Web/src/index.css` — remove `overlay-fade-in` keyframe
- Modify: `src/Brmble.Web/src/components/CloseDialog/CloseDialog.css` — use `fadeIn` instead of `overlay-fade-in`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.css` — remove local `shortcut-overlay-fade-in`, use `fadeIn`

**Step 1: index.css — remove overlay-fade-in keyframe (lines 169-172)**

Delete:
```css
@keyframes overlay-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
```

**Step 2: CloseDialog.css — replace overlay-fade-in reference**

Line 10: `animation: overlay-fade-in var(--transition-fast);` → `animation: fadeIn var(--transition-fast);`

**Step 3: ShortcutsSettingsTab.css — remove local keyframe, update reference**

Line 29: `animation: shortcut-overlay-fade-in var(--animation-fast) ease;` → `animation: fadeIn var(--animation-fast) ease;`

Delete lines 32-35:
```css
@keyframes shortcut-overlay-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
```

**Step 4: Commit**

```
git add src/Brmble.Web/src/index.css \
        src/Brmble.Web/src/components/CloseDialog/CloseDialog.css \
        src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.css
git commit -m "refactor: consolidate duplicate fade keyframes into global fadeIn"
```

---

### Task 6: Add `prefers-reduced-motion` support

**Files:**
- Modify: `src/Brmble.Web/src/index.css` — add media query at end of file

**Step 1: Add the media query**

At the end of `index.css`, add:

```css
/* Accessibility: Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  :root {
    /* Disable one-shot entrance animations */
    --animation-fast: 0ms;
    --animation-normal: 0ms;
    --animation-slow: 0ms;
    --stagger-step: 0ms;

    /* Disable continuous animations */
    --animation-blink: 0ms;
    --animation-spin: 0ms;
    --animation-pulse: 0ms;
    --animation-speaking-pulse: 0ms;
    --animation-loading-dots: 0ms;
    --animation-badge-pop: 0ms;
    --animation-badge-pulse: 0ms;
    --animation-badge-pulse-delay: 0ms;

    /* Disable transitions */
    --transition-fast: 0ms;
    --transition-normal: 0ms;
    --transition-slow: 0ms;
  }

  /* Catch any animations not using tokens */
  *, *::before, *::after {
    animation-duration: 0ms !important;
    animation-delay: 0ms !important;
    transition-duration: 0ms !important;
  }
}
```

The universal selector rule is a safety net — it catches any animation we missed during tokenization. The variable overrides handle the tokenized ones cleanly.

**Step 2: Commit**

```
git add src/Brmble.Web/src/index.css
git commit -m "feat: add prefers-reduced-motion accessibility support"
```

---

### Task 7: Build verification

**Step 1: Frontend build**

```
cd src/Brmble.Web && npm run build
```

Expected: TypeScript compiles, Vite builds successfully.

**Step 2: .NET build**

```
dotnet build
```

Expected: 0 warnings, 0 errors.

**Step 3: .NET tests**

```
dotnet test
```

Expected: All tests pass (the pre-existing MatrixAppService test failure is unrelated).
