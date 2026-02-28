# Idle Status Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add idle status detection (voice, Brmble app, Windows system) with configurable display indicators and automatic actions.

**Architecture:** Unified Idle Service — C# backend tracks voice idle (Mumble UserStats polling) and system idle (Win32 GetLastInputInfo), pushes data to frontend via bridge. Frontend tracks Brmble app idle (DOM events), combines all sources, evaluates user-configured thresholds, displays icons, and triggers actions.

**Tech Stack:** C# / Win32 / MumbleSharp (backend), React / TypeScript (frontend), WebView2 bridge (communication)

**Design doc:** `docs/plans/2026-02-28-idle-status-design.md`

---

## Task 1: Add Idle Types to Frontend

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts`

**Step 1: Add idle-related type definitions**

Add after the existing `ConnectionStatus` type (line 46):

```typescript
export type IdleState = 'active' | 'voiceIdle' | 'afk';

export interface IdleActionConfig {
  enabled: boolean;
  delayMinutes: number;
}

export interface IdleSettings {
  voiceIdle: {
    enabled: boolean;
    thresholdMinutes: number;
  };
  brmbleIdle: {
    enabled: boolean;
    thresholdMinutes: number;
    actions: {
      selfMute: IdleActionConfig;
      leaveVoice: IdleActionConfig;
    };
  };
  windowsIdle: {
    enabled: boolean;
    actions: {
      selfMute: IdleActionConfig;
      leaveVoice: IdleActionConfig;
    };
  };
  manualAfk: {
    broadcastToOthers: boolean;
  };
}

export interface IdleUpdate {
  voiceIdle: Record<number, number>; // sessionId -> seconds
  systemIdle: number;                // seconds
}
```

**Step 2: Add idle fields to User interface**

In the existing `User` interface (line 15-26), add:

```typescript
  idleState?: IdleState;
  voiceIdleSecs?: number;
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/types/index.ts
git commit -m "feat(idle): add idle type definitions"
```

---

## Task 2: Create useIdleSettings Hook

**Files:**
- Create: `src/Brmble.Web/src/hooks/useIdleSettings.ts`

**Step 1: Create the settings hook**

Follow the existing localStorage pattern from `App.tsx` (line 22, key `brmble-settings`). Use a dedicated key `brmble-idle-settings`.

```typescript
import { useState, useCallback } from 'react';
import type { IdleSettings } from '../types';

const IDLE_SETTINGS_KEY = 'brmble-idle-settings';

const DEFAULT_IDLE_SETTINGS: IdleSettings = {
  voiceIdle: {
    enabled: true,
    thresholdMinutes: 5,
  },
  brmbleIdle: {
    enabled: true,
    thresholdMinutes: 10,
    actions: {
      selfMute: { enabled: false, delayMinutes: 15 },
      leaveVoice: { enabled: false, delayMinutes: 30 },
    },
  },
  windowsIdle: {
    enabled: false,
    actions: {
      selfMute: { enabled: false, delayMinutes: 10 },
      leaveVoice: { enabled: false, delayMinutes: 20 },
    },
  },
  manualAfk: {
    broadcastToOthers: true,
  },
};

