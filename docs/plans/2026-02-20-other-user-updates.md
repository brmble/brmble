# Other-User Channel Updates & ProcessLoop Throttling

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the channel tree not updating when other users join/leave/switch channels, and throttle ProcessLoop UI notifications to prevent audio choppiness.

**Architecture:** Two C# fixes in MumbleAdapter (read User model instead of raw protobuf, throttle NotifyUiThread to 50ms), one frontend guard fix in App.tsx. All changes are small and targeted.

**Tech Stack:** C# (.NET 10), React/TypeScript, WebView2 bridge

---

### Task 1: Throttle NotifyUiThread in ProcessLoop

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:20-33` (add field)
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:163-188` (throttle in ProcessLoop)

**Step 1: Add throttle field to MumbleAdapter**

Add a `Stopwatch` field alongside the other instance fields (after line 33):

```csharp
private readonly Stopwatch _notifyThrottle = Stopwatch.StartNew();
```

Add `using System.Diagnostics;` if not already present (it is — line 1).

**Step 2: Throttle NotifyUiThread in ProcessLoop**

Replace the ProcessLoop method (lines 163-188) with throttled version:

```csharp
private void ProcessLoop(CancellationToken ct)
{
    while (!ct.IsCancellationRequested
           && Connection is { State: not ConnectionStates.Disconnected })
    {
        try
        {
            if (Connection.Process())
            {
                // Throttle UI notifications to at most once per 50ms (20/sec).
                // Without this, UDP voice packets (20-50+/sec) flood the UI
                // thread with WM_USER messages and cause choppy audio.
                if (_notifyThrottle.ElapsedMilliseconds >= 50)
                {
                    _bridge?.NotifyUiThread();
                    _notifyThrottle.Restart();
                }
                Thread.Yield();
            }
            else
            {
                // No packet — flush any pending messages before sleeping.
                if (_notifyThrottle.ElapsedMilliseconds > 0 && !_pendingMessages_empty())
                {
                    _bridge?.NotifyUiThread();
                    _notifyThrottle.Restart();
                }
                Thread.Sleep(1);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _bridge?.Send("voice.error", new { message = $"Process error: {ex.Message}" });
            _bridge?.NotifyUiThread();
        }
    }
}
```

Wait — we can't check `_pendingMessages_empty()` from here since the queue is on NativeBridge. Simplify: just always notify when transitioning from processing to idle (the `else` branch). Actually, the simplest correct approach:

```csharp
private void ProcessLoop(CancellationToken ct)
{
    while (!ct.IsCancellationRequested
           && Connection is { State: not ConnectionStates.Disconnected })
    {
        try
        {
            if (Connection.Process())
            {
                if (_notifyThrottle.ElapsedMilliseconds >= 50)
                {
                    _bridge?.NotifyUiThread();
                    _notifyThrottle.Restart();
                }
                Thread.Yield();
            }
            else
            {
                // No more packets — flush any queued messages before sleeping.
                _bridge?.NotifyUiThread();
                _notifyThrottle.Restart();
                Thread.Sleep(1);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _bridge?.Send("voice.error", new { message = $"Process error: {ex.Message}" });
            _bridge?.NotifyUiThread();
        }
    }
}
```

The key insight: when `Process()` returns `false` (no packet), we're about to sleep, so flush anything pending. When `Process()` returns `true` (packet processed), only notify if 50ms has passed. This ensures messages are always delivered promptly (within 50ms or at idle) without flooding during voice.

**Step 3: Build and run tests**

Run: `dotnet build`
Expected: 0 errors

Run: `dotnet test`
Expected: all 106 tests pass

**Step 4: Commit**

```
fix: throttle ProcessLoop UI notifications to prevent audio choppiness
```

---

### Task 2: Fix UserState to read from User model

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:566-585`

**Step 1: Replace raw protobuf reads with User model lookups**

After `base.UserState(userState)` runs (line 571), the User object in UserDictionary has the correct state. Replace lines 577-585:

Before:
```csharp
_bridge?.Send("voice.userJoined", new
{
    session = userState.Session,
    name = userState.Name,
    channelId = userState.ChannelId,
    muted = userState.Mute || userState.SelfMute,
    deafened = userState.Deaf || userState.SelfDeaf,
    self = isSelf
});
```

After:
```csharp
UserDictionary.TryGetValue(userState.Session, out var user);

_bridge?.Send("voice.userJoined", new
{
    session = userState.Session,
    name = user?.Name ?? userState.Name,
    channelId = user?.Channel?.Id ?? userState.ChannelId,
    muted = user != null ? (user.Muted || user.SelfMuted) : (userState.Mute || userState.SelfMute),
    deafened = user != null ? (user.Deaf || user.SelfDeaf) : (userState.Deaf || userState.SelfDeaf),
    self = isSelf
});
```

**Step 2: Build and run tests**

Run: `dotnet build`
Expected: 0 errors

Run: `dotnet test`
Expected: all tests pass

**Step 3: Commit**

```
fix: read user state from model instead of raw protobuf for bridge messages
```

---

### Task 3: Relax frontend guard for voice.userJoined

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:228`

**Step 1: Remove name requirement from guard**

Before (line 228):
```typescript
if (d?.session && d?.name && d.channelId !== undefined) {
```

After:
```typescript
if (d?.session && d.channelId !== undefined) {
```

With Task 2, `name` will always be present from C#. But the guard shouldn't gate on it — a session + channelId is sufficient to update an existing user's position.

**Step 2: Build frontend**

Run: `cd src/Brmble.Web && npm run build`
Expected: no errors

**Step 3: Commit**

```
fix: allow voice.userJoined without name field for channel moves
```

---

### Task 4: Manual verification

Test with two users on the same Mumble server:
1. Connect both users
2. Have the other user switch channels — verify they move in the channel tree
3. Have the other user disconnect — verify they disappear
4. Have the other user reconnect — verify they appear
5. During active voice, verify audio is not choppy

---
