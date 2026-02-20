# Window State Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist window size, position, and maximized state to `config.json` so Brmble reopens exactly where the user left it, with graceful fallback when the saved monitor is gone.

**Architecture:** `WindowState` is a new record stored as a nullable top-level field in `AppConfigService`'s internal `ConfigData`. `AppConfigService` is moved to `Main()` (before window creation) so the saved state can be applied before the window appears. `GetWindowPlacement` saves the restored-size rect even when closing maximized; `MonitorFromPoint` validates the saved position on restore.

**Tech Stack:** C# 13 / .NET 10, Win32 P/Invoke (`user32.dll`), MSTest, System.Text.Json

---

### Task 1: Add WindowState record and extend IAppConfigService

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppSettings.cs`
- Modify: `src/Brmble.Client/Services/AppConfig/IAppConfigService.cs`

**Step 1: Add the WindowState record to AppSettings.cs**

Append to the bottom of `src/Brmble.Client/Services/AppConfig/AppSettings.cs` (after the `AppSettings` record):

```csharp
public record WindowState(int X, int Y, int Width, int Height, bool IsMaximized);
```

**Step 2: Add the two new methods to IAppConfigService**

In `src/Brmble.Client/Services/AppConfig/IAppConfigService.cs`, add after `void SetSettings(AppSettings settings);`:

```csharp
WindowState? GetWindowState();
void SaveWindowState(WindowState state);
```

**Step 3: Build**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded (one error about `AppConfigService` not implementing the interface — that's fine, fixed in Task 2).

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/AppSettings.cs src/Brmble.Client/Services/AppConfig/IAppConfigService.cs
git commit -m "feat: add WindowState record and extend IAppConfigService"
```

---

### Task 2: Implement WindowState in AppConfigService (TDD)

**Files:**
- Modify: `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`
- Modify: `src/Brmble.Client/Services/AppConfig/AppConfigService.cs`

**Step 1: Write the failing test**

Add this test method to `AppConfigServiceTests` (inside the class, after `MigratesFromServersJson_WhenConfigJsonMissing`):

```csharp
[TestMethod]
public void SavesAndReloads_WindowState()
{
    var svc = new AppConfigService(_tempDir);
    Assert.IsNull(svc.GetWindowState(), "No state saved yet — should be null");

    svc.SaveWindowState(new WindowState(100, 200, 1024, 768, IsMaximized: false));
    var svc2 = new AppConfigService(_tempDir);

    var ws = svc2.GetWindowState();
    Assert.IsNotNull(ws);
    Assert.AreEqual(100, ws.X);
    Assert.AreEqual(200, ws.Y);
    Assert.AreEqual(1024, ws.Width);
    Assert.AreEqual(768, ws.Height);
    Assert.IsFalse(ws.IsMaximized);
}
```

**Step 2: Run to verify it fails**

```bash
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter SavesAndReloads_WindowState
```

Expected: Build error — `AppConfigService` does not implement `GetWindowState`/`SaveWindowState`.

**Step 3: Implement in AppConfigService**

Make these four changes to `src/Brmble.Client/Services/AppConfig/AppConfigService.cs`:

**(a)** Add a field after `private AppSettings _settings = AppSettings.Default;`:

```csharp
private WindowState? _windowState;
```

**(b)** Add two public methods after `SetSettings`:

```csharp
public WindowState? GetWindowState()
{
    lock (_lock) return _windowState;
}

public void SaveWindowState(WindowState state)
{
    lock (_lock) { _windowState = state; Save(); }
}
```

**(c)** Update the `ConfigData` private record to include `WindowState?`:

Replace:
```csharp
private record ConfigData
{
    public List<ServerEntry> Servers { get; init; } = [];
    public AppSettings Settings { get; init; } = AppSettings.Default;
}
```

With:
```csharp
private record ConfigData
{
    public List<ServerEntry> Servers { get; init; } = [];
    public AppSettings Settings { get; init; } = AppSettings.Default;
    public WindowState? Window { get; init; } = null;
}
```

