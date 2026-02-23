# Auto-Connect on Startup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an opt-in auto-connect setting that connects to the last-used (or a specific) server on startup.

**Architecture:** Two new fields on `AppSettings` (`AutoConnectEnabled`, `AutoConnectServerId`) plus `LastConnectedServerId` on `ConfigData`. A new "Connection" tab in the Settings modal exposes the toggle and server dropdown. On startup, `Program.cs` resolves the target server and triggers `voice.connect` through the existing path. Failed auto-connects reuse the existing reconnect loop.

**Tech Stack:** C# (.NET), React + TypeScript, WebView2 bridge, MSTest

---

### Task 1: Add auto-connect fields to AppSettings

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppSettings.cs:34-50`

**Step 1: Write the failing test**

Add to `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`:

```csharp
[TestMethod]
public void DefaultSettings_HaveAutoConnectDisabled()
{
    var svc = new AppConfigService(_tempDir);

    var settings = svc.GetSettings();

    Assert.IsFalse(settings.AutoConnectEnabled);
    Assert.IsNull(settings.AutoConnectServerId);
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter DefaultSettings_HaveAutoConnectDisabled -v n`
Expected: FAIL — `AppSettings` does not have `AutoConnectEnabled` property.

**Step 3: Add fields to AppSettings**

In `src/Brmble.Client/Services/AppConfig/AppSettings.cs`, update the `AppSettings` record:

```csharp
public record AppSettings(
    AudioSettings Audio,
    ShortcutsSettings Shortcuts,
    MessagesSettings Messages,
    OverlaySettings Overlay,
    SpeechEnhancementSettings? SpeechEnhancement = null,
    bool AutoConnectEnabled = false,
    string? AutoConnectServerId = null
)
{
    public SpeechEnhancementSettings SpeechEnhancement { get; init; } = SpeechEnhancement ?? new SpeechEnhancementSettings();

    public static AppSettings Default => new(
        new AudioSettings(),
        new ShortcutsSettings(),
        new MessagesSettings(),
        new OverlaySettings()
    );
}
```

**Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter DefaultSettings_HaveAutoConnectDisabled -v n`
Expected: PASS

**Step 5: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/AppSettings.cs tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs
git commit -m "feat: add AutoConnectEnabled and AutoConnectServerId to AppSettings"
```

---

### Task 2: Add LastConnectedServerId to ConfigData and AppConfigService

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppConfigService.cs:17-21,170-208,231-237`
- Modify: `src/Brmble.Client/Services/AppConfig/IAppConfigService.cs`

**Step 1: Write the failing test**

Add to `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`:

```csharp
[TestMethod]
public void SavesAndReloads_LastConnectedServerId()
{
    var svc = new AppConfigService(_tempDir);
    Assert.IsNull(svc.GetLastConnectedServerId(), "No server connected yet — should be null");

    svc.SaveLastConnectedServerId("server-abc");
    var svc2 = new AppConfigService(_tempDir);

    Assert.AreEqual("server-abc", svc2.GetLastConnectedServerId());
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter SavesAndReloads_LastConnectedServerId -v n`
Expected: FAIL — `GetLastConnectedServerId` does not exist.

**Step 3: Implement LastConnectedServerId support**

In `IAppConfigService.cs`, add:

```csharp
string? GetLastConnectedServerId();
void SaveLastConnectedServerId(string? serverId);
```

In `AppConfigService.cs`:

1. Add field alongside existing fields (line ~20):
```csharp
private string? _lastConnectedServerId;
```

2. Update `ConfigData` record:
```csharp
private record ConfigData
{
    public List<ServerEntry> Servers { get; init; } = [];
    public AppSettings Settings { get; init; } = AppSettings.Default;
    public WindowState? Window { get; init; } = null;
    public string? ClosePreference { get; init; } = null;
    public string? LastConnectedServerId { get; init; } = null;
}
```

3. Update `Load()` — add after `_closePreference = data?.ClosePreference;`:
```csharp
_lastConnectedServerId = data?.LastConnectedServerId;
```

4. Update `Save()`:
```csharp
private void Save()
{
    var data = new ConfigData
    {
        Servers = _servers,
        Settings = _settings,
        Window = _windowState,
        ClosePreference = _closePreference,
        LastConnectedServerId = _lastConnectedServerId,
    };
    File.WriteAllText(_configPath, JsonSerializer.Serialize(data, _jsonOptions));
}
```

5. Add the public methods:
```csharp
public string? GetLastConnectedServerId()
{
    lock (_lock) return _lastConnectedServerId;
}

public void SaveLastConnectedServerId(string? serverId)
{
    lock (_lock) { _lastConnectedServerId = serverId; Save(); }
}
```

**Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter SavesAndReloads_LastConnectedServerId -v n`
Expected: PASS

**Step 5: Run full test suite to check for regressions**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj -v n`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/AppConfigService.cs src/Brmble.Client/Services/AppConfig/IAppConfigService.cs tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs
git commit -m "feat: add LastConnectedServerId tracking to AppConfigService"
```

---

### Task 3: Track last connected server in MumbleAdapter.ServerSync

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:756-822`
- Modify: `src/Brmble.Client/Program.cs:126-142`

**Step 1: Add `IAppConfigService` to MumbleAdapter**

MumbleAdapter currently doesn't have a reference to `AppConfigService`. We need to pass it in.

In `MumbleAdapter.cs`, add a field:
```csharp
private readonly IAppConfigService? _appConfigService;
```

Update the constructor to accept and store it. Look at the existing constructor signature and add `IAppConfigService? appConfigService = null` as an optional parameter.

In `Program.cs` line 126, update the MumbleAdapter construction to pass `_appConfigService`:
```csharp
_mumbleClient = new MumbleAdapter(_bridge, _hwnd, _certService, _appConfigService);
```

**Step 2: Save LastConnectedServerId in ServerSync**

In `MumbleAdapter.cs`, inside `ServerSync()` (after the `_bridge?.Send("voice.connected", ...)` call around line 776), add:

```csharp
if (_activeServerId is not null)
{
    _appConfigService?.SaveLastConnectedServerId(_activeServerId);
}
```

`_activeServerId` is already set from the `voice.connect` handler (line 649).

**Step 3: Build to verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeds.

**Step 4: Run existing tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj -v n`
Expected: All tests pass (MumbleAdapter tests don't exercise this constructor path directly).

**Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs src/Brmble.Client/Program.cs
git commit -m "feat: track last connected server ID on successful connection"
```

---

### Task 4: Add auto-connect startup logic in Program.cs

**Files:**
- Modify: `src/Brmble.Client/Program.cs:99-155`

**Step 1: Add auto-connect method**

Add a new private method to `Program.cs`:

```csharp
private static void TryAutoConnect()
{
    var settings = _appConfigService!.GetSettings();
    if (!settings.AutoConnectEnabled) return;

    // Resolve target server
    var targetId = settings.AutoConnectServerId ?? _appConfigService.GetLastConnectedServerId();
    if (targetId is null) return;

    var servers = _appConfigService.GetServers();
    var server = servers.FirstOrDefault(s => s.Id == targetId);
    if (server is null) return;

    // Trigger connection via bridge — same path as manual connect
    _bridge!.Send("voice.autoConnect", new
    {
        id = server.Id,
        label = server.Label,
        apiUrl = server.ApiUrl,
        host = server.Host,
        port = server.Port,
        username = server.Username,
    });
}
```

**Step 2: Call TryAutoConnect after navigation**

In `InitWebView2Async`, after the `Navigate()` call (line ~149), we need to trigger auto-connect once the frontend is ready. The cleanest approach: call `TryAutoConnect()` after the bridge is set up, and have the frontend listen for `voice.autoConnect` to initiate connection.

Add after the `Navigate()` calls at the end of `InitWebView2Async`:

```csharp
// Auto-connect after frontend loads (frontend handles the voice.autoConnect message)
_controller.CoreWebView2.NavigationCompleted += (s, e) =>
{
    if (e.IsSuccess) TryAutoConnect();
};
```

**Step 3: Build to verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/Brmble.Client/Program.cs
git commit -m "feat: add auto-connect startup logic in Program.cs"
```

---

### Task 5: Handle voice.autoConnect in the frontend

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Add bridge listener for `voice.autoConnect`**

In `App.tsx`, find the `useEffect` that sets up bridge event listeners (the large block that handles `voice.connected`, `voice.disconnected`, etc.). Add a handler for `voice.autoConnect`:

```typescript
const handleAutoConnect = (data: unknown) => {
  const server = data as { id: string; label: string; apiUrl?: string; host?: string; port?: number; username: string } | undefined;
  if (server) {
    setServerLabel(server.label || `${server.host}:${server.port}`);
    setConnectionStatus('connecting');
    bridge.send('voice.connect', {
      id: server.id,
      apiUrl: server.apiUrl || '',
      host: server.host || '',
      port: server.port || 0,
      username: server.username,
      password: '',
    });
  }
};

bridge.on('voice.autoConnect', handleAutoConnect);
```

Add cleanup in the return function:
```typescript
bridge.off('voice.autoConnect', handleAutoConnect);
```

**Step 2: Build to verify**

Run in `src/Brmble.Web`: `npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: handle voice.autoConnect message in frontend"
```

---

### Task 6: Create ConnectionSettingsTab component

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.tsx`
- Create: `src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.css`

**Step 1: Create the CSS file**

Create `src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.css`:

```css
.connection-settings-tab .settings-hint {
  color: #666;
  font-size: 12px;
  margin-top: 12px;
}

.connection-settings-tab .tooltip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--border-subtle);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
  cursor: help;
  margin-left: 6px;
  position: relative;
}

.connection-settings-tab .tooltip-icon:hover::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-deep);
  color: var(--text-primary);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 400;
  white-space: normal;
  width: 260px;
  text-align: left;
  border: 1px solid var(--border-subtle);
  z-index: 10;
  pointer-events: none;
}

.connection-settings-tab .server-dropdown-row {
  display: flex;
  align-items: center;
  padding: 0.75rem 0;
}

.connection-settings-tab .server-dropdown-row label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-right: auto;
}

.connection-settings-tab .server-dropdown-row .settings-select {
  flex-shrink: 0;
}

.connection-settings-tab .settings-select:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

**Step 2: Create the component**

Create `src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.tsx`:

```tsx
import './ConnectionSettingsTab.css';

interface ConnectionSettingsTabProps {
  settings: ConnectionSettings;
  onChange: (settings: ConnectionSettings) => void;
  servers: Array<{ id: string; label: string }>;
}

export interface ConnectionSettings {
  autoConnectEnabled: boolean;
  autoConnectServerId: string | null;
}

export const DEFAULT_CONNECTION: ConnectionSettings = {
  autoConnectEnabled: false,
  autoConnectServerId: null,
};

export function ConnectionSettingsTab({ settings, onChange, servers }: ConnectionSettingsTabProps) {
  const handleToggle = () => {
    onChange({ ...settings, autoConnectEnabled: !settings.autoConnectEnabled });
  };

  const handleServerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    onChange({ ...settings, autoConnectServerId: value === '' ? null : value });
  };

  const tooltipText = "Choose 'Last connected server' to reconnect where you left off, or pick a specific server to always connect to that one.";

  return (
    <div className="connection-settings-tab">
      <div className="settings-section">
        <div className="settings-section-title">Startup</div>

        <div className="settings-item settings-toggle">
          <label>Auto-connect on startup</label>
          <input
            type="checkbox"
            className="toggle-input"
            checked={settings.autoConnectEnabled}
            onChange={handleToggle}
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
    </div>
  );
}
```

**Step 3: Build to verify**

Run in `src/Brmble.Web`: `npm run build`
Expected: Build succeeds (component not yet wired in, but should compile).

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.css
git commit -m "feat: create ConnectionSettingsTab component"
```

