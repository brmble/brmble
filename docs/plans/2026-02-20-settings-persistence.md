# Settings Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist all app settings (audio, shortcuts, messages, overlay) across sessions using a single `config.json` file in `%APPDATA%\Brmble\`, replacing the current `localStorage`-based approach and consolidating the server list into the same file.

**Architecture:** `ServerlistService` is renamed to `AppConfigService` and manages a unified `config.json` containing both the server list and all app settings. The frontend removes all `localStorage` usage and reads/writes settings exclusively via the bridge (`settings.get` / `settings.set`). On startup, saved settings are applied directly to `MumbleAdapter` before the frontend connects.

**Tech Stack:** C# 13 / .NET 10, MSTest, System.Text.Json, React + TypeScript, WebView2 bridge

---

### Task 1: Create Brmble.Client.Tests project

**Files:**
- Create: `tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`

**Step 1: Create the project file**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0-windows</TargetFramework>
    <IsPackable>false</IsPackable>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.12.0" />
    <PackageReference Include="MSTest.TestAdapter" Version="3.7.3" />
    <PackageReference Include="MSTest.TestFramework" Version="3.7.3" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\..\src\Brmble.Client\Brmble.Client.csproj" />
  </ItemGroup>
</Project>
```

**Step 2: Add to solution**

```bash
dotnet sln add tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj
```

**Step 3: Verify it builds**

```bash
dotnet build tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj
```

Expected: Build succeeded, 0 errors.

**Step 4: Commit**

```bash
git add tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj brmble.sln
git commit -m "test: add Brmble.Client.Tests project"
```

---

### Task 2: Create AppSettings models

**Files:**
- Create: `src/Brmble.Client/Services/AppConfig/AppSettings.cs`

**Step 1: Create the models file**

```csharp
namespace Brmble.Client.Services.AppConfig;

public record AudioSettings(
    string InputDevice = "default",
    string OutputDevice = "default",
    int InputVolume = 100,
    int OutputVolume = 100,
    string TransmissionMode = "voiceActivity",
    string? PushToTalkKey = null
);

public record ShortcutsSettings(
    string? ToggleMuteKey = null,
    string? ToggleDeafenKey = null,
    string? ToggleMuteDeafenKey = null
);

public record MessagesSettings(
    bool TtsEnabled = false,
    int TtsVolume = 100,
    bool NotificationsEnabled = true
);

public record OverlaySettings(
    bool OverlayEnabled = false
);

public record AppSettings(
    AudioSettings Audio,
    ShortcutsSettings Shortcuts,
    MessagesSettings Messages,
    OverlaySettings Overlay
)
{
    public static AppSettings Default => new(
        new AudioSettings(),
        new ShortcutsSettings(),
        new MessagesSettings(),
        new OverlaySettings()
    );
}
```

**Step 2: Verify it builds**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded.

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/AppSettings.cs
git commit -m "feat: add AppSettings models for config persistence"
```

---

### Task 3: Create AppConfigService with failing tests

**Files:**
- Create: `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`
- Create: `src/Brmble.Client/Services/AppConfig/AppConfigService.cs`
- Create: `src/Brmble.Client/Services/AppConfig/IAppConfigService.cs`

**Step 1: Write the failing tests**

Create `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`:

