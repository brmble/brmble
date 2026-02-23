# Reconnect-When-Disconnected Setting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an opt-out "Automatically reconnect when disconnected" toggle to the Connection settings tab, controlling whether the existing `ReconnectLoop` activates on unexpected disconnection.

**Architecture:** A `ReconnectEnabled = true` field on `AppSettings` is read at the reconnect decision point in `MumbleAdapter.ProcessLoop()`. When disabled, a `voice.disconnected` message with `reconnectAvailable: true` is sent instead of entering `ReconnectLoop()`. The frontend shows a "Reconnect" button that reuses the existing `voice.connect` flow.

**Tech Stack:** C# (.NET), React + TypeScript, MSTest

---

### Task 1: Add `ReconnectEnabled` to `AppSettings`

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppSettings.cs:34-42`
- Test: `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`

**Step 1: Write the failing test**

In `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`, add:

```csharp
[TestMethod]
public void DefaultSettings_HaveReconnectEnabled()
{
    var svc = new AppConfigService(_tempDir);

    var settings = svc.GetSettings();

    Assert.IsTrue(settings.ReconnectEnabled);
}

[TestMethod]
public void SavesAndReloads_ReconnectEnabled()
{
    var svc = new AppConfigService(_tempDir);
    svc.SetSettings(svc.GetSettings() with { ReconnectEnabled = false });

    var svc2 = new AppConfigService(_tempDir);

    Assert.IsFalse(svc2.GetSettings().ReconnectEnabled);
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "DefaultSettings_HaveReconnectEnabled|SavesAndReloads_ReconnectEnabled" -v n`
Expected: FAIL — `ReconnectEnabled` does not exist on `AppSettings`.

**Step 3: Write minimal implementation**

In `src/Brmble.Client/Services/AppConfig/AppSettings.cs`, add `ReconnectEnabled` parameter to `AppSettings` record:

```csharp
public record AppSettings(
    AudioSettings Audio,
    ShortcutsSettings Shortcuts,
    MessagesSettings Messages,
    OverlaySettings Overlay,
    SpeechEnhancementSettings? SpeechEnhancement = null,
    bool AutoConnectEnabled = false,
    string? AutoConnectServerId = null,
    bool ReconnectEnabled = true
)
```

**Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "DefaultSettings_HaveReconnectEnabled|SavesAndReloads_ReconnectEnabled" -v n`
Expected: PASS

**Step 5: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/AppSettings.cs tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs
git commit -m "feat: add ReconnectEnabled field to AppSettings (default true)"
```

---

### Task 2: Check `ReconnectEnabled` in MumbleAdapter reconnect decision

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:244-251` (ProcessLoop exit)
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:192-207` (Disconnect method — voice.disconnected emission)

**Step 1: Modify the reconnect decision point in `ProcessLoop`**

At line ~244 in `MumbleAdapter.cs`, replace the existing reconnect block:

```csharp
// Loop exited — either intentional (CTS cancelled) or unexpected connection drop.
if (!_intentionalDisconnect && !ct.IsCancellationRequested && _reconnectHost != null && _reconnectCts == null)
{
    // Unexpected drop — clean up and start reconnect loop.
    Disconnect();
    Task.Run(() => ReconnectLoop());
}
```

With:

```csharp
// Loop exited — either intentional (CTS cancelled) or unexpected connection drop.
if (!_intentionalDisconnect && !ct.IsCancellationRequested && _reconnectHost != null && _reconnectCts == null)
{
    var reconnectEnabled = _appConfigService?.GetSettings().ReconnectEnabled ?? true;
    if (reconnectEnabled)
    {
        // Unexpected drop — clean up and start reconnect loop.
        Disconnect();
        Task.Run(() => ReconnectLoop());
    }
    else
    {
        // Reconnect disabled — emit disconnected with manual reconnect option.
        _bridge?.Send("voice.disconnected", new { reconnectAvailable = true });
        _bridge?.NotifyUiThread();
    }
}
```

**Step 2: Build to verify it compiles**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded.

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: check ReconnectEnabled before entering ReconnectLoop"
```

---

### Task 3: Update frontend `ConnectionSettings` interface and `ConnectionSettingsTab` UI

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.css`

**Step 1: Update `ConnectionSettings` interface and defaults**

In `ConnectionSettingsTab.tsx`, update the interface and defaults:

```typescript
export interface ConnectionSettings {
  reconnectEnabled: boolean;
  autoConnectEnabled: boolean;
  autoConnectServerId: string | null;
}

export const DEFAULT_CONNECTION: ConnectionSettings = {
  reconnectEnabled: true,
  autoConnectEnabled: false,
  autoConnectServerId: null,
};
```

**Step 2: Update the component — add reconnect toggle, remove section headers**

Replace the component body with a flat layout (no section headers):

```tsx
export function ConnectionSettingsTab({ settings, onChange, servers }: ConnectionSettingsTabProps) {
  const handleReconnectToggle = () => {
    onChange({ ...settings, reconnectEnabled: !settings.reconnectEnabled });
  };

  const handleAutoConnectToggle = () => {
    onChange({ ...settings, autoConnectEnabled: !settings.autoConnectEnabled });
  };

  const handleServerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    onChange({ ...settings, autoConnectServerId: value === '' ? null : value });
  };

  const tooltipText = "Choose 'Last connected server' to reconnect where you left off, or pick a specific server to always connect to that one.";

  return (
    <div className="connection-settings-tab">
      <div className="settings-item settings-toggle">
        <label>Automatically reconnect when disconnected</label>
        <input
          type="checkbox"
          className="toggle-input"
          checked={settings.reconnectEnabled}
          onChange={handleReconnectToggle}
        />
      </div>

      <div className="settings-item settings-toggle">
        <label>Auto-connect on startup</label>
        <input
          type="checkbox"
          className="toggle-input"
          checked={settings.autoConnectEnabled}
          onChange={handleAutoConnectToggle}
        />
      </div>

      <div className="server-dropdown-row">
        <label>
          Connect to
          <span className="tooltip-icon" data-tooltip={tooltipText}>?</span>
        </label>
        <select
          className="settings-select"
          value={settings.autoConnectServerId ?? ''}
          onChange={handleServerChange}
          disabled={!settings.autoConnectEnabled}
        >
          <option value="">Last connected server</option>
          {servers.map(s => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {servers.length === 0 && (
        <p className="settings-hint">
          You can also choose a specific server once you've added one.
        </p>
      )}
    </div>
  );
}
```

**Step 3: Build frontend to verify it compiles**

Run (from `src/Brmble.Web`): `npm run build`
Expected: Build succeeds. (May have type errors from `SettingsModal.tsx` — those are fixed in Task 4.)

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.css
git commit -m "feat: add reconnect toggle to ConnectionSettingsTab, remove section headers"
```

---

### Task 4: Wire `reconnectEnabled` through `SettingsModal`

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx:19-37` (AppSettings interface + defaults)
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx:121-129` (handleConnectionChange)
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx:192-201` (ConnectionSettingsTab props)

**Step 1: Add `reconnectEnabled` to `AppSettings` interface and defaults**

In `SettingsModal.tsx`, update the `AppSettings` interface:

```typescript
interface AppSettings {
  audio: AudioSettings;
  shortcuts: ShortcutsSettings;
  messages: MessagesSettings;
  overlay: OverlaySettings;
  speechEnhancement: SpeechEnhancementSettings;
  reconnectEnabled: boolean;
  autoConnectEnabled: boolean;
  autoConnectServerId: string | null;
}

const DEFAULT_SETTINGS: AppSettings = {
  audio: DEFAULT_AUDIO,
  shortcuts: DEFAULT_SHORTCUTS,
  messages: DEFAULT_MESSAGES,
  overlay: DEFAULT_OVERLAY,
  speechEnhancement: DEFAULT_SPEECH_ENHANCEMENT,
  reconnectEnabled: true,
  autoConnectEnabled: false,
  autoConnectServerId: null,
};
```

**Step 2: Update `handleConnectionChange` to include `reconnectEnabled`**

```typescript
const handleConnectionChange = (connection: ConnectionSettings) => {
  const newSettings = {
    ...settings,
    reconnectEnabled: connection.reconnectEnabled,
    autoConnectEnabled: connection.autoConnectEnabled,
    autoConnectServerId: connection.autoConnectServerId,
  };
  setSettings(newSettings);
  bridge.send('settings.set', { settings: newSettings });
};
```

**Step 3: Update ConnectionSettingsTab props to pass `reconnectEnabled`**

```tsx
{activeTab === 'connection' && (
  <ConnectionSettingsTab
    settings={{
      reconnectEnabled: settings.reconnectEnabled,
      autoConnectEnabled: settings.autoConnectEnabled,
      autoConnectServerId: settings.autoConnectServerId,
    }}
    onChange={handleConnectionChange}
    servers={servers.map(s => ({ id: s.id, label: s.label }))}
  />
)}
```

**Step 4: Build frontend to verify**

Run (from `src/Brmble.Web`): `npm run build`
Expected: Build succeeds with no errors.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx
git commit -m "feat: wire reconnectEnabled through SettingsModal to ConnectionSettingsTab"
```

---

### Task 5: Handle `reconnectAvailable` in `voice.disconnected` + add Reconnect button

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:258-274` (onVoiceDisconnected handler)
- Modify: `src/Brmble.Web/src/App.tsx` (add state + Reconnect button in the failed/disconnected UI)
- Modify: `src/Brmble.Web/src/types/index.ts:44` (ConnectionStatus type — add 'disconnected')

**Step 1: Add 'disconnected' to ConnectionStatus type**

In `src/Brmble.Web/src/types/index.ts`, update:

```typescript
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'disconnected';
```

The new `'disconnected'` state means "unexpectedly disconnected, reconnect available but not automatic."

**Step 2: Update `onVoiceDisconnected` to handle `reconnectAvailable`**

In `App.tsx`, update the handler:

```typescript
const onVoiceDisconnected = (data: unknown) => {
  clearPendingAction();
  const d = data as { reconnectAvailable?: boolean } | null;
  if (d?.reconnectAvailable) {
    setConnectionStatus('disconnected');
  } else {
    setConnectionStatus('idle');
    setServerAddress('');
    setServerLabel('');
  }
  setChannels([]);
  setUsers([]);
  setCurrentChannelId(undefined);
  setCurrentChannelName('');
  setSelfMuted(false);
  setSelfDeafened(false);
  setSelfLeftVoice(false);
  setSelfCanRejoin(false);
  setSelfSession(0);
  setSpeakingUsers(new Map());
  setMatrixCredentials(null);
};
```

Key difference: when `reconnectAvailable` is true, we keep `serverAddress` and `serverLabel` (needed for the Reconnect button) and set status to `'disconnected'` instead of `'idle'`.

**Step 3: Add a `handleReconnect` function and Reconnect button**

Add a `handleReconnect` function near `handleCancelReconnect` (~line 693):

```typescript
const handleReconnect = () => {
  const stored = localStorage.getItem('brmble-server');
  if (stored) {
    try {
      const serverData = JSON.parse(stored) as SavedServer;
      handleConnect(serverData);
    } catch {
      setConnectionStatus('idle');
    }
  } else {
    setConnectionStatus('idle');
  }
};
```

This reads the last-connected server from `localStorage` (already saved by `handleConnect`) and re-triggers the normal connect flow.

**Step 4: Add UI for 'disconnected' state**

Find the section that renders the reconnecting/failed UI and add a `'disconnected'` case. This depends on how the current UI renders those states — look for where `connectionStatus === 'reconnecting'` or `connectionStatus === 'failed'` is checked and add:

```tsx
{connectionStatus === 'disconnected' && (
  <div className="disconnected-panel">
    <p>Disconnected from {serverLabel || serverAddress}</p>
    <button className="reconnect-btn" onClick={handleReconnect}>Reconnect</button>
    <button className="back-btn" onClick={() => setConnectionStatus('idle')}>Back to Server List</button>
  </div>
)}
```

The exact placement depends on the existing JSX structure. Place it alongside the existing `reconnecting` / `failed` UI blocks.

**Step 5: Build frontend to verify**

Run (from `src/Brmble.Web`): `npm run build`
Expected: Build succeeds.

**Step 6: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/types/index.ts
git commit -m "feat: handle reconnectAvailable flag in voice.disconnected, add Reconnect button"
```

---

### Task 6: Commit uncommitted SettingsModal.css change + full build & test verification

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.css` (already modified, uncommitted)

**Step 1: Commit the modal resize change**

```bash
git add src/Brmble.Web/src/components/SettingsModal/SettingsModal.css
git commit -m "style: widen settings modal to 600px, tighten tab padding for 6 tabs"
```

**Step 2: Run full solution build**

Run: `dotnet build`
Expected: Build succeeded. 0 Warning(s). 0 Error(s).

**Step 3: Run all tests**

Run: `dotnet test`
Expected: All tests pass (should be 179+ tests — 60 MumbleVoiceEngine + 39 Client + 80 Server).

**Step 4: Build frontend**

Run (from `src/Brmble.Web`): `npm run build`
Expected: Build succeeds with no errors.
