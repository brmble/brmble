# Gap Analysis Points 3 & 5 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Standardize motion, micro-interactions, and visual feedback across the application by resolving CSS gap analysis points 3 (Animation) and 5 (Micro-interactions).

**Architecture:** We will consolidate scattered CSS keyframes and hardcoded transition values into global utility classes in `index.css`. We will also implement a global `.brmble-toggle` component to replace standard browser checkboxes.

**Tech Stack:** React, CSS, Vite

---

### Task 1: Consolidate Keyframes and Animation Classes

**Files:**
- Modify: `src/Brmble.Web/src/index.css`

**Step 1: Add new keyframes and utility classes to index.css**

Append the following to the animations section in `index.css`:

```css
@keyframes slideDown {
  from { opacity: 0; transform: translateY(-20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes popIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

.animate-fade-in { animation: fadeIn var(--transition-normal) forwards; }
.animate-slide-up { animation: slideUp var(--transition-normal) backwards; }
.animate-slide-down { animation: slideDown var(--transition-normal) backwards; }
.animate-pop-in { animation: popIn var(--transition-normal) cubic-bezier(0.34, 1.56, 0.64, 1) backwards; }
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/index.css
git commit -m "feat: add global animation utility classes and keyframes"
```

### Task 2: Standardize Transitions Across Codebase

**Files:**
- Modify: Multiple CSS files

**Step 1: Search for hardcoded transitions**

Run: `rg "transition:\s*(all|background|color|transform|border|opacity|box-shadow)?[^v]+?s" src/Brmble.Web/src/components -g "*.css"`

**Step 2: Replace hardcoded values with variables**

Replace values like `0.15s`, `0.2s`, `0.3s` with `var(--transition-fast)` or `var(--transition-normal)`. Specifically check files like `ConnectModal.css`, `SettingsModal.css`, `CloseDialog.css`, and `UserInfoDialog.css`.

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/**/*.css
git commit -m "refactor: replace hardcoded CSS transitions with global variables"
```

### Task 3: Audit and Apply Animation Classes to Modals

**Files:**
- Modify: `src/Brmble.Web/src/components/ConnectModal/ConnectModal.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- Modify: `src/Brmble.Web/src/components/CloseDialog/CloseDialog.tsx`
- Modify: `src/Brmble.Web/src/components/UserInfoDialog/UserInfoDialog.tsx`
- Modify: Associated CSS files

**Step 1: Remove local keyframes and animation declarations**

Find and remove `@keyframes card-slide-in`, `@keyframes content-fade-in`, `@keyframes modal-appear`, etc., from the component CSS files. Remove the `animation: ...` properties from their main wrapper classes.

**Step 2: Apply global utility classes**

Add `.animate-slide-up` or `.animate-pop-in` to the main modal/dialog wrappers in the `.tsx` files (e.g., `<div className="connect-modal animate-slide-up">`).

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/**/*.tsx src/Brmble.Web/src/components/**/*.css
git commit -m "refactor: replace local modal animations with global utility classes"
```

### Task 4: Build Global Toggle Switch

**Files:**
- Modify: `src/Brmble.Web/src/index.css`

**Step 1: Add toggle switch CSS to index.css**

```css
/* Global Toggle Switch */
.brmble-toggle {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}

.brmble-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.brmble-toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--bg-hover-strong);
  transition: var(--transition-normal);
  border-radius: 24px;
  border: 1px solid var(--border-subtle);
}

.brmble-toggle-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background-color: var(--text-secondary);
  transition: var(--transition-normal);
  border-radius: 50%;
}

.brmble-toggle input:checked + .brmble-toggle-slider {
  background-color: var(--accent-berry);
  border-color: var(--accent-berry);
}

.brmble-toggle input:checked + .brmble-toggle-slider:before {
  transform: translateX(20px);
  background-color: var(--text-primary);
  box-shadow: 0 0 8px var(--accent-berry-glow);
}

.brmble-toggle input:focus-visible + .brmble-toggle-slider {
  box-shadow: 0 0 0 2px var(--bg-deep), 0 0 0 4px var(--accent-berry);
}

.brmble-toggle input:disabled + .brmble-toggle-slider {
  opacity: 0.5;
  cursor: not-allowed;
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/index.css
git commit -m "feat: add global brmble-toggle CSS class"
```

### Task 5: Refactor Components to Use Global Toggle

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`
- Modify: Associated CSS files

**Step 1: Replace existing toggle markup**

Find instances of custom toggle markup in the settings tabs and replace them with:

```tsx
<label className="brmble-toggle">
  <input type="checkbox" checked={isChecked} onChange={handleChange} />
  <span className="brmble-toggle-slider"></span>
</label>
```

**Step 2: Remove redundant toggle CSS**

Delete any local toggle CSS from `SettingsModal.css` or the tab-specific CSS files.

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/*
git commit -m "refactor: use global brmble-toggle in settings tabs"
```
