# Shortcuts & Voice Buttons Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement issues #81, #129, #137, and #117 - add a "Toggle Leave Voice" shortcut, align shortcut labels with top bar buttons, allow rebinding already-used keys, and add press-and-hold highlight feedback.

**Architecture:** Four incremental changes to the existing shortcuts and voice button systems. Each issue builds on the existing `ShortcutsSettings` interface (TS + C#), `AudioManager` hotkey registration, and `UserPanel` button components.

**Tech Stack:** React + TypeScript (frontend), C# + Win32 (backend hotkeys), WebView2 bridge

---

## Task 1: Issue #81 - Add "Toggle Leave Voice" shortcut

### Task 1a: Add `toggleLeaveVoiceKey` to settings interfaces

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx:9-21`
- Modify: `src/Brmble.Client/Services/AppConfig/AppSettings.cs:13-18`

**Step 1: Add to TypeScript interface and defaults**

In `ShortcutsSettingsTab.tsx`, add `toggleLeaveVoiceKey` to the interface and defaults:

```typescript
export interface ShortcutsSettings {
  toggleMuteKey: string | null;
  toggleDeafenKey: string | null;
  toggleMuteDeafenKey: string | null;
  toggleDMScreenKey: string | null;
  toggleLeaveVoiceKey: string | null;
}

export const DEFAULT_SHORTCUTS: ShortcutsSettings = {
  toggleMuteKey: null,
  toggleDeafenKey: null,
  toggleMuteDeafenKey: null,
  toggleDMScreenKey: null,
  toggleLeaveVoiceKey: null,
};
```

**Step 2: Add to C# record**

In `AppSettings.cs`, add to `ShortcutsSettings`:

```csharp
public record ShortcutsSettings(
    string? ToggleMuteKey = null,
    string? ToggleDeafenKey = null,
    string? ToggleMuteDeafenKey = null,
    string? ToggleDMScreenKey = null,
    string? ToggleLeaveVoiceKey = null
);
```

### Task 1b: Add UI row in ShortcutsSettingsTab

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx:104-114`

**Step 1: Add "Toggle Leave Voice" row after the existing rows**

Insert before the Toggle DM Screen row (before line 106):

```tsx
<div className="settings-item">
  <label>Toggle Leave Voice</label>
  <button
    className={`key-binding-btn ${recordingKey === 'toggleLeaveVoiceKey' ? 'recording' : ''}`}
    onClick={() => setRecordingKey(recordingKey === 'toggleLeaveVoiceKey' ? null : 'toggleLeaveVoiceKey')}
  >
    {recordingKey === 'toggleLeaveVoiceKey' ? 'Press any key...' : (localSettings.toggleLeaveVoiceKey || 'Not bound')}
  </button>
</div>
```

### Task 1c: Wire up backend hotkey for leave voice

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:152,198-200,662-693,696-725,786-809`
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:61-62,519-524`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx:91-95`

**Step 1: Add hotkey ID and event in AudioManager**

In `AudioManager.cs`:
- Add constant: `internal const int LeaveVoiceHotkeyId = 6;` (after line 152)
- Add field: `private int _leaveVoiceHotkeyId = -1;` (after line 157)
- Add event: `public event Action? ToggleLeaveVoiceRequested;` (after line 200)

**Step 2: Handle in SetShortcut**

Add case to `SetShortcut()` switch (after line 691):

```csharp
case "toggleLeaveVoice":
    RegisterSingleHotkey(ref _leaveVoiceHotkeyId, LeaveVoiceHotkeyId, key, _hwnd);
    break;
```

**Step 3: Handle in HandleHotKey**

Add case to `HandleHotKey()` (after line 724):

```csharp
else if (id == _leaveVoiceHotkeyId && keyDown)
{
    AudioLog.Write($"[Audio] ToggleLeaveVoice hotkey");
    ToggleLeaveVoiceRequested?.Invoke();
}
```

**Step 4: Handle in MouseHookCallback**

Add case to `MouseHookCallback()` switch (after line 808):

```csharp
case "toggleLeaveVoice":
    ToggleLeaveVoiceRequested?.Invoke();
    break;
```

**Step 5: Wire event in MumbleAdapter constructor**

In `MumbleAdapter.cs`, after line 62:

```csharp
_audioManager.ToggleLeaveVoiceRequested += LeaveVoice;
```

**Step 6: Add to ApplySettings**

In `MumbleAdapter.cs` `ApplySettings()`, after line 524:

```csharp
_audioManager?.SetShortcut("toggleLeaveVoice", settings.Shortcuts.ToggleLeaveVoiceKey);
```

**Step 7: Send voice.setShortcut from frontend**

In `SettingsModal.tsx`, add to the actions array (line 91-95):

```typescript
const actions: { action: string; key: string | null }[] = [
  { action: 'toggleMute', key: shortcuts.toggleMuteKey },
  { action: 'toggleDeafen', key: shortcuts.toggleDeafenKey },
  { action: 'toggleMuteDeafen', key: shortcuts.toggleMuteDeafenKey },
  { action: 'toggleLeaveVoice', key: shortcuts.toggleLeaveVoiceKey },
];
```

### Task 1d: Handle frontend side-effects on hotkey-triggered leave voice

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:453-459,739-745`

The current `handleLeaveVoice` click handler calls `handleSelectServer()` when leaving (not rejoining). When leave voice is triggered by hotkey, the backend sends `voice.leftVoiceChanged` but the frontend doesn't call `handleSelectServer()`. Fix by moving that side-effect into the bridge event handler.

**Step 1: Move handleSelectServer into onLeftVoiceChanged**

In `App.tsx`, update the `onLeftVoiceChanged` handler (lines 453-459) to also call `handleSelectServer()` when entering left-voice state:

```typescript
const onLeftVoiceChanged = ((data: unknown) => {
  clearPendingAction();
  const d = data as { leftVoice: boolean } | undefined;
  if (d?.leftVoice !== undefined) {
    setSelfLeftVoice(d.leftVoice);
    if (d.leftVoice) {
      handleSelectServer();
    }
  }
});
```

**Step 2: Remove duplicate from handleLeaveVoice**

Simplify `handleLeaveVoice` (lines 739-745):

```typescript
const handleLeaveVoice = () => {
  startPendingAction('leave');
  bridge.send('voice.leaveVoice', {});
};
```

### Task 1e: Build and verify

**Step 1:** Run `dotnet build` and fix any errors.
**Step 2:** Commit: `feat: add 'Toggle Leave Voice' shortcut (#81)`

---

## Task 2: Issue #129 - Align shortcut labels with top bar buttons

### Task 2a: Remove toggleDeafenKey and rename labels

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx`
- Modify: `src/Brmble.Client/Services/AppConfig/AppSettings.cs:13-18`
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs` (remove deafen-only hotkey)
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:519-524`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx:91-95`

**Step 1: Remove toggleDeafenKey from TS interface and update labels**

```typescript
export interface ShortcutsSettings {
  toggleMuteKey: string | null;
  toggleMuteDeafenKey: string | null;
  toggleLeaveVoiceKey: string | null;
  toggleDMScreenKey: string | null;
}

export const DEFAULT_SHORTCUTS: ShortcutsSettings = {
  toggleMuteKey: null,
  toggleMuteDeafenKey: null,
  toggleLeaveVoiceKey: null,
  toggleDMScreenKey: null,
};
```

Update labels in the JSX:
- "Toggle Mute Self" -> "Toggle Mute"
- Remove the "Toggle Deafen Self" row entirely
- "Toggle Mute/Deafen Self" -> "Toggle Mute & Deafen"
- "Toggle DM Screen" -> "Toggle Direct Messages Screen"

**Step 2: Remove toggleDeafenKey from C# record**

```csharp
public record ShortcutsSettings(
    string? ToggleMuteKey = null,
    string? ToggleMuteDeafenKey = null,
    string? ToggleLeaveVoiceKey = null,
    string? ToggleDMScreenKey = null
);
```

**Step 3: Remove deafen-only handling from AudioManager**

- Remove `DeafenHotkeyId` constant (line 150)
- Remove `_deafenHotkeyId` field (line 155)
- Remove `"toggleDeafen"` case from `SetShortcut()` (lines 683-684)
- Remove `_deafenHotkeyId` handling from `HandleHotKey()` (lines 709-712)
- Remove `"toggleDeafen"` case from `MouseHookCallback()` (lines 799-800)

**Step 4: Remove from MumbleAdapter.ApplySettings**

Remove the line: `_audioManager?.SetShortcut("toggleDeafen", settings.Shortcuts.ToggleDeafenKey);`

**Step 5: Remove from SettingsModal actions array**

Remove `{ action: 'toggleDeafen', key: shortcuts.toggleDeafenKey }` from the actions array.

### Task 2b: Build and verify

**Step 1:** Run `dotnet build` and fix any errors.
**Step 2:** Commit: `fix: align shortcut labels with top bar buttons (#129)`

---

## Task 3: Issue #137 - Allow rebinding already-used keys

### Task 3a: Add conflict detection and confirmation prompt

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.css`

**Step 1: Add a label map and conflict detection to handleInput**

In `ShortcutsSettingsTab.tsx`, add a label map for human-readable shortcut names and update `handleInput` to detect conflicts:

```typescript
const SHORTCUT_LABELS: Record<keyof ShortcutsSettings, string> = {
  toggleMuteKey: 'Toggle Mute',
  toggleMuteDeafenKey: 'Toggle Mute & Deafen',
  toggleLeaveVoiceKey: 'Toggle Leave Voice',
  toggleDMScreenKey: 'Toggle Direct Messages Screen',
};
```

Update `handleInput` to:
1. Check all other shortcut keys for a match
2. If found, show a `window.confirm()` dialog: `This key is already bound to "[name]". Rebind it to "[new name]"?`
3. If confirmed, unbind from old shortcut and bind to new
4. If cancelled, exit recording mode without changes

**Step 2: Implementation**

```typescript
const handleInput = useCallback((key: string) => {
  if (!recordingKey) return;

  // Check for conflicts with other shortcuts
  const conflictEntry = Object.entries(localSettings).find(
    ([k, v]) => k !== recordingKey && v === key
  ) as [keyof ShortcutsSettings, string] | undefined;

  if (conflictEntry) {
    const [conflictKey] = conflictEntry;
    const confirmed = window.confirm(
      `This key is already bound to "${SHORTCUT_LABELS[conflictKey]}". Rebind it to "${SHORTCUT_LABELS[recordingKey]}"?`
    );
    if (!confirmed) {
      setRecordingKey(null);
      return;
    }
    // Unbind from old, bind to new
    setLocalSettings((prev) => {
      const newSettings = { ...prev, [conflictKey]: null, [recordingKey]: key };
      onChange(newSettings);
      return newSettings;
    });
  } else {
    setLocalSettings((prev) => {
      const newSettings = { ...prev, [recordingKey]: key };
      onChange(newSettings);
      return newSettings;
    });
  }
  setRecordingKey(null);
}, [recordingKey, localSettings, onChange]);
```

### Task 3b: Build and verify

**Step 1:** Run `dotnet build` and `cd src/Brmble.Web && npx tsc --noEmit` to verify.
**Step 2:** Commit: `fix: allow rebinding keys already used by another shortcut (#137)`

---

## Task 4: Issue #117 - Press-and-hold highlight for voice control buttons

### Task 4a: Add pressed state tracking to UserPanel

**Files:**
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.tsx`
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.css`

**Step 1: Add pressed state and event handlers**

Convert UserPanel to track which button is pressed. Use `onMouseDown`/`onMouseUp`/`onMouseLeave` and `onKeyDown`/`onKeyUp` for Enter/Space.

```typescript
import { useState } from 'react';

// Inside the component:
const [pressedBtn, setPressedBtn] = useState<string | null>(null);

const handleMouseDown = (btn: string) => (e: React.MouseEvent) => {
  if (e.button !== 0) return; // left click only
  setPressedBtn(btn);
};

const handleMouseUp = (btn: string, action?: () => void) => (e: React.MouseEvent) => {
  if (e.button !== 0) return;
  if (pressedBtn === btn && action) {
    action();
  }
  setPressedBtn(null);
};

const handleMouseLeave = () => {
  setPressedBtn(null);
};

const handleKeyDown = (btn: string) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    setPressedBtn(btn);
  }
};

const handleKeyUp = (btn: string, action?: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (pressedBtn === btn && action) {
      action();
    }
    setPressedBtn(null);
  }
};
```

**Step 2: Apply to all three voice buttons**

Replace `onClick` with the mousedown/mouseup/mouseleave/keydown/keyup handlers on Leave Voice, Deafen, and Mute buttons. Add `pressed` CSS class when `pressedBtn === btnName`.

Example for Leave Voice button:
```tsx
<button 
  className={`user-panel-btn leave-voice-btn ${leftVoice ? 'active' : ''} ${pressedBtn === 'leave' ? 'pressed' : ''} ${(!!leftVoice && !canRejoin) || pendingChannelAction !== null ? 'disabled' : ''}`}
  onMouseDown={handleMouseDown('leave')}
  onMouseUp={handleMouseUp('leave', onLeaveVoice)}
  onMouseLeave={handleMouseLeave}
  onKeyDown={handleKeyDown('leave')}
  onKeyUp={handleKeyUp('leave', onLeaveVoice)}
  disabled={(!!leftVoice && !canRejoin) || pendingChannelAction !== null}
  title={leftVoice ? 'Rejoin Voice' : 'Leave Voice'}
>
```

Same pattern for `deaf` and `mute` buttons.

**Step 3: Add `.pressed` CSS styles**

In `UserPanel.css`, add pressed states:

```css
.user-panel-btn.leave-voice-btn.pressed {
  color: #ff4444;
  background: rgba(255, 68, 68, 0.25);
  transform: scale(0.95);
}

.user-panel-btn.deaf-btn.pressed {
  color: var(--accent-berry);
  background: rgba(212, 20, 90, 0.3);
  transform: scale(0.95);
}

.user-panel-btn.mute-btn.pressed {
  color: var(--accent-berry);
  background: rgba(212, 20, 90, 0.3);
  transform: scale(0.95);
}
```

### Task 4b: Build and verify

**Step 1:** Run `cd src/Brmble.Web && npx tsc --noEmit` to verify.
**Step 2:** Commit: `feat(ui): add press-and-hold highlight feedback for voice buttons (#117)`

---

## Cross-Tab Conflict Detection (Issue #137 — Extended)

The original Task 3 design used `window.confirm()` for same-tab conflicts only. During implementation, the scope was extended to detect conflicts **across all settings tabs** (e.g., Push to Talk in Audio vs. Toggle Mute in Shortcuts). This section documents the final architecture.

### Architecture

The conflict detection system uses a centralized `AllBindings` map in `SettingsModal.tsx` that aggregates every key binding in the app:

```
SettingsModal (parent)
├── allBindings: AllBindings         — flat Record<string, string | null> of all bound keys
├── handleClearBinding(bindingId)    — clears any binding by ID, sends bridge messages
├── AudioSettingsTab
│   ├── props: allBindings, onClearBinding
│   └── conflict detection in handleInput checks allBindings (excludes own 'pushToTalkKey')
└── ShortcutsSettingsTab
    ├── props: allBindings, onClearBinding
    └── conflict detection in handleInput checks allBindings (excludes own recordingKey)
```

### Key Types (SettingsModal.tsx)

```typescript
/** A flat map of every key binding in the app: bindingId → bound key code (or null). */
export type AllBindings = Record<string, string | null>;

/** Human-readable labels for every binding ID. */
export const BINDING_LABELS: Record<string, string> = {
  pushToTalkKey: 'Push to Talk',
  toggleLeaveVoiceKey: 'Toggle Leave Voice',
  toggleMuteDeafenKey: 'Toggle Mute & Deafen',
  toggleMuteKey: 'Toggle Mute',
  toggleDMScreenKey: 'Toggle Direct Messages Screen',
};
```

### Conflict Resolution Flow

1. User starts recording a key binding (enters "Press any key..." mode)
2. Win32 hotkeys are temporarily suspended via `voice.suspendHotkeys` bridge message
3. User presses a key
4. `handleInput` checks `allBindings` for any *other* binding with the same key
5. If conflict found → inline React dialog appears (not `window.confirm` — broken in WebView2)
6. User chooses:
   - **Rebind**: calls `onClearBinding(conflictBindingId)` which delegates to parent `handleClearBinding`, then sets new binding locally
   - **Cancel**: dismisses dialog, exits recording mode
7. Win32 hotkeys are re-registered via `voice.resumeHotkeys`

### handleClearBinding (SettingsModal.tsx)

The parent's `handleClearBinding` handles clearing bindings from any tab:
- If `bindingId === 'pushToTalkKey'`: updates `audio.pushToTalkKey` to null, sends `voice.setTransmissionMode`
- If `bindingId` is a shortcuts key: updates `shortcuts[bindingId]` to null, sends `voice.setShortcut`
- Persists via `settings.set` bridge message and localStorage

### WebView2 Constraints

- `window.confirm()` returns false immediately in WebView2 — replaced with inline React dialog
- `RegisterHotKey` (Win32 API) intercepts keypresses at the OS level — JS never sees them. Solved via `voice.suspendHotkeys`/`voice.resumeHotkeys` which unregister/re-register all hotkeys during recording.
- `mousedown` window listener was capturing clicks on UI elements — fixed by checking `target.closest('button, a, input, select, label, .settings-modal')`.

### Adding New Bindings in the Future

To add a new key binding to the conflict detection system:
1. Add the binding ID + value to `allBindings` in `SettingsModal.tsx`
2. Add a human-readable label to `BINDING_LABELS`
3. Pass `allBindings` and `onClearBinding` props to the new tab component
4. In the tab's `handleInput`, check `allBindings` for conflicts (excluding own binding ID)

---

## Task 5: Final build verification

**Step 1:** Run `dotnet build` to ensure everything compiles.
**Step 2:** Run `dotnet test` to ensure no tests break.
**Step 3:** Run `cd src/Brmble.Web && npm run build` to verify frontend builds.
