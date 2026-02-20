# Shortcuts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 4 new global hotkey shortcuts: Toggle Mute, Toggle Deafen, Toggle Mute/Deafen, and Continuous Transmission toggle.

**Architecture:** Extend AudioManager.cs with additional hotkey IDs and handlers. Add UI in ShortcutsSettingsTab.tsx for all 5 shortcuts. Use bridge messages to send shortcut keys from frontend to C#.

**Tech Stack:** React + TypeScript (frontend), C# + Win32 API (backend), WebView2 bridge

---

## Task 1: Extend ShortcutsSettings interface and UI

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx:9-15`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx:17-60`

**Step 1: Update ShortcutsSettings interface**

```typescript
export interface ShortcutsSettings {
  pushToTalkKey: string | null;
  toggleMuteKey: string | null;
  toggleDeafenKey: string | null;
  toggleMuteDeafenKey: string | null;
  continuousTransmissionKey: string | null;
}
```

**Step 2: Update DEFAULT_SHORTCUTS**

```typescript
export const DEFAULT_SHORTCUTS: ShortcutsSettings = {
  pushToTalkKey: null,
  toggleMuteKey: null,
  toggleDeafenKey: null,
  toggleMuteDeafenKey: null,
  continuousTransmissionKey: null,
};
```

**Step 3: Update ShortcutsSettingsTab component**

Add state and handlers for recording each shortcut. The current implementation only handles one recording at a time - need to track which shortcut is being recorded.

```typescript
// Add state to track which shortcut is being recorded
const [recordingKey, setRecordingKey] = useState<keyof ShortcutsSettings | null>(null);

// Update handleKeyDown to handle all shortcuts
const handleKeyDown = useCallback((e: KeyboardEvent) => {
  if (!recordingKey) return;
  e.preventDefault();
  
  const key = e.code === 'Space' ? 'Space' : e.key;
  const newSettings = { ...localSettings, [recordingKey]: key };
  setLocalSettings(newSettings);
  onChange(newSettings);
  setRecordingKey(null);
}, [recordingKey, localSettings, onChange]);

// Update useEffect to use recordingKey
useEffect(() => {
  if (recordingKey) {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }
}, [recordingKey, handleKeyDown]);
```

**Step 4: Render all 5 shortcut bindings**

Add buttons for each shortcut in the JSX:

```tsx
<div className="settings-item">
  <label>Toggle Mute Self</label>
  <button
    className={`key-binding-btn ${recordingKey === 'toggleMuteKey' ? 'recording' : ''}`}
    onClick={() => setRecordingKey(recordingKey === 'toggleMuteKey' ? null : 'toggleMuteKey')}
  >
    {recordingKey === 'toggleMuteKey' ? 'Press any key...' : (localSettings.toggleMuteKey || 'Not bound')}
  </button>
</div>

<div className="settings-item">
  <label>Toggle Deafen Self</label>
  <button
    className={`key-binding-btn ${recordingKey === 'toggleDeafenKey' ? 'recording' : ''}`}
    onClick={() => setRecordingKey(recordingKey === 'toggleDeafenKey' ? null : 'toggleDeafenKey')}
  >
    {recordingKey === 'toggleDeafenKey' ? 'Press any key...' : (localSettings.toggleDeafenKey || 'Not bound')}
  </button>
</div>

<div className="settings-item">
  <label>Toggle Mute/Deafen Self</label>
  <button
    className={`key-binding-btn ${recordingKey === 'toggleMuteDeafenKey' ? 'recording' : ''}`}
    onClick={() => setRecordingKey(recordingKey === 'toggleMuteDeafenKey' ? null : 'toggleMuteDeafenKey')}
  >
    {recordingKey === 'toggleMuteDeafenKey' ? 'Press any key...' : (localSettings.toggleMuteDeafenKey || 'Not bound')}
  </button>
</div>

<div className="settings-item">
  <label>Continuous Transmission</label>
  <button
    className={`key-binding-btn ${recordingKey === 'continuousTransmissionKey' ? 'recording' : ''}`}
    onClick={() => setRecordingKey(recordingKey === 'continuousTransmissionKey' ? null : 'continuousTransmissionKey')}
  >
    {recordingKey === 'continuousTransmissionKey' ? 'Press any key...' : (localSettings.continuousTransmissionKey || 'Not bound')}
  </button>
</div>
```