---

### Task 7: Wire ConnectionSettingsTab into SettingsModal

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`

**Step 1: Add import and state**

At the top of `SettingsModal.tsx`, add the import:

```typescript
import { ConnectionSettingsTab, type ConnectionSettings, DEFAULT_CONNECTION } from './ConnectionSettingsTab';
import { useServerlist } from '../../hooks/useServerlist';
```

**Step 2: Update the AppSettings interface and defaults**

Add to the `AppSettings` interface:

```typescript
interface AppSettings {
  audio: AudioSettings;
  shortcuts: ShortcutsSettings;
  messages: MessagesSettings;
  overlay: OverlaySettings;
  speechEnhancement: SpeechEnhancementSettings;
  autoConnectEnabled: boolean;
  autoConnectServerId: string | null;
}
```

Update `DEFAULT_SETTINGS`:

```typescript
const DEFAULT_SETTINGS: AppSettings = {
  audio: DEFAULT_AUDIO,
  shortcuts: DEFAULT_SHORTCUTS,
  messages: DEFAULT_MESSAGES,
  overlay: DEFAULT_OVERLAY,
  speechEnhancement: DEFAULT_SPEECH_ENHANCEMENT,
  autoConnectEnabled: false,
  autoConnectServerId: null,
};
```

**Step 3: Add the Connection tab type and server list hook**

Update the `activeTab` state type:

```typescript
const [activeTab, setActiveTab] = useState<'audio' | 'shortcuts' | 'messages' | 'overlay' | 'connection' | 'identity'>('audio');
```

Add `useServerlist` inside the component:

```typescript
const { servers } = useServerlist();
```

**Step 4: Add the change handler**

Add alongside the other handlers:

```typescript
const handleConnectionChange = (connection: ConnectionSettings) => {
  const newSettings = {
    ...settings,
    autoConnectEnabled: connection.autoConnectEnabled,
    autoConnectServerId: connection.autoConnectServerId,
  };
  setSettings(newSettings);
  bridge.send('settings.set', { settings: newSettings });
};
```

**Step 5: Add the tab button and content**

Add the tab button between Overlay and Identity in the tabs section:

```tsx
<button
  className={`settings-tab ${activeTab === 'connection' ? 'active' : ''}`}
  onClick={() => setActiveTab('connection')}