```csharp
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Client.Services.AppConfig;
using Brmble.Client.Services.Serverlist;
using System.Text.Json;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class AppConfigServiceTests
{
    private string _tempDir = null!;

    [TestInitialize]
    public void Setup()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(_tempDir);
    }

    [TestCleanup]
    public void Cleanup()
    {
        Directory.Delete(_tempDir, recursive: true);
    }

    [TestMethod]
    public void LoadsDefaultSettings_WhenNoFileExists()
    {
        var svc = new AppConfigService(_tempDir);

        var settings = svc.GetSettings();

        Assert.AreEqual("voiceActivity", settings.Audio.TransmissionMode);
        Assert.AreEqual(100, settings.Audio.InputVolume);
        Assert.IsNull(settings.Shortcuts.ToggleMuteKey);
        Assert.IsFalse(settings.Messages.TtsEnabled);
        Assert.IsFalse(settings.Overlay.OverlayEnabled);
    }

    [TestMethod]
    public void LoadsDefaultServers_WhenNoFileExists()
    {
        var svc = new AppConfigService(_tempDir);

        Assert.AreEqual(0, svc.GetServers().Count);
    }

    [TestMethod]
    public void SavesAndReloads_Settings()
    {
        var svc = new AppConfigService(_tempDir);
        var updated = AppSettings.Default with
        {
            Audio = new AudioSettings(TransmissionMode: "pushToTalk", PushToTalkKey: "KeyF")
        };

        svc.SetSettings(updated);
        var svc2 = new AppConfigService(_tempDir);

        Assert.AreEqual("pushToTalk", svc2.GetSettings().Audio.TransmissionMode);
        Assert.AreEqual("KeyF", svc2.GetSettings().Audio.PushToTalkKey);
    }

    [TestMethod]
    public void SavesAndReloads_Servers()
    {
        var svc = new AppConfigService(_tempDir);
        var server = new ServerEntry("id1", "My Server", "localhost", 64738, "alice");

        svc.AddServer(server);
        var svc2 = new AppConfigService(_tempDir);

        Assert.AreEqual(1, svc2.GetServers().Count);
        Assert.AreEqual("My Server", svc2.GetServers()[0].Label);
    }

    [TestMethod]
    public void MigratesFromServersJson_WhenConfigJsonMissing()
    {
        // Write a legacy servers.json in the temp dir
        var legacyPath = Path.Combine(_tempDir, "servers.json");
        var legacyData = new
        {
            Servers = new[]
            {
                new { Id = "abc", Label = "Legacy", Host = "10.0.0.1", Port = 64738, Username = "bob" }
            }
        };
        File.WriteAllText(legacyPath, JsonSerializer.Serialize(legacyData));

        var svc = new AppConfigService(_tempDir);

        Assert.AreEqual(1, svc.GetServers().Count);
        Assert.AreEqual("Legacy", svc.GetServers()[0].Label);
        Assert.IsTrue(File.Exists(Path.Combine(_tempDir, "config.json")));
    }
}
```

**Step 2: Run to verify they fail**

```bash
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj
```

Expected: FAIL — `AppConfigService` does not exist yet.

**Step 3: Create IAppConfigService interface**

Create `src/Brmble.Client/Services/AppConfig/IAppConfigService.cs`:

```csharp
using Brmble.Client.Services.Serverlist;

namespace Brmble.Client.Services.AppConfig;

public interface IAppConfigService
{
    IReadOnlyList<ServerEntry> GetServers();
    void AddServer(ServerEntry server);
    void UpdateServer(ServerEntry server);
    void RemoveServer(string id);
    AppSettings GetSettings();
    void SetSettings(AppSettings settings);
}
```

**Step 4: Implement AppConfigService**

Create `src/Brmble.Client/Services/AppConfig/AppConfigService.cs`:

```csharp
using System.Text.Json;
using Brmble.Client.Bridge;
using Brmble.Client.Services.Serverlist;

namespace Brmble.Client.Services.AppConfig;

internal sealed class AppConfigService : IAppConfigService
{
    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private readonly string _configPath;
    private readonly string _legacyServersPath;
    private List<ServerEntry> _servers = new();
    private AppSettings _settings = AppSettings.Default;
    private readonly object _lock = new();

    public string ServiceName => "appConfig";

    /// <summary>Optional callback invoked after settings are updated via SetSettings.</summary>
    public Action<AppSettings>? OnSettingsChanged { get; set; }

    public AppConfigService() : this(GetDefaultDir()) { }

    internal AppConfigService(string dir)
    {
        _configPath = Path.Combine(dir, "config.json");
        _legacyServersPath = Path.Combine(dir, "servers.json");
        Load();
    }

    private static string GetDefaultDir()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Brmble");
        Directory.CreateDirectory(dir);
        return dir;
    }

    public void Initialize(NativeBridge bridge) { }

    public void RegisterHandlers(NativeBridge bridge)
    {
        // Server list handlers (unchanged API)
        bridge.RegisterHandler("servers.list", async _ =>
        {
            bridge.Send("servers.list", new { servers = GetServers() });
            await Task.CompletedTask;
        });

        bridge.RegisterHandler("servers.add", async data =>
        {
            var entry = ParseServerEntry(data);
            if (entry != null)
            {
                AddServer(entry);
                bridge.Send("servers.added", new { server = entry });
            }
            await Task.CompletedTask;
        });

        bridge.RegisterHandler("servers.update", async data =>
        {
            var entry = ParseServerEntry(data);
            if (entry != null)
            {
                UpdateServer(entry);
                bridge.Send("servers.updated", new { server = entry });
            }
            await Task.CompletedTask;
        });

        bridge.RegisterHandler("servers.remove", async data =>
        {
            if (data.TryGetProperty("id", out var idEl))
            {
                var id = idEl.GetString();
                if (!string.IsNullOrEmpty(id))
                {
                    RemoveServer(id);
                    bridge.Send("servers.removed", new { id });
                }
            }
            await Task.CompletedTask;
        });

        // Settings handlers
        bridge.RegisterHandler("settings.get", async _ =>
        {
            bridge.Send("settings.current", new { settings = GetSettings() });
            await Task.CompletedTask;
        });

        bridge.RegisterHandler("settings.set", async data =>
        {
            if (data.TryGetProperty("settings", out var settingsEl))
            {
                var updated = JsonSerializer.Deserialize<AppSettings>(settingsEl.GetRawText(), _jsonOptions);
                if (updated != null)
                {
                    SetSettings(updated);
                    bridge.Send("settings.updated", new { settings = GetSettings() });
                }
            }
            await Task.CompletedTask;
        });
    }

    public IReadOnlyList<ServerEntry> GetServers()
    {
        lock (_lock) return _servers.ToList();
    }

    public void AddServer(ServerEntry server)
    {
        lock (_lock) { _servers.Add(server); Save(); }
    }

    public void UpdateServer(ServerEntry server)
    {
        lock (_lock)
        {
            var i = _servers.FindIndex(s => s.Id == server.Id);
            if (i >= 0) { _servers[i] = server; Save(); }
        }
    }

    public void RemoveServer(string id)
    {
        lock (_lock) { _servers.RemoveAll(s => s.Id == id); Save(); }
    }

    public AppSettings GetSettings()
    {
        lock (_lock) return _settings;
    }

    public void SetSettings(AppSettings settings)
    {
        lock (_lock) { _settings = settings; Save(); }
        OnSettingsChanged?.Invoke(settings);
    }

    private void Load()
    {
        try
        {
            if (File.Exists(_configPath))
            {
                var json = File.ReadAllText(_configPath);
                var data = JsonSerializer.Deserialize<ConfigData>(json, _jsonOptions);
                _servers = data?.Servers ?? new List<ServerEntry>();
                _settings = data?.Settings ?? AppSettings.Default;
                return;
            }

            // Migrate from legacy servers.json
            if (File.Exists(_legacyServersPath))
            {
                var json = File.ReadAllText(_legacyServersPath);
                var legacy = JsonSerializer.Deserialize<LegacyServerlistData>(json);
                _servers = legacy?.Servers ?? new List<ServerEntry>();
                Save(); // write config.json immediately
                return;
            }
        }
        catch
        {
            _servers = new List<ServerEntry>();
            _settings = AppSettings.Default;
        }
    }

    private void Save()
    {
        var data = new ConfigData { Servers = _servers, Settings = _settings };
        File.WriteAllText(_configPath, JsonSerializer.Serialize(data, _jsonOptions));
    }

    private static ServerEntry? ParseServerEntry(System.Text.Json.JsonElement data)
    {
        if (!data.TryGetProperty("label", out var label) ||
            !data.TryGetProperty("host", out var host) ||
            !data.TryGetProperty("port", out var port) ||
            !data.TryGetProperty("username", out var username))
            return null;

        var id = data.TryGetProperty("id", out var idEl)
            ? idEl.GetString()
            : Guid.NewGuid().ToString();

        return new ServerEntry(
            id!,
            label.GetString() ?? "",
            host.GetString() ?? "",
            port.GetInt32(),
            username.GetString() ?? "");
    }

    private record ConfigData
    {
        public List<ServerEntry> Servers { get; init; } = [];
        public AppSettings Settings { get; init; } = AppSettings.Default;
    }

    private record LegacyServerlistData
    {
        public List<ServerEntry> Servers { get; init; } = [];
    }
}
```