function loadIdleSettings(): IdleSettings {
  try {
    const stored = localStorage.getItem(IDLE_SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_IDLE_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_IDLE_SETTINGS;
}

export function useIdleSettings() {
  const [settings, setSettingsState] = useState<IdleSettings>(loadIdleSettings);

  const updateSettings = useCallback((updates: Partial<IdleSettings>) => {
    setSettingsState(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem(IDLE_SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    localStorage.removeItem(IDLE_SETTINGS_KEY);
    setSettingsState(DEFAULT_IDLE_SETTINGS);
  }, []);

  return { settings, updateSettings, resetSettings, defaults: DEFAULT_IDLE_SETTINGS };
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/hooks/useIdleSettings.ts
git commit -m "feat(idle): add useIdleSettings hook with localStorage persistence"
```

---

## Task 3: Create useBrmbleIdle Hook

**Files:**
- Create: `src/Brmble.Web/src/hooks/useBrmbleIdle.ts`

**Step 1: Create the Brmble app idle tracker**

Tracks DOM events (mousemove, keydown, click, scroll) within the WebView. Returns seconds since last activity.

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'mousedown'] as const;
const UPDATE_INTERVAL_MS = 1000; // update idle seconds every 1s

export function useBrmbleIdle() {
  const lastActivityRef = useRef<number>(Date.now());
  const [idleSecs, setIdleSecs] = useState(0);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIdleSecs(0);
  }, []);

  // Listen for DOM activity events
  useEffect(() => {
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true });
    }

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity);
      }
    };
  }, []);

  // Update idle seconds on interval
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastActivityRef.current) / 1000);
      setIdleSecs(elapsed);
    }, UPDATE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  return { idleSecs, resetActivity };
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/hooks/useBrmbleIdle.ts
git commit -m "feat(idle): add useBrmbleIdle hook for app activity tracking"
```

---

## Task 4: Create C# SystemIdleTracker

**Files:**
- Create: `src/Brmble.Client/Services/Idle/SystemIdleTracker.cs`

**Step 1: Create the Win32 idle tracker**

Uses `GetLastInputInfo` to get system-wide idle time.

```csharp
using System;
using System.Runtime.InteropServices;

namespace Brmble.Client.Services.Idle;

public class SystemIdleTracker
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    public int GetIdleSeconds()
    {
        var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
        if (!GetLastInputInfo(ref info))
            return 0;

        var idleMs = (uint)Environment.TickCount - info.dwTime;
        return (int)(idleMs / 1000);
    }
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Client/Services/Idle/SystemIdleTracker.cs
git commit -m "feat(idle): add SystemIdleTracker using Win32 GetLastInputInfo"
```

---

## Task 5: Create C# VoiceIdleTracker

**Files:**
- Create: `src/Brmble.Client/Services/Idle/IVoiceIdleSource.cs`
- Create: `src/Brmble.Client/Services/Idle/VoiceIdleTracker.cs`

**Step 1: Create the abstraction interface**

This allows swapping polling for server-push later.

```csharp
namespace Brmble.Client.Services.Idle;

public interface IVoiceIdleSource
{
    /// <summary>
    /// Returns a dictionary of sessionId -> idle seconds for all tracked users.
    /// </summary>
    Dictionary<uint, uint> GetVoiceIdleSeconds();
}
```

**Step 2: Create the polling implementation**

Polls `UserStats` for each user in the current channel. Requires access to the MumbleConnection from MumbleAdapter.

Reference: `BasicMumbleProtocol.SendRequestUserStats()` at `lib/MumbleSharp/MumbleSharp/BasicMumbleProtocol.cs:891`

```csharp
using MumbleProto;
using MumbleSharp;

namespace Brmble.Client.Services.Idle;

public class VoiceIdleTracker : IVoiceIdleSource
{
    private readonly Dictionary<uint, uint> _idleSeconds = new();
    private readonly object _lock = new();

    /// <summary>
    /// Called by MumbleAdapter when a UserStats response is received.
    /// </summary>
    public void UpdateUserStats(uint session, uint idleSecs)
    {
        lock (_lock)
        {
            _idleSeconds[session] = idleSecs;
        }
    }

    /// <summary>
    /// Called when a user disconnects, to clean up tracked data.
    /// </summary>
    public void RemoveUser(uint session)
    {
        lock (_lock)
        {
            _idleSeconds.Remove(session);
        }
    }

    public void Clear()
    {
        lock (_lock)
        {
            _idleSeconds.Clear();
        }
    }

    public Dictionary<uint, uint> GetVoiceIdleSeconds()
    {
        lock (_lock)
        {
            return new Dictionary<uint, uint>(_idleSeconds);
        }
    }
}
```

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Idle/IVoiceIdleSource.cs
git add src/Brmble.Client/Services/Idle/VoiceIdleTracker.cs
git commit -m "feat(idle): add VoiceIdleTracker with IVoiceIdleSource abstraction"
```

---

## Task 6: Create C# IdleService

**Files:**
- Create: `src/Brmble.Client/Services/Idle/IdleService.cs`
- Modify: `src/Brmble.Client/Program.cs` (register service, ~line 141)

**Step 1: Create the IdleService**

Implements `IService` (see `src/Brmble.Client/Bridge/IService.cs`). Manages both trackers and pushes `voice.idleUpdate` to the frontend on a timer.

```csharp
using System.Text.Json;
using Brmble.Client.Bridge;

namespace Brmble.Client.Services.Idle;

public class IdleService : IService
{
    public string ServiceName => "idle";

    private NativeBridge? _bridge;
    private readonly VoiceIdleTracker _voiceTracker = new();
    private readonly SystemIdleTracker _systemTracker = new();
    private System.Threading.Timer? _pushTimer;

    private const int PUSH_INTERVAL_MS = 10_000; // push every 10 seconds

    public VoiceIdleTracker VoiceTracker => _voiceTracker;

    public void Initialize(NativeBridge bridge)
    {
        _bridge = bridge;
    }

    public void RegisterHandlers(NativeBridge bridge)
    {
        // voice.setAfkStatus handler for future broadcasting
        bridge.On("voice.setAfkStatus", data =>
        {
            // TODO: broadcast to other users when server supports it
        });
    }

    public void Start()
    {
        _pushTimer = new System.Threading.Timer(_ => PushIdleUpdate(), null, PUSH_INTERVAL_MS, PUSH_INTERVAL_MS);
    }

    public void Stop()
    {
        _pushTimer?.Dispose();
        _pushTimer = null;
        _voiceTracker.Clear();
    }

    private void PushIdleUpdate()
    {
        if (_bridge == null) return;

        var voiceIdle = _voiceTracker.GetVoiceIdleSeconds();
        var systemIdle = _systemTracker.GetIdleSeconds();

        var payload = new
        {
            voiceIdle = voiceIdle,
            systemIdle = systemIdle
        };

        _bridge.Send("voice.idleUpdate", payload);
    }
}
```

**Step 2: Register in Program.cs**

In `src/Brmble.Client/Program.cs`, after the MumbleAdapter creation (~line 141), add:

```csharp
_idleService = new IdleService();
_idleService.Initialize(_bridge);
_idleService.RegisterHandlers(_bridge);
```

And pass the `VoiceTracker` to MumbleAdapter so it can feed UserStats data.

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Idle/IdleService.cs
git add src/Brmble.Client/Program.cs
git commit -m "feat(idle): add IdleService with push timer and register in Program.cs"
```

---

## Task 7: Wire MumbleAdapter to VoiceIdleTracker

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Add UserStats polling**

MumbleAdapter needs to:
1. Accept a reference to `VoiceIdleTracker`
2. Override `UserStats()` to feed received data into the tracker (ref: `BasicMumbleProtocol.cs:883`)
3. Periodically call `SendRequestUserStats()` for each user in the current channel (ref: `BasicMumbleProtocol.cs:891`)
4. Clean up user data on disconnect/leave

**Key integration points:**
- Constructor: accept `VoiceIdleTracker` parameter
- `UserStats()` override (~after line 1241): call `_voiceTracker.UpdateUserStats(session, idleSecs)`
- `UserRemoved()` override: call `_voiceTracker.RemoveUser(session)`
- New polling timer: iterate connected users, call `SendRequestUserStats()` for each
- `Disconnect()`: call `_voiceTracker.Clear()`

**Step 2: Add polling timer for UserStats requests**

Add a timer that fires every 30 seconds, iterates users in the current channel, and sends `UserStats` requests to the Mumble server for each.

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat(idle): wire MumbleAdapter to VoiceIdleTracker with UserStats polling"
```

---

## Task 8: Create useIdleStatus Hook

**Files:**
- Create: `src/Brmble.Web/src/hooks/useIdleStatus.ts`

**Step 1: Create the combined idle status hook**

Combines all three idle sources, evaluates thresholds, determines display state.

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import bridge from '../bridge';
import type { IdleState, IdleSettings, IdleUpdate } from '../types';

interface UseIdleStatusProps {
  settings: IdleSettings;
  brmbleIdleSecs: number;
  localUserSession: number | null;
  manualAfk: boolean;
}

interface UserIdleInfo {
  state: IdleState;
  voiceIdleSecs: number;
}

export function useIdleStatus({ settings, brmbleIdleSecs, localUserSession, manualAfk }: UseIdleStatusProps) {
  const [voiceIdleMap, setVoiceIdleMap] = useState<Record<number, number>>({});
  const [systemIdleSecs, setSystemIdleSecs] = useState(0);

  // Listen for idle updates from C#
  useEffect(() => {
    const handler = (data: IdleUpdate) => {
      setVoiceIdleMap(data.voiceIdle);
      setSystemIdleSecs(data.systemIdle);
    };
    bridge.on('voice.idleUpdate', handler);
    return () => bridge.off('voice.idleUpdate', handler);
  }, []);

  // Determine idle state for a given user
  const getUserIdleState = useCallback((session: number): UserIdleInfo => {
    const voiceIdleSecs = voiceIdleMap[session] ?? 0;
    const isLocalUser = session === localUserSession;

    // Manual AFK overrides everything (local user only)
    if (isLocalUser && manualAfk) {
      return { state: 'afk', voiceIdleSecs };
    }

    // Brmble idle check (local user only — highest display priority)
    if (isLocalUser && settings.brmbleIdle.enabled) {
      if (brmbleIdleSecs >= settings.brmbleIdle.thresholdMinutes * 60) {
        return { state: 'afk', voiceIdleSecs };
      }
    }

    // Voice idle check (all users)
    if (settings.voiceIdle.enabled) {
      if (voiceIdleSecs >= settings.voiceIdle.thresholdMinutes * 60) {
        return { state: 'voiceIdle', voiceIdleSecs };
      }
    }

    return { state: 'active', voiceIdleSecs };
  }, [voiceIdleMap, localUserSession, manualAfk, brmbleIdleSecs, settings]);

  return { getUserIdleState, systemIdleSecs, voiceIdleMap };
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/hooks/useIdleStatus.ts
git commit -m "feat(idle): add useIdleStatus hook combining all idle sources"
```

---

## Task 9: Create useIdleActions Hook

**Files:**
- Create: `src/Brmble.Web/src/hooks/useIdleActions.ts`

**Step 1: Create the action trigger hook**

Evaluates Brmble idle and Windows idle timers against action thresholds, triggers self-mute or leave-voice via existing bridge messages.

```typescript
import { useEffect, useRef } from 'react';
import bridge from '../bridge';
import type { IdleSettings } from '../types';

interface UseIdleActionsProps {
  settings: IdleSettings;
  brmbleIdleSecs: number;
  systemIdleSecs: number;
  selfMuted: boolean;
  selfLeftVoice: boolean;
  isConnected: boolean;
}

export function useIdleActions({
  settings,
  brmbleIdleSecs,
  systemIdleSecs,
  selfMuted,
  selfLeftVoice,
  isConnected,
}: UseIdleActionsProps) {
  // Track which actions have already fired to avoid re-triggering
  const firedActionsRef = useRef<Set<string>>(new Set());

  // Reset fired actions when user becomes active again
  useEffect(() => {
    if (brmbleIdleSecs === 0) {
      firedActionsRef.current.clear();
    }
  }, [brmbleIdleSecs]);

  useEffect(() => {
    if (!isConnected) return;

    const fired = firedActionsRef.current;

    // Brmble idle actions
    if (settings.brmbleIdle.enabled) {
      const { selfMute, leaveVoice } = settings.brmbleIdle.actions;

      if (selfMute.enabled && !selfMuted && !fired.has('brmble-mute')) {
        if (brmbleIdleSecs >= selfMute.delayMinutes * 60) {
          bridge.send('voice.toggleMute', {});
          fired.add('brmble-mute');
        }
      }

      if (leaveVoice.enabled && !selfLeftVoice && !fired.has('brmble-leave')) {
        if (brmbleIdleSecs >= leaveVoice.delayMinutes * 60) {
          bridge.send('voice.leaveVoice', {});
          fired.add('brmble-leave');
        }
      }
    }

    // Windows idle actions
    if (settings.windowsIdle.enabled) {
      const { selfMute, leaveVoice } = settings.windowsIdle.actions;

      if (selfMute.enabled && !selfMuted && !fired.has('windows-mute')) {
        if (systemIdleSecs >= selfMute.delayMinutes * 60) {
          bridge.send('voice.toggleMute', {});
          fired.add('windows-mute');
        }
      }

      if (leaveVoice.enabled && !selfLeftVoice && !fired.has('windows-leave')) {
        if (systemIdleSecs >= leaveVoice.delayMinutes * 60) {
          bridge.send('voice.leaveVoice', {});
          fired.add('windows-leave');
        }
      }
    }
  }, [settings, brmbleIdleSecs, systemIdleSecs, selfMuted, selfLeftVoice, isConnected]);
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/hooks/useIdleActions.ts
git commit -m "feat(idle): add useIdleActions hook for threshold-based auto-actions"
```

---

## Task 10: Add Idle Icons to User List

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx` (~lines 192-223)
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx` (~lines 139-171)

**Step 1: Add idle icon rendering**

In both components where user rows are rendered, add an idle state icon after the user name:
- `voiceIdle` state → Zzz icon (small, muted color)
- `afk` state → AFK badge/icon
- `active` state → no icon

The idle state will be passed down as a prop from App.tsx (which has the `getUserIdleState` function from `useIdleStatus`).

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx
git add src/Brmble.Web/src/components/Sidebar/Sidebar.tsx
git commit -m "feat(idle): display Zzz and AFK icons in user list"
```

---

## Task 11: Wire Everything Together in App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Add idle hooks and manual AFK toggle**

In `App.tsx` (~after line 76 where existing state is declared):
1. Import and use `useIdleSettings()`
2. Import and use `useBrmbleIdle()`
3. Add `manualAfk` state with `useState(false)`
4. Import and use `useIdleStatus()` with the above inputs
5. Import and use `useIdleActions()` with settings + idle data + existing selfMuted/selfLeftVoice state
6. Add a `handleToggleAfk` function
7. Pass `getUserIdleState` down to Sidebar and ChannelTree components
8. Reset Brmble idle and manual AFK on reconnect

**Step 2: Add manual AFK toggle to UI**

Add an AFK toggle button near the existing mute/deafen/leave-voice controls (~line 760-768 where `handleToggleMute` etc. are defined).

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat(idle): wire idle hooks into App.tsx with manual AFK toggle"
```

---

## Task 12: Add Idle Settings to Settings Modal

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`

**Step 1: Add idle settings section**

Add a new section in the settings modal for idle configuration:
- Voice Idle: enable/disable, threshold (minutes)
- Brmble Idle: enable/disable, threshold (minutes), self-mute delay, leave-voice delay
- Windows Idle: enable/disable (opt-in), self-mute delay, leave-voice delay
- Broadcasting: opt-out toggle (disabled/greyed until server supports it)

Follow the existing settings modal patterns for input controls and layout.

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx
git commit -m "feat(idle): add idle settings section to settings modal"
```

---

## Task 13: Start/Stop IdleService on Connection

**Files:**
- Modify: `src/Brmble.Client/Services/Idle/IdleService.cs`
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Start IdleService when voice connects, stop on disconnect**

In MumbleAdapter:
- On successful connection (in `ServerConnected` or similar): call `_idleService.Start()`
- On disconnect: call `_idleService.Stop()`

This ensures we only poll and push idle data while actually connected to a Mumble server.

**Step 2: Commit**

```bash
git add src/Brmble.Client/Services/Idle/IdleService.cs
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat(idle): start/stop idle tracking on voice connect/disconnect"
```

---

## Task 14: Testing and Verification

**Step 1: Build backend**

```bash
dotnet build
```

Expected: Build succeeds with no new errors.

**Step 2: Build frontend**

```bash
cd src/Brmble.Web && npm run build
```

Expected: Build succeeds with no TypeScript errors.

**Step 3: Run existing tests**

```bash
dotnet test
```

Expected: All existing tests pass (idle feature doesn't break anything).

**Step 4: Manual testing checklist**

- [ ] Connect to Mumble server, verify `voice.idleUpdate` messages arrive in frontend (browser dev tools)
- [ ] Stop speaking for >5 minutes, verify Zzz icon appears next to your name
- [ ] Stop interacting with Brmble for >10 minutes, verify AFK icon replaces Zzz
- [ ] Click manual AFK toggle, verify AFK icon appears immediately
- [ ] Un-toggle manual AFK, verify icon clears
- [ ] Configure Brmble idle self-mute action, verify it triggers after delay
- [ ] Configure Windows idle leave-voice action, lock screen, verify it triggers
- [ ] Verify settings persist across app restart (localStorage)
- [ ] Verify idle tracking stops on disconnect and resumes on reconnect

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(idle): address issues found during testing"
```