**Step 5: Run TypeScript build**

Run: `cd src/Brmble.Web && npm run build`
Expected: PASS (or TypeScript errors if any)

---

## Task 2: Update SettingsModal to sync shortcuts and send to backend

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx:65-83`

**Step 1: Update handleShortcutsChange to send all shortcuts to backend**

```typescript
const handleShortcutsChange = (shortcuts: ShortcutsSettings) => {
  const newSettings = { ...settings, shortcuts };
  setSettings(newSettings);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));

  // Notify backend of each shortcut change
  const actions: { action: string; key: string | null }[] = [
    { action: 'pushToTalk', key: settings.audio.transmissionMode === 'pushToTalk' ? shortcuts.pushToTalkKey : null },
    { action: 'toggleMute', key: shortcuts.toggleMuteKey },
    { action: 'toggleDeafen', key: shortcuts.toggleDeafenKey },
    { action: 'toggleMuteDeafen', key: shortcuts.toggleMuteDeafenKey },
    { action: 'continuousTransmission', key: shortcuts.continuousTransmissionKey },
  ];

  for (const { action, key } of actions) {
    const prevKey = (settings.shortcuts as any)[action + 'Key'];
    if (key !== prevKey) {
      bridge.send('voice.setShortcut', { action, key });
    }
  }
};
```

**Step 2: Also sync from Audio tab to Shortcuts**

Update handleAudioChange to also sync the pushToTalkKey to shortcuts:

```typescript
// In handleAudioChange, add sync:
if (audio.pushToTalkKey !== settings.audio.pushToTalkKey) {
  newSettings.shortcuts = { ...newSettings.shortcuts, pushToTalkKey: audio.pushToTalkKey };
}
```

**Step 3: Build frontend**

Run: `cd src/Brmble.Web && npm run build`
Expected: PASS

---

## Task 3: Add C# backend handler for setShortcut

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:334-340`
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:31-33`
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:239-274`

**Step 1: Add new hotkey IDs in AudioManager.cs**

```csharp
internal const int PttHotkeyId = 1;
internal const int MuteHotkeyId = 2;
internal const int DeafenHotkeyId = 3;
internal const int MuteDeafenHotkeyId = 4;
internal const int ContinuousHotkeyId = 5;
```

**Step 2: Add fields to track each hotkey**

```csharp
private int _pttHotkeyId = -1;
private int _muteHotkeyId = -1;
private int _deafenHotkeyId = -1;
private int _muteDeafenHotkeyId = -1;
private int _continuousHotkeyId = -1;
```

**Step 3: Add method to register a single hotkey**

```csharp
private bool RegisterSingleHotkey(ref int hotkeyId, int id, string? key, IntPtr hwnd)
{
    if (hotkeyId >= 0 && hwnd != IntPtr.Zero)
    {
        UnregisterHotKey(hwnd, hotkeyId);
        hotkeyId = -1;
    }
    
    if (key == null || hwnd == IntPtr.Zero) return false;
    
    var vk = KeyNameToVirtualKey(key);
    if (vk == 0) return false;
    
    hotkeyId = id;
    return RegisterHotKey(hwnd, hotkeyId, 0, (uint)vk);
}
```

**Step 4: Add SetShortcut method**

```csharp
public void SetShortcut(string action, string? key)
{
    if (_hwnd == IntPtr.Zero) return;
    
    switch (action)
    {
        case "pushToTalk":
            RegisterSingleHotkey(ref _pttHotkeyId, PttHotkeyId, key, _hwnd);
            break;
        case "toggleMute":
            RegisterSingleHotkey(ref _muteHotkeyId, MuteHotkeyId, key, _hwnd);
            break;
        case "toggleDeafen":
            RegisterSingleHotkey(ref _deafenHotkeyId, DeafenHotkeyId, key, _hwnd);
            break;
        case "toggleMuteDeafen":
            RegisterSingleHotkey(ref _muteDeafenHotkeyId, MuteDeafenHotkeyId, key, _hwnd);
            break;
        case "continuousTransmission":
            RegisterSingleHotkey(ref _continuousHotkeyId, ContinuousHotkeyId, key, _hwnd);
            break;
    }
}
```