**Step 5: Run tests**

```bash
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj
```

Expected: All 5 tests pass.

**Step 6: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/ tests/Brmble.Client.Tests/Services/
git commit -m "feat: add AppConfigService with settings + server persistence and migration"
```

---

### Task 4: Update Program.cs to use AppConfigService

**Files:**
- Modify: `src/Brmble.Client/Program.cs`

**Step 1: Replace ServerlistService with AppConfigService**

In `Program.cs`, make these changes:

1. Add using: `using Brmble.Client.Services.AppConfig;`
2. Remove: `using Brmble.Client.Services.Serverlist;`
3. Change field: `private static ServerlistService? _serverlistService;` → `private static AppConfigService? _appConfigService;`
4. In `InitWebView2Async`, replace the serverlist initialization block:

Old:
```csharp
_serverlistService = new ServerlistService();
_serverlistService.Initialize(_bridge);
_serverlistService.RegisterHandlers(_bridge);
```

New:
```csharp
_appConfigService = new AppConfigService();
_appConfigService.Initialize(_bridge);
_appConfigService.OnSettingsChanged = settings => _mumbleClient?.ApplySettings(settings);
_appConfigService.RegisterHandlers(_bridge);
```

5. After `_mumbleClient = new MumbleAdapter(...)` and before `SetupBridgeHandlers()`, add:

```csharp
_mumbleClient.ApplySettings(_appConfigService.GetSettings());
```

**Step 2: Build**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded.

**Step 3: Commit**

```bash
git add src/Brmble.Client/Program.cs
git commit -m "feat: wire AppConfigService in Program.cs, apply settings on startup"
```

---

### Task 5: Add ApplySettings to MumbleAdapter

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `src/Brmble.Client/Services/Voice/VoiceService.cs`

**Step 1: Add method to VoiceService interface**

In `VoiceService.cs`, add one line to the interface:

```csharp
void ApplySettings(AppConfig.AppSettings settings);
```

Also add the using at the top:
```csharp
using Brmble.Client.Services.AppConfig;
```

**Step 2: Implement ApplySettings in MumbleAdapter**

Add the using at the top of `MumbleAdapter.cs`:
```csharp
using Brmble.Client.Services.AppConfig;
```

Add this method to the `MumbleAdapter` class (near `SetTransmissionMode`):

```csharp
public void ApplySettings(AppSettings settings)
{
    SetTransmissionMode(settings.Audio.TransmissionMode, settings.Audio.PushToTalkKey);
    _audioManager?.SetShortcut("toggleMute", settings.Shortcuts.ToggleMuteKey);
    _audioManager?.SetShortcut("toggleDeafen", settings.Shortcuts.ToggleDeafenKey);
    _audioManager?.SetShortcut("toggleMuteDeafen", settings.Shortcuts.ToggleMuteDeafenKey);
}
```

**Step 3: Build**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded.

**Step 4: Run all tests**

```bash
dotnet test
```

Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs src/Brmble.Client/Services/Voice/VoiceService.cs
git commit -m "feat: add ApplySettings to MumbleAdapter for startup restoration"
```

