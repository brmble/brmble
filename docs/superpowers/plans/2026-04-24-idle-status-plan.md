# Idle Status Implementation Plan (v2 - Optimized)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement system-wide inactivity detection using `GetLastInputInfo` in the C# client and broadcast it via Matrix presence to show a "moon" idle icon in the UI.

**Architecture:** A background C# service polls system inactivity and notifies the frontend via the WebView2 bridge. The frontend then updates the user's Matrix presence status.

**Tech Stack:** C# (Win32 P/Invoke), React, Matrix (matrix-js-sdk).

---

### Task 1: C# System Idle Detection

**Files:**
- Create: `src/Brmble.Client/Services/SystemIdleMonitor.cs`
- Modify: `src/Brmble.Client/Program.cs`

- [ ] **Step 1: Create the SystemIdleMonitor class**
  Implement the Win32 `GetLastInputInfo` P/Invoke. Ensure `Start()` performs an initial check immediately.

```csharp
using System.Runtime.InteropServices;
using System.Timers;
using Brmble.Client.Bridge;
using Brmble.Client.Services.AppConfig;

namespace Brmble.Client.Services;

internal sealed class SystemIdleMonitor : IDisposable
{
    private readonly NativeBridge _bridge;
    private readonly IAppConfigService _config;
    private readonly Timer _timer;
    private bool _isIdle;

    [StructLayout(LayoutKind.Sequential)]
    struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    public SystemIdleMonitor(NativeBridge bridge, IAppConfigService config)
    {
        _bridge = bridge;
        _config = config;
        _timer = new Timer(15000); // Check every 15 seconds
        _timer.Elapsed += (s, e) => CheckIdleState();
        _timer.AutoReset = true;
    }

    public void Start() 
    {
        CheckIdleState(); // Initial check
        _timer.Start();
    }

    private void CheckIdleState()
    {
        var lii = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)) };
        if (GetLastInputInfo(ref lii))
        {
            var idleMs = (uint)Environment.TickCount - lii.dwTime;
            var thresholdMs = _config.GetSettings().IdleThresholdMinutes * 60 * 1000;
            var idle = idleMs >= thresholdMs;

            if (idle != _isIdle)
            {
                _isIdle = idle;
                _bridge.Send("system.idleStateChanged", new { isIdle = _isIdle });
                _bridge.NotifyUiThread();
            }
        }
    }

    public void Dispose() => _timer.Dispose();
}
```

- [ ] **Step 2: Register and dispose the monitor in Program.cs**
  Add as a static field, start in `InitWebView2Async`, and dispose in `WndProc` under `WM_DESTROY`.

```csharp
// In Program.cs
private static SystemIdleMonitor? _idleMonitor;

// In InitWebView2Async
_idleMonitor = new SystemIdleMonitor(_bridge, _appConfigService);
_idleMonitor.Start();

// In WndProc -> WM_DESTROY
_idleMonitor?.Dispose();
```

- [ ] **Step 3: Commit**
```bash
git add src/Brmble.Client/Services/SystemIdleMonitor.cs src/Brmble.Client/Program.cs
git commit -m "feat: add system idle monitor with lifecycle management"
```

---

### Task 2: App Settings Configuration

- [ ] **Step 1: Add IdleThresholdMinutes to C# AppSettings**
  Add the property to `AppSettings.cs` (default: 5).
- [ ] **Step 2: Add setting to React Settings UI**
  Add number input in `SettingsModal.tsx` (General tab).
- [ ] **Step 3: Commit**
```bash
git add src/Brmble.Client/Services/AppConfig/AppSettings.cs src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx
git commit -m "feat: add idle timeout setting"
```

---

### Task 3: Matrix Presence Integration (Optimized)

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Update Matrix presence on bridge event**
  Update self presence in `App.tsx` when `system.idleStateChanged` fires.
- [ ] **Step 2: Optimize Presence Tracking in useMatrixClient**
  Instead of a full Map, use a `Set` containing only the IDs of users who are currently `unavailable`. This minimizes state churn and GC pressure.

```typescript
// In useMatrixClient.ts
const [idleUserIds, setIdleUserIds] = useState<Set<string>>(new Set());

useEffect(() => {
  if (!client) return;
  const onPresence = (event: any, user: any) => {
    if (!user) return;
    setIdleUserIds(prev => {
      const isIdle = user.presence === 'unavailable';
      if (isIdle && !prev.has(user.userId)) {
        const next = new Set(prev);
        next.add(user.userId);
        return next;
      } else if (!isIdle && prev.has(user.userId)) {
        const next = new Set(prev);
        next.delete(user.userId);
        return next;
      }
      return prev;
    });
  };
  client.on("Presence.presence", onPresence);
  return () => { client.off("Presence.presence", onPresence); };
}, [client]);

return { ..., idleUserIds };
```

---

### Task 4: UI Display

- [ ] **Step 1: Show moon icon in ChannelTree**
  Check if `user.matrixUserId` is in `idleUserIds`.
- [ ] **Step 2: Commit**
```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx
git commit -m "feat: display idle status using optimized presence tracking"
```

---

### Task 5: Verification

- [ ] **Step 1: Test with short timeout**
- [ ] **Step 2: Verify lifecycle** (Ensure no multiple timers if app is re-initialized).
- [ ] **Step 3: Verify Matrix sync** (Other clients see the idle icon).