**(d)** Update `Load()` to read `_windowState`, and update `Save()` to write it.

In `Load()`, change:
```csharp
_servers = data?.Servers ?? new List<ServerEntry>();
_settings = data?.Settings ?? AppSettings.Default;
```

To:
```csharp
_servers = data?.Servers ?? new List<ServerEntry>();
_settings = data?.Settings ?? AppSettings.Default;
_windowState = data?.Window;
```

In `Save()`, change:
```csharp
var data = new ConfigData { Servers = _servers, Settings = _settings };
```

To:
```csharp
var data = new ConfigData { Servers = _servers, Settings = _settings, Window = _windowState };
```

**Step 4: Run the test to verify it passes**

```bash
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter SavesAndReloads_WindowState
```

Expected: Passed — 1 test.

**Step 5: Run all client tests**

```bash
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj
```

Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/AppConfigService.cs tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs
git commit -m "feat: implement WindowState persistence in AppConfigService"
```

---

### Task 3: Add Win32 P/Invokes to Win32Window.cs

**Files:**
- Modify: `src/Brmble.Client/Win32Window.cs`

**Step 1: Make CW_USEDEFAULT public and add WINDOWPLACEMENT struct**

In `Win32Window.cs`, change:
```csharp
private const int CW_USEDEFAULT = unchecked((int)0x80000000);
```
To:
```csharp
public const int CW_USEDEFAULT = unchecked((int)0x80000000);
```

After the existing `MINMAXINFO` struct, add:

```csharp
[StructLayout(LayoutKind.Sequential)]
public struct WINDOWPLACEMENT
{
    public uint length;
    public uint flags;
    public uint showCmd;
    public POINT ptMinPosition;
    public POINT ptMaxPosition;
    public RECT rcNormalPosition;
}
```

**Step 2: Add the two new P/Invoke declarations**

Add these after the existing `[DllImport("user32.dll")]` declarations (e.g. after `IsWindowVisible`):

```csharp
public const uint MONITOR_DEFAULTTONULL = 0x00000000;

[DllImport("user32.dll")]
public static extern bool GetWindowPlacement(IntPtr hwnd, ref WINDOWPLACEMENT lpwndpl);

[DllImport("user32.dll")]
public static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);
```

**Step 3: Update Create() to accept x and y**

Change the `Create` signature from:
```csharp
public static IntPtr Create(string className, string title, int width, int height, WndProc wndProc)
```
To:
```csharp
public static IntPtr Create(string className, string title, int x, int y, int width, int height, WndProc wndProc)
```

And update the `CreateWindowEx` call inside it from:
```csharp
return CreateWindowEx(0, className, title,
    WS_OVERLAPPEDWINDOW | WS_VISIBLE,
    CW_USEDEFAULT, CW_USEDEFAULT, width, height,
    IntPtr.Zero, IntPtr.Zero, hInstance, IntPtr.Zero);
```
To:
```csharp
return CreateWindowEx(0, className, title,
    WS_OVERLAPPEDWINDOW | WS_VISIBLE,
    x, y, width, height,
    IntPtr.Zero, IntPtr.Zero, hInstance, IntPtr.Zero);
```

**Step 4: Build**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: One error — `Program.cs` still calls `Win32Window.Create` with the old signature. That's fixed in Task 4.

**Step 5: Commit**

```bash
git add src/Brmble.Client/Win32Window.cs
git commit -m "feat: add GetWindowPlacement, MonitorFromPoint and parameterize Create() position"
```

---

### Task 4: Update Program.cs — restore on startup, save on close

**Files:**
- Modify: `src/Brmble.Client/Program.cs`

**Step 1: Move AppConfigService initialization to Main()**

In `Main()`, add these two lines before `Win32Window.Create(...)`:

```csharp
_appConfigService = new AppConfigService();
var savedWindow = _appConfigService.GetWindowState();
```

Determine the resolved position/size to pass to `Create`:

```csharp
int wx = Win32Window.CW_USEDEFAULT, wy = Win32Window.CW_USEDEFAULT;
int ww = 1280, wh = 720;
bool restoreMaximized = false;