---

### Task 6: Update SettingsModal.tsx — remove localStorage, use bridge

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`

**Context:** The current `SettingsModal` saves settings to `localStorage` on every change and loads them on mount via `loadSettings()`. We replace this with a bridge round-trip: on mount send `settings.get`, receive `settings.current`, on any change send `settings.set`.

**Step 1: Replace the top of SettingsModal.tsx**

Remove these lines:
```typescript
const STORAGE_KEY = 'brmble-settings';

function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return DEFAULT_SETTINGS;
}
```

**Step 2: Update the useState and add useEffect for settings.get**

Replace:
```typescript
const [settings, setSettings] = useState<AppSettings>(loadSettings);
```

With:
```typescript
const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

useEffect(() => {
  const handleCurrent = (data: unknown) => {
    const d = data as { settings?: AppSettings } | undefined;
    if (d?.settings) {
      setSettings({ ...DEFAULT_SETTINGS, ...d.settings });
    }
  };

  bridge.on('settings.current', handleCurrent);
  bridge.send('settings.get');

  return () => {
    bridge.off('settings.current', handleCurrent);
  };
}, []);
```

**Step 3: Replace localStorage.setItem calls with bridge.send in all handlers**

In `handleAudioChange`, replace:
```typescript
localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
```
With:
```typescript
bridge.send('settings.set', { settings: newSettings });
```

In `handleShortcutsChange`, replace:
```typescript
localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
```
With:
```typescript
bridge.send('settings.set', { settings: newSettings });
```

In `handleMessagesChange`, replace the two lines:
```typescript
const newSettings = { ...settings, messages };
setSettings(newSettings);
localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
```
With:
```typescript
const newSettings = { ...settings, messages };
setSettings(newSettings);
bridge.send('settings.set', { settings: newSettings });
```

In `handleOverlayChange`, replace:
```typescript
const newSettings = { ...settings, overlay };
setSettings(newSettings);
localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
```
With:
```typescript
const newSettings = { ...settings, overlay };
setSettings(newSettings);
bridge.send('settings.set', { settings: newSettings });
```

**Step 4: Fix the "Save Changes" button (currently has no onClick)**

Replace:
```typescript
<button className="settings-btn primary">
  Save Changes
</button>
```
With:
```typescript
<button className="settings-btn primary" onClick={onClose}>
  Save Changes
</button>
```

**Step 5: Build the frontend**

```bash
cd src/Brmble.Web && npm run build
```

Expected: Build succeeded, no TypeScript errors.

**Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx
git commit -m "feat: persist settings via C# bridge instead of localStorage"
```

---

### Task 7: Manual smoke test

**Step 1: Start the dev server and app**

```bash
# Terminal 1
cd src/Brmble.Web && npm run dev

# Terminal 2
dotnet run --project src/Brmble.Client
```

**Step 2: Verify settings load on startup**

- Open Settings
- Confirm default values are shown (voiceActivity, volumes at 100, no shortcuts)

**Step 3: Change a setting and restart**

- Set transmission mode to "Push to Talk", bind a key
- Close settings
- Quit the app (tray → Quit)
- Restart: `dotnet run --project src/Brmble.Client`
- Open Settings → Audio tab: "Push to Talk" should be selected and key should be shown

**Step 4: Verify config.json was written**

```bash
cat "$APPDATA/Brmble/config.json"
```

Expected: JSON file with servers array and settings object containing the saved values.

**Step 5: Verify production mode also works**

```bash
cd src/Brmble.Web && npm run build
dotnet run --project src/Brmble.Client
```

Change a setting, restart, verify it persists (same config.json, no origin issues).

**Step 6: Final commit if any cleanup needed, then push**

```bash
git log --oneline feature/settings-persistence
```

Review all commits, then ask the user if they want to push and open a PR.