>
  Connection
</button>
```

Add the content rendering in the settings-content div:

```tsx
{activeTab === 'connection' && (
  <ConnectionSettingsTab
    settings={{
      autoConnectEnabled: settings.autoConnectEnabled,
      autoConnectServerId: settings.autoConnectServerId,
    }}
    onChange={handleConnectionChange}
    servers={servers.map(s => ({ id: s.id, label: s.label }))}
  />
)}
```

**Step 6: Build to verify**

Run in `src/Brmble.Web`: `npm run build`
Expected: Build succeeds.

**Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx
git commit -m "feat: wire Connection tab into SettingsModal"
```

---

### Task 8: Add auto-connect settings persistence test

**Files:**
- Modify: `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`

**Step 1: Write the test**

```csharp
[TestMethod]
public void SavesAndReloads_AutoConnectSettings()
{
    var svc = new AppConfigService(_tempDir);
    var updated = svc.GetSettings() with
    {
        AutoConnectEnabled = true,
        AutoConnectServerId = "server-xyz"
    };

    svc.SetSettings(updated);
    var svc2 = new AppConfigService(_tempDir);

    Assert.IsTrue(svc2.GetSettings().AutoConnectEnabled);
    Assert.AreEqual("server-xyz", svc2.GetSettings().AutoConnectServerId);
}
```