**Step 5: Update HandleHotKey to handle all shortcuts**

```csharp
public void HandleHotKey(int id, bool keyDown)
{
    if (id == _pttHotkeyId && _transmissionMode == TransmissionMode.PushToTalk)
    {
        SetPttActive(keyDown);
    }
    else if (id == _muteHotkeyId && keyDown)
    {
        // Toggle mute - call back to MumbleAdapter
        ToggleMuteRequested?.Invoke();
    }
    else if (id == _deafenHotkeyId && keyDown)
    {
        ToggleDeafenRequested?.Invoke();
    }
    else if (id == _muteDeafenHotkeyId && keyDown)
    {
        ToggleMuteRequested?.Invoke();
        ToggleDeafenRequested?.Invoke();
    }
    else if (id == _continuousHotkeyId && keyDown)
    {
        ToggleContinuousRequested?.Invoke();
    }
}
```

**Step 6: Add events for toggle actions**

```csharp
public event Action? ToggleMuteRequested;
public event Action? ToggleDeafenRequested;
public event Action? ToggleContinuousRequested;
```

**Step 7: Add bridge handler in MumbleAdapter.cs**

```csharp
bridge.RegisterHandler("voice.setShortcut", data =>
{
    var action = data.TryGetProperty("action", out var a) ? a.GetString() ?? "" : "";
    var key = data.TryGetProperty("key", out var k) ? k.GetString() : null;
    _audioManager?.SetShortcut(action, key);
    return Task.CompletedTask;
});
```

**Step 8: Wire up events in MumbleAdapter constructor**

After AudioManager is created:
```csharp
_audioManager.ToggleMuteRequested += ToggleMute;
_audioManager.ToggleDeafenRequested += ToggleDeaf;
_audioManager.ToggleContinuousRequested += () => {
    var currentMode = _audioManager.TransmissionMode;
    var newMode = currentMode == TransmissionMode.Continuous 
        ? TransmissionMode.PushToTalk  // or previous mode
        : TransmissionMode.Continuous;
    // Actually need to track previous mode...
};
```

Actually, for continuous toggle, we need to track the previous mode. Let's simplify - just set to Continuous when toggled:

```csharp
_audioManager.ToggleContinuousRequested += () => {
    // Toggle between Continuous and whatever was previously set
    // For simplicity, just set to Continuous
    _audioManager.SetTransmissionMode(TransmissionMode.Continuous, null, _hwnd);
};
```

Wait, that's not quite right for a toggle. Let me revise:

```csharp
private TransmissionMode _previousMode = TransmissionMode.Continuous;

_audioManager.ToggleContinuousRequested += () => {
    var current = _audioManager.TransmissionMode;
    var newMode = current == TransmissionMode.Continuous ? _previousMode : TransmissionMode.Continuous;
    if (current != TransmissionMode.Continuous)
        _previousMode = current;
    _audioManager.SetTransmissionMode(newMode, 
        newMode == TransmissionMode.PushToTalk ? _audioManager.CurrentPttKey : null, 
        _hwnd);
};
```

Add a property to AudioManager to get current mode and PTT key.

**Step 9: Build C#**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: PASS

---

## Task 4: Test the shortcuts

**Step 1: Build everything**

```bash
cd src/Brmble.Web && npm run build
dotnet build
```

**Step 2: Run client**

```bash
dotnet run --project src/Brmble.Client
```

**Step 3: Test manually**

1. Open Settings → Shortcuts tab
2. Click each shortcut button and press a key
3. Verify the key is saved and displayed
4. Test each hotkey while app is in background
5. Verify mute/deafen/continuous toggle works

---

## Task 5: Commit

```bash
git checkout -b fix/shortcuts-39
git add src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx
git add src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: add global hotkey shortcuts for mute, deafen, and continuous transmission"
```
