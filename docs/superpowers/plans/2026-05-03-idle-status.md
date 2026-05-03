# Idle Status — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development for parallel work) to implement this plan task-by-task.

**Issue:** [#61 — feat: show idle status for users after inactivity](https://github.com/brmble/brmble/issues/61)
**Research:** `docs/research/2026-05-03-idle-status-research.md` (read this first — it explains *why* the design looks like this)
**Supersedes:** `docs/plans/2026-02-28-idle-status-design.md` + `2026-02-28-idle-status-implementation.md` on branch `docs/idle-status-design` (feb plan was scoped much wider; many tasks from it are intentionally dropped)

**Goal:** Show a moon icon next to Mumble users who have been voice-idle for >10 min, and auto-leave-voice when the local user is fully idle (Brmble + Windows) for >10 min or when the workstation is locked. No settings UI in v1.

**Architecture:** C# `IdleService` polls Mumble `UserStats` for rendered users + tracks Win32 `GetLastInputInfo` and lock-state, pushes to the frontend via `voice.idleUpdate`. Frontend tracks DOM activity (with voice-transmit ping), combines sources, fires `voice.leaveVoice` when fully idle, and renders the moon icon + tooltip.

**Tech Stack:** C# 12 / .NET 10 / Win32 (backend), React + TypeScript (frontend), WebView2 bridge.

**Conventions:**
- All commits on branch `feature/idle-status` (already created).
- Tests use **MSTest** (per project memory).
- All UI strings + GitHub issue/PR text in English; Dutch is fine in inline conversation, not in code.
- Icons via `<Icon name="moon" />`, never inline SVG.
- Logs from C# WinExe must use `%TEMP%/brmble-tls.log` pattern (see project memory).

---

## Task 1: Add `moon` icon

**Files:**
- Modify: `src/Brmble.Web/src/components/Icon/Icon.tsx`
- Modify: `docs/UI_GUIDE.md` (icon table, section 11)

- [ ] **Step 1**: In `Icon.tsx`, find the appropriate category section (likely under a "Status" or "Misc" group — match the existing structure). Add the Lucide `moon` icon path:

  ```tsx
  'moon': {
    paths: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  },
  ```

- [ ] **Step 2**: Add a row to the icon table in `docs/UI_GUIDE.md` § 11 — `moon` — "Idle / AFK indicator next to user names and on the tray".

- [ ] **Step 3**: Verify with `cd src/Brmble.Web && npm run build` that there are no TypeScript errors.

- [ ] **Step 4**: Commit:
  ```bash
  git add src/Brmble.Web/src/components/Icon/Icon.tsx docs/UI_GUIDE.md
  git commit -m "feat(icons): add moon icon for idle status"
  ```

---

## Task 2: Add idle fields to frontend types

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts`

- [ ] **Step 1**: In the existing `User` interface, add an optional field:

  ```typescript
  /** Seconds since this user last spoke or sent a control message (Mumble UserStats.idlesecs). */
  voiceIdleSecs?: number;
  ```

- [ ] **Step 2**: Add a new exported type for the bridge payload:

  ```typescript
  export interface IdleUpdate {
    /** sessionId → idle seconds (server-tracked Mumble idlesecs) */
    voiceIdle: Record<number, number>;
    /** Local Windows system idle in seconds (GetLastInputInfo). */
    systemIdle: number;
    /** True when the workstation is locked (WTS_SESSION_LOCK active). */
    isLocked: boolean;
  }
  ```

- [ ] **Step 3**: Commit:
  ```bash
  git add src/Brmble.Web/src/types/index.ts
  git commit -m "feat(idle): add voiceIdleSecs to User and IdleUpdate type"
  ```

---

## Task 3: SystemIdleTracker (Win32)

**Files:**
- Create: `src/Brmble.Client/Services/Idle/SystemIdleTracker.cs`

- [ ] **Step 1**: Create the file. Implementation notes:
  - `GetLastInputInfo` via P/Invoke. Returns `LASTINPUTINFO { uint cbSize, uint dwTime }`.
  - **Wraparound-safe** subtraction: `unchecked((uint)Environment.TickCount - lii.dwTime)`. Do **not** use `Environment.TickCount64` here — `dwTime` is the low 32 bits, mismatched widths give garbage after ~49.7 days uptime.
  - Subscribe to `WM_WTSSESSION_CHANGE` via `WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION)`. The notification arrives on the message-pump window; we'll plumb it through a public `OnSessionChange(int wParam)` method that the Win32 message loop calls.
  - States to track: `WTS_SESSION_LOCK = 0x7`, `WTS_SESSION_UNLOCK = 0x8`, `WTS_CONSOLE_DISCONNECT = 0x4`, `WTS_CONSOLE_CONNECT = 0x3`. Treat lock + console-disconnect as "locked".
  - Public surface:
    ```csharp
    int GetIdleSeconds();   // wraparound-safe
    bool IsLocked { get; }
    void OnSessionChange(int wParam);  // called from Win32Window message loop
    void Dispose();         // WTSUnRegisterSessionNotification
    ```

- [ ] **Step 2**: Wire `WTSRegisterSessionNotification` from the constructor. Take an `IntPtr hwnd` parameter. The hwnd comes from `Win32Window` once it's created — IdleService passes it in.

- [ ] **Step 3**: Add MSTest unit test `tests/Brmble.Client.Tests/Services/Idle/SystemIdleTrackerTests.cs`:
  - `GetIdleSeconds_ReturnsNonNegative`
  - `IsLocked_DefaultsToFalse`
  - `OnSessionChange_WtsSessionLock_SetsIsLockedTrue`
  - `OnSessionChange_WtsSessionUnlock_SetsIsLockedFalse`

- [ ] **Step 4**: Verify with `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`.

- [ ] **Step 5**: Commit:
  ```bash
  git add src/Brmble.Client/Services/Idle/ tests/Brmble.Client.Tests/Services/Idle/
  git commit -m "feat(idle): add SystemIdleTracker with GetLastInputInfo and lock detection"
  ```

---

## Task 4: VoiceIdleTracker (state holder)

**Files:**
- Create: `src/Brmble.Client/Services/Idle/VoiceIdleTracker.cs`

- [ ] **Step 1**: Pure in-memory state holder for `{ sessionId → (idleSecs, fetchedAt) }`. Public surface:
  ```csharp
  void UpdateUserStats(uint session, uint idleSecs);  // called from MumbleAdapter.UserStats override
  void RemoveUser(uint session);                       // called on user-leave
  void Clear();                                         // called on disconnect
  Dictionary<uint, uint> GetCurrent();                  // snapshot for IdleService push
  ```
- [ ] **Step 2**: Thread-safe via `lock` (MumbleAdapter callbacks come from the network thread).
- [ ] **Step 3**: MSTest `tests/Brmble.Client.Tests/Services/Idle/VoiceIdleTrackerTests.cs` covering Update/Remove/Clear/Get.
- [ ] **Step 4**: Commit:
  ```bash
  git add src/Brmble.Client/Services/Idle/VoiceIdleTracker.cs tests/Brmble.Client.Tests/Services/Idle/VoiceIdleTrackerTests.cs
  git commit -m "feat(idle): add VoiceIdleTracker thread-safe state holder"
  ```

---

## Task 5: MumbleAdapter — UserStats receive + polling timer

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

- [ ] **Step 1**: Constructor — accept an optional `VoiceIdleTracker?` parameter (default null so existing tests don't break). Store as `_voiceIdleTracker`.

- [ ] **Step 2**: Override `BasicMumbleProtocol.UserStats(UserStats)`:
  ```csharp
  protected override void UserStats(UserStats userStats)
  {
      base.UserStats(userStats);
      if (userStats?.SessionSpecified == true && userStats.IdlesecsSpecified)
      {
          _voiceIdleTracker?.UpdateUserStats(userStats.Session, userStats.Idlesecs);
      }
  }
  ```
  Verify the exact field-presence accessors against `lib/MumbleSharp/MumbleSharp/Packets/Mumble.cs` — protobuf-net generates `*Specified` properties for `optional` fields.

- [ ] **Step 3**: Add a polling timer. Fires every **30 seconds** while connected. Behavior:
  - Snapshot all currently-known user sessions (from `Users` collection).
  - If empty (alone in lobby + no other sessions visible): skip this tick.
  - If ≤30 sessions: send a `UserStats` request for each (`stats_only = true`).
  - If >30: round-robin — send 30 per tick, remember offset for next tick.
  - Use `SendRequestUserStats(new UserStats { Session = s, StatsOnly = true })`.
  - Log to `%TEMP%/brmble-tls.log` only on failure (don't spam the per-tick happy path).

- [ ] **Step 4**: On user disconnect (`UserLeft` / similar — search for the existing handler around `MumbleAdapter.cs:319`/connection lifecycle), call `_voiceIdleTracker?.RemoveUser(session)`.

- [ ] **Step 5**: On disconnect/cleanup, call `_voiceIdleTracker?.Clear()` and stop the timer.

- [ ] **Step 6**: Build: `dotnet build`. Verify no test regressions: `dotnet test`.

- [ ] **Step 7**: Commit:
  ```bash
  git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
  git commit -m "feat(idle): wire MumbleAdapter to VoiceIdleTracker with UserStats polling"
  ```

---

## Task 6: MumbleAdapter — local transmit → bridge ping

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

- [ ] **Step 1**: Find the existing local-user speaking detection (the speaking indicator path; search for `speaking` or `IsTransmitting` near the audio capture wiring). When local-user speaking transitions to *true*, send a bridge message:
  ```csharp
  _bridge?.Send("voice.localTransmit", new { });
  ```
  Throttle to at most once per 5 seconds — we only need it to reset Brmble idle, not stream.

- [ ] **Step 2**: Build + test. Commit:
  ```bash
  git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
  git commit -m "feat(idle): emit voice.localTransmit ping for app-idle reset"
  ```

---

## Task 7: IdleService

**Files:**
- Create: `src/Brmble.Client/Services/Idle/IdleService.cs`
- Modify: `src/Brmble.Client/Bridge/IService.cs` (only if a new event type is needed — likely not)

- [ ] **Step 1**: Implement `IService` (pattern from existing services in `src/Brmble.Client/Services/`). Public surface:
  ```csharp
  string ServiceName => "idle";
  void Initialize(NativeBridge bridge);
  void RegisterHandlers(NativeBridge bridge);
  void Start();    // begin push timer
  void Stop();     // dispose timer, clear voice tracker

  VoiceIdleTracker VoiceTracker { get; }   // exposed so MumbleAdapter can be wired
  event Action? AfkTriggered;               // raised when Program.cs should fire LeaveVoice
  ```

- [ ] **Step 2**: Holds:
  - `VoiceIdleTracker _voiceTracker` (constructed internally)
  - `SystemIdleTracker _systemTracker` (constructed when hwnd available; receive from Initialize-with-hwnd or set later)
  - `Timer _pushTimer` — every **10 s**, push `voice.idleUpdate` to JS
  - Threshold constant: `private const int AFK_THRESHOLD_SECONDS = 600;`

- [ ] **Step 3**: Push timer body:
  ```csharp
  var voiceIdle = _voiceTracker.GetCurrent();
  var sysIdle   = _systemTracker.GetIdleSeconds();
  var locked    = _systemTracker.IsLocked;

  _bridge.Send("voice.idleUpdate", new {
      voiceIdle,
      systemIdle = sysIdle,
      isLocked   = locked,
  });
  ```
  Note: the actual AFK trigger fires from the *frontend* (`useIdleActions`), not here. C# only pushes data and exposes the LeaveVoice plumbing. Keeping the decision in JS keeps the logic in one place and lets us verify with React testing later.

- [ ] **Step 4**: Test `tests/Brmble.Client.Tests/Services/Idle/IdleServiceTests.cs`:
  - `Push_SendsVoiceIdleUpdate`
  - `Stop_DisposesTimer`

- [ ] **Step 5**: Commit:
  ```bash
  git add src/Brmble.Client/Services/Idle/IdleService.cs tests/Brmble.Client.Tests/Services/Idle/IdleServiceTests.cs
  git commit -m "feat(idle): add IdleService with periodic voice.idleUpdate push"
  ```

---

## Task 8: Program.cs — register IdleService and wire MumbleAdapter

**Files:**
- Modify: `src/Brmble.Client/Program.cs`
- Modify: `src/Brmble.Client/Win32Window.cs` (forward WM_WTSSESSION_CHANGE)

- [ ] **Step 1**: After MumbleAdapter is constructed, create `IdleService` and pass `idleService.VoiceTracker` into MumbleAdapter (revisit Task 5's constructor — may need to construct adapter *after* idleService).

- [ ] **Step 2**: Call `idleService.Initialize(bridge)` and `idleService.RegisterHandlers(bridge)` following the existing service-registration pattern.

- [ ] **Step 3**: Once the Win32 window hwnd is available, pass it to IdleService so it can construct SystemIdleTracker (which calls `WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION)`).

- [ ] **Step 4**: In `Win32Window.cs`'s WndProc, add a case for `WM_WTSSESSION_CHANGE = 0x02B1` that forwards to `IdleService.SystemTracker.OnSessionChange((int)wParam)`.

- [ ] **Step 5**: On voice connect (search for the existing connect handler), call `idleService.Start()`. On disconnect, call `idleService.Stop()`.

- [ ] **Step 6**: Wire `idleService.AfkTriggered += () => mumbleAdapter.LeaveVoice();` after both are constructed.

- [ ] **Step 7**: Build + run + test the app: connect to a Mumble server, observe `voice.idleUpdate` messages arriving in the WebView dev console.

- [ ] **Step 8**: Commit:
  ```bash
  git add src/Brmble.Client/Program.cs src/Brmble.Client/Win32Window.cs
  git commit -m "feat(idle): register IdleService and wire WTS session notifications"
  ```

---

## Task 9: useBrmbleIdle hook

**Files:**
- Create: `src/Brmble.Web/src/hooks/useBrmbleIdle.ts`
- Create: `src/Brmble.Web/src/hooks/useBrmbleIdle.test.ts`

- [ ] **Step 1**: Hook tracks DOM activity events + the `voice.localTransmit` bridge message. **Critical**: store `lastActivityTs = Date.now()` on each event and compute `idleSecs = (Date.now() - lastActivityTs) / 1000` on each interval tick. Do **not** increment a counter — WebView2 throttles `setInterval` to ≥1 Hz when the window is hidden, which would under-count.

  ```typescript
  import { useState, useEffect, useRef } from 'react';
  import bridge from '../bridge';

  const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'mousedown', 'wheel', 'touchstart', 'pointerdown'] as const;
  const TICK_MS = 1000;

  export function useBrmbleIdle() {
    const lastActivityRef = useRef<number>(Date.now());
    const [idleSecs, setIdleSecs] = useState(0);

    useEffect(() => {
      const reset = () => { lastActivityRef.current = Date.now(); };
      for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, reset, { passive: true });

      const transmitHandler = () => { lastActivityRef.current = Date.now(); };
      bridge.on('voice.localTransmit', transmitHandler);

      const interval = window.setInterval(() => {
        setIdleSecs(Math.floor((Date.now() - lastActivityRef.current) / 1000));
      }, TICK_MS);

      return () => {
        for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, reset);
        bridge.off('voice.localTransmit', transmitHandler);
        clearInterval(interval);
      };
    }, []);

    return idleSecs;
  }
  ```

- [ ] **Step 2**: Test using fake timers: trigger an event, advance time, assert idleSecs is 0; advance more, assert it climbs.

- [ ] **Step 3**: Commit:
  ```bash
  git add src/Brmble.Web/src/hooks/useBrmbleIdle.ts src/Brmble.Web/src/hooks/useBrmbleIdle.test.ts
  git commit -m "feat(idle): add useBrmbleIdle DOM-activity hook with voice transmit reset"
  ```

---

## Task 10: useIdleStatus hook (subscribe to bridge)

**Files:**
- Create: `src/Brmble.Web/src/hooks/useIdleStatus.ts`
- Create: `src/Brmble.Web/src/hooks/useIdleStatus.test.ts`

- [ ] **Step 1**: Subscribes to `voice.idleUpdate` and exposes:
  ```typescript
  export function useIdleStatus() {
    const [voiceIdle, setVoiceIdle] = useState<Record<number, number>>({});
    const [systemIdle, setSystemIdle] = useState(0);
    const [isLocked, setIsLocked] = useState(false);

    useEffect(() => {
      const handler = (data: IdleUpdate) => {
        setVoiceIdle(data.voiceIdle ?? {});
        setSystemIdle(data.systemIdle ?? 0);
        setIsLocked(data.isLocked ?? false);
      };
      bridge.on('voice.idleUpdate', handler);
      return () => bridge.off('voice.idleUpdate', handler);
    }, []);

    return { voiceIdle, systemIdle, isLocked };
  }
  ```

- [ ] **Step 2**: Test with mocked bridge.

- [ ] **Step 3**: Commit:
  ```bash
  git add src/Brmble.Web/src/hooks/useIdleStatus.ts src/Brmble.Web/src/hooks/useIdleStatus.test.ts
  git commit -m "feat(idle): add useIdleStatus hook for bridge updates"
  ```

---

## Task 11: useIdleActions — auto-leave + toast

**Files:**
- Create: `src/Brmble.Web/src/hooks/useIdleActions.ts`
- Create: `src/Brmble.Web/src/hooks/useIdleActions.test.ts`

- [ ] **Step 1**: Combines all sources, fires `voice.leaveVoice` when AFK while in voice. Returns a "show toast?" flag for App.tsx to render.

  ```typescript
  const AFK_THRESHOLD_SEC = 10 * 60;

  interface UseIdleActionsArgs {
    brmbleIdleSec: number;
    systemIdleSec: number;
    isLocked: boolean;
    inVoiceChannel: boolean;
  }

  export function useIdleActions({ brmbleIdleSec, systemIdleSec, isLocked, inVoiceChannel }: UseIdleActionsArgs) {
    const firedRef = useRef(false);
    const [autoLeftAt, setAutoLeftAt] = useState<number | null>(null);

    useEffect(() => {
      if (!inVoiceChannel) { firedRef.current = false; return; }

      const fullyIdle = isLocked
        || (brmbleIdleSec >= AFK_THRESHOLD_SEC && systemIdleSec >= AFK_THRESHOLD_SEC);

      if (fullyIdle && !firedRef.current) {
        firedRef.current = true;
        bridge.send('voice.leaveVoice', {});
        setAutoLeftAt(Date.now());
      }

      if (brmbleIdleSec === 0 && firedRef.current) {
        // user is back; ready for next cycle (toast itself is dismissed by user)
        firedRef.current = false;
      }
    }, [brmbleIdleSec, systemIdleSec, isLocked, inVoiceChannel]);

    return { autoLeftAt, dismissToast: () => setAutoLeftAt(null) };
  }
  ```

- [ ] **Step 2**: Test: gamer scenario (system idle 700, brmble idle 30) → no fire. Locked → fire immediately. Both idle past threshold → fire once.

- [ ] **Step 3**: Commit:
  ```bash
  git add src/Brmble.Web/src/hooks/useIdleActions.ts src/Brmble.Web/src/hooks/useIdleActions.test.ts
  git commit -m "feat(idle): add useIdleActions with AND-combined trigger"
  ```

---

## Task 12: Render moon icon + tooltip in user rows

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx` (~line 342, in `user-status-area`)
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx` (root-users render path)
- Modify: tests for both
- Create or modify: `src/Brmble.Web/src/utils/formatIdleDuration.ts` (small pure helper)

- [ ] **Step 1**: Helper `formatIdleDuration(seconds: number): string`:
  - `< 60` → "AFK voor <1 min"
  - `< 60 * 60` → `AFK voor ${Math.floor(s/60)} min`
  - `< 24 * 60 * 60` → `AFK voor ${h}u ${m}m`
  - else → `AFK voor ${days} ${days === 1 ? 'dag' : 'dagen'}`

  Add a unit test `formatIdleDuration.test.ts` with all four ranges.

- [ ] **Step 2**: Pass `voiceIdleSecs` down through props from `App.tsx → Sidebar → ChannelTree`. Source is the `voiceIdle` map from `useIdleStatus` looked up by `user.session`.

- [ ] **Step 3**: In `ChannelTree.tsx` `user-status-area` (around line 342–349) add the moon row, only when `user.voiceIdleSecs && user.voiceIdleSecs > 600`:

  ```tsx
  {user.voiceIdleSecs !== undefined && user.voiceIdleSecs > 600 && (
    <Tooltip content={formatIdleDuration(user.voiceIdleSecs)}>
      <Icon name="moon" size={11} className="user-status-icon user-status-icon--idle" strokeWidth={2.5} />
    </Tooltip>
  )}
  ```

- [ ] **Step 4**: Same render block in `Sidebar.tsx` for root users.

- [ ] **Step 5**: Add CSS class `.user-status-icon--idle` if needed (same style family as `--muted` / `--deaf`).

- [ ] **Step 6**: Update / add tests in `ChannelTree.test.tsx` and `Sidebar.test.tsx`: assert moon renders when `voiceIdleSecs > 600`, doesn't render when ≤600.

- [ ] **Step 7**: Commit:
  ```bash
  git add src/Brmble.Web/src/utils/formatIdleDuration.ts src/Brmble.Web/src/utils/formatIdleDuration.test.ts \
          src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx \
          src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx
  git commit -m "feat(idle): render moon icon with elapsed-time tooltip on idle users"
  ```

---

## Task 13: Wire it all in App.tsx + auto-kick toast

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1**: Import and call `useBrmbleIdle()`, `useIdleStatus()`, `useIdleActions()` in `App`. Wire:
  ```typescript
  const brmbleIdleSec = useBrmbleIdle();
  const { voiceIdle, systemIdle, isLocked } = useIdleStatus();
  const { autoLeftAt, dismissToast } = useIdleActions({
    brmbleIdleSec,
    systemIdleSec: systemIdle,
    isLocked,
    inVoiceChannel: currentChannelId !== undefined && currentChannelId !== null,
  });
  ```

- [ ] **Step 2**: Pass `voiceIdle` (the map) down into `Sidebar` and merge into the user objects (or pass the map and let ChannelTree look it up — pick whichever matches existing prop patterns there).

- [ ] **Step 3**: When `autoLeftAt !== null`, register a `<Notification>` via `useNotificationQueue` with id `idle-auto-leave`, status `info`, message: "Je bent uit voice gehaald na 10 minuten inactiviteit." Provide a dismiss action calling `dismissToast()`.

- [ ] **Step 4**: Manual test:
  - Connect to a Mumble server, join a channel.
  - Wait or simulate ~10 min by temporarily lowering the constant; verify auto-leave fires once and toast appears.
  - Have a second user be silent; verify their moon icon appears (after ≤30 s + 10 min idle).
  - Lock the workstation; verify auto-leave is immediate.

- [ ] **Step 5**: Build front + back, run tests:
  ```bash
  cd src/Brmble.Web && npm run build
  dotnet test
  ```

- [ ] **Step 6**: Commit:
  ```bash
  git add src/Brmble.Web/src/App.tsx
  git commit -m "feat(idle): wire idle hooks in App.tsx with auto-leave toast"
  ```

---

## Task 14 (optional): Tray icon moon overlay

> Skip if no idle .ico asset is available — the feature works without it. Add a follow-up issue if so.

**Files:**
- Add: `src/Brmble.Client/Resources/brmble-idle.ico` (asset — moon overlay variant of brmble.ico)
- Modify: `src/Brmble.Client/TrayIcon.cs`
- Modify: `src/Brmble.Client/Brmble.Client.csproj` (embed the new .ico if needed)
- Modify: `src/Brmble.Client/Services/Idle/IdleService.cs` (raise `IdleStateChanged(bool isIdle)` event)

- [ ] **Step 1**: Create or commission `brmble-idle.ico` — same base as brmble.ico with a small moon glyph overlaid bottom-right.

- [ ] **Step 2**: In `TrayIcon.cs`, add `SetIdleOverlay(bool isIdle)` that loads the appropriate icon and calls `Shell_NotifyIcon(NIM_MODIFY)` with `NIF_ICON`.

- [ ] **Step 3**: In `IdleService`, raise an event when (`systemIdleSec ≥ AFK_THRESHOLD_SECONDS || isLocked`) transitions. Wire in Program.cs to `TrayIcon.SetIdleOverlay`.

- [ ] **Step 4**: Manual test: lock workstation, observe tray overlay change.

- [ ] **Step 5**: Commit:
  ```bash
  git add src/Brmble.Client/Resources/brmble-idle.ico src/Brmble.Client/TrayIcon.cs \
          src/Brmble.Client/Brmble.Client.csproj src/Brmble.Client/Services/Idle/IdleService.cs
  git commit -m "feat(idle): add tray icon moon overlay on system idle/lock"
  ```

---

## Task 15: Verification & PR

- [ ] **Step 1**: Full build + test:
  ```bash
  dotnet build
  cd src/Brmble.Web && npm run build && cd ../..
  dotnet test
  ```

- [ ] **Step 2**: Manual smoke test against a real Mumble server:
  - [ ] Two users in a voice channel. Be silent for 10+ min. Other user sees moon next to your name; tooltip shows correct elapsed time.
  - [ ] Be silent + don't touch keyboard/mouse for 10 min while window-foregrounded → auto-leave-voice + toast appears.
  - [ ] Be silent + active in another app (mouse moves) → no auto-leave (system idle reset).
  - [ ] Lock workstation while in voice → immediate auto-leave on unlock you see the toast.
  - [ ] Disconnect/reconnect cycle: moon icons clear, polling resumes.

- [ ] **Step 3**: Ask the user before pushing the branch and opening the PR (per CLAUDE.md branch management rules).

- [ ] **Step 4**: PR title: "feat: idle status — moon icon and auto-leave-voice (#61)". Body bullet points:
  - Polled `UserStats.idlesecs` per visible Mumble user → moon icon + elapsed-time tooltip.
  - Auto leave-voice when (Brmble app idle AND Windows idle) ≥ 10 min OR workstation locked. Non-blocking toast on next interaction.
  - No settings UI in v1; thresholds + behaviour hardcoded. Research doc at `docs/research/2026-05-03-idle-status-research.md`.
  - Closes #61.
