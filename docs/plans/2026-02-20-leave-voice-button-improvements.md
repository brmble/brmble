# Leave Voice Button Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Disable the leave voice button when no previous channel is stored, and auto-activate leave voice when the user manually moves to root.

**Architecture:** Two independent changes. Improvement 1 adds a `_canRejoin` field + `voice.canRejoinChanged` bridge event wired through to `UserPanel`. Improvement 2 adds a third branch in `UserState()` that treats a manual move to root (channel 0) as a leave-voice activation.

**Tech Stack:** C# (.NET, MumbleSharp), React + TypeScript (Vite), WebView2 bridge

---

### Task 1: Add `_canRejoin` field and `EmitCanRejoin()` helper to `MumbleAdapter`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Add field**

After the existing `private bool _leaveVoiceInProgress;` field (line ~30), add:

```csharp
private bool _canRejoin;
```

**Step 2: Add helper method**

After `ActivateLeaveVoice()` (around line 266), add:

```csharp
/// <summary>
/// Updates <see cref="_canRejoin"/> and emits <c>voice.canRejoinChanged</c>.
/// Call whenever <see cref="_previousChannelId"/> is assigned or cleared.
/// </summary>
private void EmitCanRejoin(bool canRejoin)
{
    _canRejoin = canRejoin;
    _bridge?.Send("voice.canRejoinChanged", new { canRejoin });
}
```

**Step 3: Build to confirm it compiles**

```
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded, 0 errors.

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: add _canRejoin field and EmitCanRejoin helper to MumbleAdapter"
```

---

### Task 2: Wire `EmitCanRejoin()` into all leave-voice state transitions

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Call `EmitCanRejoin` in `Disconnect()`**

In `Disconnect()`, after `_leaveVoiceInProgress = false;` (around line 137), add:

```csharp
_canRejoin = false;
_bridge?.Send("voice.canRejoinChanged", new { canRejoin = false });
```

Note: We call the bridge send directly here (not `EmitCanRejoin`) because at disconnect the bridge may already be tearing down, and we want the field reset regardless. Actually, using `EmitCanRejoin(false)` is fine — use it for consistency:

```csharp
EmitCanRejoin(false);
```

**Step 2: Call `EmitCanRejoin` in `ActivateLeaveVoice()`**

At the end of `ActivateLeaveVoice()`, after the three `_bridge?.Send(...)` calls, add:

```csharp
EmitCanRejoin(_previousChannelId != null);
```

**Step 3: Call `EmitCanRejoin` in `LeaveVoice()` rejoin branch**

In the `else` branch of `LeaveVoice()`, after `_previousChannelId = null;` (around line 296), add:

```csharp
EmitCanRejoin(false);
```

**Step 4: Call `EmitCanRejoin` in `UserState()` manual-escape-hatch branch**

In the `else if (_leftVoice && LocalUser != null)` branch of `UserState()` (around line 548), after the `_bridge?.Send("voice.leftVoiceChanged", ...)` call, add:

```csharp
EmitCanRejoin(false);
```

**Step 5: Build to confirm it compiles**

```
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded, 0 errors.

**Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: emit voice.canRejoinChanged on all leave-voice state transitions"
```

---

### Task 3: Frontend — wire `canRejoin` state in `App.tsx`

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Add `selfCanRejoin` state**

Find where `selfLeftVoice` state is declared (search for `setSelfLeftVoice`). Immediately after it, add:

```tsx
const [selfCanRejoin, setSelfCanRejoin] = useState(false);
```

**Step 2: Add bridge event listener**

In the `useEffect` that registers bridge listeners, find `onLeftVoiceChanged`. Immediately after it, add:

```tsx
const onCanRejoinChanged = ((data: unknown) => {
  const d = data as { canRejoin: boolean } | undefined;
  if (d?.canRejoin !== undefined) {
    setSelfCanRejoin(d.canRejoin);
  }
});
```

Register it alongside the others:

```tsx
bridge.on('voice.canRejoinChanged', onCanRejoinChanged);
```

And clean it up in the return:

```tsx
bridge.off('voice.canRejoinChanged', onCanRejoinChanged);
```

**Step 3: Reset `selfCanRejoin` on disconnect**

Find the `voice.disconnected` handler. Alongside `setSelfLeftVoice(false)` (or wherever voice state resets on disconnect), add:

```tsx
setSelfCanRejoin(false);
```

**Step 4: Pass `canRejoin` to `Header`**

Find where `Header` (or `UserPanel` via `Header`) is rendered with `leftVoice={selfLeftVoice}`. Add:

```tsx
canRejoin={selfCanRejoin}
```

**Step 5: TypeScript build check**

```
cd src/Brmble.Web && npm run build
```

Expected: Build succeeded (or only pre-existing errors about Header/UserPanel not accepting `canRejoin` yet — those are fixed in Task 4).