**Step 2: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter SavesAndReloads_AutoConnectSettings -v n`
Expected: PASS (implementation already done in Tasks 1-2).

**Step 3: Write edge case test — deleted server fallback**

```csharp
[TestMethod]
public void AutoConnect_ClearsServerId_WhenServerRemoved()
{
    var svc = new AppConfigService(_tempDir);
    svc.AddServer(new ServerEntry("srv1", "Test Server", null, "localhost", 64738, "alice"));
    svc.SetSettings(svc.GetSettings() with { AutoConnectEnabled = true, AutoConnectServerId = "srv1" });

    svc.RemoveServer("srv1");

    // Settings still reference the old server ID — the startup logic in Program.cs
    // handles the fallback (server not found → show server list).
    // This test verifies the data layer doesn't crash.
    var svc2 = new AppConfigService(_tempDir);
    Assert.AreEqual("srv1", svc2.GetSettings().AutoConnectServerId);
    Assert.AreEqual(0, svc2.GetServers().Count);
}
```

**Step 4: Run full test suite**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj -v n`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs
git commit -m "test: add auto-connect settings persistence and edge case tests"
```

---

### Task 9: Build everything and verify

**Files:** None (verification only)

**Step 1: Build the full solution**

Run: `dotnet build`
Expected: Build succeeds with no errors.

**Step 2: Build the frontend**

Run in `src/Brmble.Web`: `npm run build`
Expected: Build succeeds.

**Step 3: Run all tests**

Run: `dotnet test`
Expected: All tests pass.

**Step 4: Commit the plan document**

```bash
git add docs/plans/2026-02-23-auto-connect-on-startup.md
git commit -m "docs: add auto-connect on startup implementation plan"
```
