# Toggle DM Screen Shortcut Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a configurable keyboard shortcut to toggle the DM screen, accessible from settings.

**Architecture:** Extend existing ShortcutsSettings interface and UI, then wire up the keyboard handler in App.tsx to call toggleDMMode() when the configured key is pressed.

**Tech Stack:** React, TypeScript

---

### Task 1: Add toggleDMScreenKey to ShortcutsSettings interface

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx:9-19`

**Step 1: Add the new field to interface and defaults**

Edit the file to add `toggleDMScreenKey` to both `ShortcutsSettings` interface and `DEFAULT_SHORTCUTS`:

```typescript
export interface ShortcutsSettings {
  toggleMuteKey: string | null;
  toggleDeafenKey: string | null;
  toggleMuteDeafenKey: string | null;
  toggleDMScreenKey: string | null;  // NEW
}

export const DEFAULT_SHORTCUTS: ShortcutsSettings = {
  toggleMuteKey: null,
  toggleDeafenKey: null,
  toggleMuteDeafenKey: null,
  toggleDMScreenKey: null,  // NEW
};
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx
git commit -m "feat: add toggleDMScreenKey to shortcuts interface"
```

---

### Task 2: Add Toggle DM Screen button to ShortcutsSettingsTab UI

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx:72-107`

**Step 1: Add the new button**

Add after the existing shortcut buttons (before the `<p className="settings-hint">`):

```tsx
      <div className="settings-item">
        <label>Toggle DM Screen</label>
        <button
          className={`key-binding-btn ${recordingKey === 'toggleDMScreenKey' ? 'recording' : ''}`}
          onClick={() => setRecordingKey(recordingKey === 'toggleDMScreenKey' ? null : 'toggleDMScreenKey')}
        >
          {recordingKey === 'toggleDMScreenKey' ? 'Press any key...' : (localSettings.toggleDMScreenKey || 'Not bound')}
        </button>
      </div>
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx
git commit -m "feat: add toggle DM screen button to shortcuts UI"
```

---

### Task 3: Wire up keyboard handler in App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:195-231`

**Step 1: Update the keydown handler**

Add logic to check for `toggleDMScreenKey` in the settings and call `toggleDMMode()` when pressed. Update the `handleKeyDown` function:

```typescript
const handleKeyDown = (e: KeyboardEvent) => {
  // Handle PTT
  if (pttKey) {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    
    const pressedKey = e.code;
    if (pressedKey === pttKey && !pttPressed) {
      pttPressed = true;
      bridge.send('voice.pttKey', { pressed: true });
    }
  }

  // Handle toggle DM screen shortcut
  if (settings?.shortcuts?.toggleDMScreenKey) {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    
    if (e.code === settings.shortcuts.toggleDMScreenKey) {
      toggleDMMode();
    }
  }
};
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: add keyboard shortcut handler for DM screen toggle"
```

---

### Task 4: Test the implementation

**Step 1: Build the frontend**

```bash
cd src/Brmble.Web && npm run build
```

**Step 2: Verify no TypeScript errors**

```bash
cd src/Brmble.Web && npx tsc --noEmit
```

**Step 3: Commit any build-related changes**

```bash
git add .
git commit -m "chore: build frontend"
```

---

### Task 5: Verify end-to-end

**Manual testing:**
1. Run the app in dev mode
2. Open Settings → Shortcuts tab
3. Click "Toggle DM Screen" button
4. Press a key (e.g., M) to bind it
5. Press the same key while in channel view to verify DM screen toggles
6. Press again to return to channel view

---

### Task 6: Final commit

```bash
git push -u origin feature/toggle-dm-screen-shortcut
```