---

### Task 4: Frontend — thread `canRejoin` through `Header` and `UserPanel`

**Files:**
- Modify: `src/Brmble.Web/src/components/Header/Header.tsx`
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.tsx`
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.css`

**Step 1: Update `Header.tsx` props**

Add `canRejoin?: boolean` to the `HeaderProps` interface and to the destructured parameters. Pass it to `UserPanel`:

```tsx
canRejoin={canRejoin}
```

**Step 2: Update `UserPanel.tsx` props**

Add `canRejoin?: boolean` to `UserPanelProps` and the destructured parameters.

**Step 3: Disable the leave voice button when `leftVoice && !canRejoin`**

The current leave voice button (around line 22):

```tsx
<button 
  className={`user-panel-btn leave-voice-btn ${leftVoice ? 'active' : ''}`}
  onClick={onLeaveVoice}
  title={leftVoice ? 'Rejoin Voice' : 'Leave Voice'}
>
```

Change to:

```tsx
<button 
  className={`user-panel-btn leave-voice-btn ${leftVoice ? 'active' : ''} ${(leftVoice && !canRejoin) ? 'disabled' : ''}`}
  onClick={onLeaveVoice}
  disabled={leftVoice && !canRejoin}
  title={leftVoice ? 'Rejoin Voice' : 'Leave Voice'}
>
```

**Step 4: Build to confirm no TypeScript errors**

```
cd src/Brmble.Web && npm run build
```

Expected: Build succeeded, 0 errors.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/Header/Header.tsx src/Brmble.Web/src/components/UserPanel/UserPanel.tsx
git commit -m "feat: disable rejoin voice button when no previous channel to return to"
```

---

### Task 5: Manual move to root activates leave voice (`UserState()` — Improvement 2)

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Locate the correct spot**

In `UserState()`, find the block (around line 538):

```csharp
if (previousChannel.HasValue && userState.ChannelId != previousChannel && isSelf)
{
    _bridge?.Send("voice.channelChanged", new { channelId = userState.ChannelId });

    // If this channel change was initiated by LeaveVoice toggle, just clear the flag
    if (_leaveVoiceInProgress)
    {
        _leaveVoiceInProgress = false;
    }
    // If user manually joins a channel while in left-voice mode, clear it
    else if (_leftVoice && LocalUser != null)
    {
        // ... clears leave-voice state ...
    }
}
```

**Step 2: Add third branch**

After the `else if (_leftVoice && LocalUser != null)` closing brace, add:

```csharp
// If user moves to root while not in leave-voice, activate leave voice and
// store the channel they came from so they can rejoin.
// ReceivedServerSync guard prevents firing during the initial state-sync burst.
else if (userState.ChannelId == 0 && ReceivedServerSync)
{
    _previousChannelId = previousChannel;
    ActivateLeaveVoice();
}
```

`previousChannel` here is a `uint?` captured at the top of `UserState()` from `LocalUser?.Channel?.Id` before the base call. It is guaranteed non-null and non-zero by the outer `previousChannel.HasValue` condition combined with `userState.ChannelId == 0` (so they must differ, and `previousChannel` must have been non-zero).

**Step 3: Build**

```
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded, 0 errors.

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: auto-activate leave voice when user moves to root channel manually"
```

---

### Task 6: Manual verification

Verify all scenarios work end-to-end by running the app in dev mode:

```bash
# Terminal 1
cd src/Brmble.Web && npm run dev

# Terminal 2
dotnet run --project src/Brmble.Client
```

**Scenario matrix:**

| # | Action | Expected |
|---|--------|----------|
| 1 | Connect to server | Leave voice auto-active; Rejoin Voice button **disabled** |
| 2 | Click Rejoin Voice | Nothing happens (button is disabled) |
| 3 | Double-click a non-root channel | Leave voice clears; user in selected channel; button re-enabled |
| 4 | Manually double-click root channel | Leave voice activates; stores previous channel; Rejoin Voice **enabled** |
| 5 | Click Rejoin Voice | Returns to previous channel; leave voice clears |
| 6 | From non-root channel, click Leave Voice | Leave voice activates; stores previous channel; Rejoin Voice **enabled** |
| 7 | Click Rejoin Voice | Returns to previous channel |
| 8 | Disconnect and reconnect | Leave voice auto-active again; Rejoin Voice button **disabled** |
| 9 | External move to root (another user moves you) | Leave voice activates; stores previous channel; Rejoin Voice **enabled** |

---

### Task 7: Commit design doc

```bash
git add docs/plans/2026-02-20-leave-voice-button-improvements-design.md docs/plans/2026-02-20-leave-voice-button-improvements.md
git commit -m "docs: add leave voice button improvements design and implementation plan"
```