if (savedWindow != null)
{
    var center = new Win32Window.POINT
    {
        X = savedWindow.X + savedWindow.Width / 2,
        Y = savedWindow.Y + savedWindow.Height / 2
    };
    var monitor = Win32Window.MonitorFromPoint(center, Win32Window.MONITOR_DEFAULTTONULL);
    if (monitor != IntPtr.Zero)
    {
        wx = savedWindow.X;
        wy = savedWindow.Y;
        ww = savedWindow.Width;
        wh = savedWindow.Height;
        restoreMaximized = savedWindow.IsMaximized;
    }
}
```

Change the `Win32Window.Create(...)` call from:
```csharp
_hwnd = Win32Window.Create("BrmbleWindow", "Brmble", 1280, 720, WndProc);
```
To:
```csharp
_hwnd = Win32Window.Create("BrmbleWindow", "Brmble", wx, wy, ww, wh, WndProc);
if (restoreMaximized)
    Win32Window.ShowWindow(_hwnd, Win32Window.SW_MAXIMIZE);
```

**Step 2: Remove the duplicate AppConfigService construction from InitWebView2Async**

In `InitWebView2Async`, remove the line:
```csharp
_appConfigService = new AppConfigService();
```

Leave the other three lines unchanged:
```csharp
_appConfigService.Initialize(_bridge);
_appConfigService.OnSettingsChanged = settings => _mumbleClient?.ApplySettings(settings);
_appConfigService.RegisterHandlers(_bridge);
```

**Step 3: Save window state on WM_DESTROY**

In `WndProc`, find the `WM_DESTROY` case. It currently starts with:
```csharp
case Win32Window.WM_DESTROY:
    _mumbleClient?.Disconnect();
```

Add the save at the very top of that case, before `_mumbleClient?.Disconnect()`:

```csharp
case Win32Window.WM_DESTROY:
    if (_appConfigService != null)
    {
        var placement = new Win32Window.WINDOWPLACEMENT
        {
            length = (uint)Marshal.SizeOf<Win32Window.WINDOWPLACEMENT>()
        };
        Win32Window.GetWindowPlacement(hwnd, ref placement);
        _appConfigService.SaveWindowState(new Services.AppConfig.WindowState(
            X: placement.rcNormalPosition.Left,
            Y: placement.rcNormalPosition.Top,
            Width: placement.rcNormalPosition.Right - placement.rcNormalPosition.Left,
            Height: placement.rcNormalPosition.Bottom - placement.rcNormalPosition.Top,
            IsMaximized: placement.showCmd == 3 // SW_SHOWMAXIMIZED
        ));
    }
    _mumbleClient?.Disconnect();
```

**Step 4: Build**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded, 0 errors.

**Step 5: Run all tests**

```bash
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj
```

Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/Brmble.Client/Program.cs
git commit -m "feat: restore window position/size/maximized state on startup"
```

---

### Task 5: Manual smoke test

**Step 1: Build and run**

```bash
cd src/Brmble.Web && npm run build
dotnet run --project src/Brmble.Client
```

**Step 2: Verify default placement**

On first run (no saved state), window opens at OS-default position, 1280×720. Check `%APPDATA%\Brmble\config.json` — the `window` key should be absent.

**Step 3: Move, resize, close**

Move the window to a non-default position, resize it, then close via tray → Quit. Reopen — window should appear at the same position and size.

Verify `%APPDATA%\Brmble\config.json` now contains a `window` object:
```json
"window": { "x": ..., "y": ..., "width": ..., "height": ..., "isMaximized": false }
```

**Step 4: Maximize and close**

Maximize the window, close via tray → Quit. Reopen — window should reopen maximized.

**Step 5: Simulate missing monitor**

Edit `config.json` manually and set `x` and `y` to large values (e.g. `9000`, `9000`) that no monitor covers. Reopen — window should fall back to OS-default position without crashing.
