# GUI Channel Switch Lag — Investigation Design

**Date:** 2026-02-20  
**Status:** Approved

---

## Problem Statement

After double-clicking a channel in Brmble, audio switches instantly (PTT and hearing others works immediately), but the channel tree and current channel indicator in the GUI take 2–5 seconds to update visually.

Since audio is live immediately, MumbleSharp's internal state has already switched channels. The bug is entirely in the signal path from C# state change → JS UI update.

Connect is not affected — only channel switching exhibits the delay, and it is consistent (2–5 seconds every time).

---

## Suspected Root Causes

### Primary — `voice.channelChanged` not firing (most likely)

In `MumbleAdapter.UserState()` (line 449), `voice.channelChanged` fires only if:

```csharp
previousChannel.HasValue && userState.ChannelId != previousChannel && isSelf
```

`previousChannel` is captured as `LocalUser?.Channel?.Id` **before** `base.UserState()` updates the local user's state. During a channel join, there is a window where `LocalUser` may not yet reflect the new channel when this guard runs — the condition evaluates false and the event is silently dropped.

When `voice.channelChanged` is dropped, the frontend has no signal to update `currentChannelId`. The GUI may only update later when a subsequent `voice.userJoined` arrives from `UserStateChannelChanged()` — which is the source of the 2–5 second observed delay.

### Secondary — UI thread stall

Between `PostMessage(WM_USER)` and `ProcessUiMessage()`, the UI thread could be blocked by a long-running synchronous operation in another `WndProc` handler. Less likely given that connect (which also uses WM_USER) works correctly.

### Third — Frontend state lookup delay

`onVoiceChannelChanged` in `App.tsx` looks up the channel name from `channelsRef.current`. If that ref is stale or the lookup returns an empty string, there may be a conditional render path in `ChannelTree.tsx` that defers the visible update until `currentChannelName` is also set. Worth ruling out during investigation.

---

## Investigation Steps

### Checkpoint 1 — `MumbleAdapter.UserState()` (background thread)

Add `Debug.WriteLine` tracing at the `voice.channelChanged` condition:

```csharp
Debug.WriteLine(
    $"[UserState] isSelf={isSelf} previousChannel={previousChannel} " +
    $"newChannelId={userState.ChannelId} hasValue={previousChannel.HasValue}");
```

**Expected outcome:** If `previousChannel.HasValue` is `false` on the channel-switch packet, the event is being suppressed here — this confirms the primary suspect.

### Checkpoint 2 — `NativeBridge.Send()` and `ProcessUiMessage()` (UI thread)

Add timestamps when `voice.channelChanged` is enqueued and dequeued:

```csharp
// In Send():
Debug.WriteLine($"[NativeBridge.Send] {type} enqueued at {DateTime.Now:HH:mm:ss.fff}");

// In ProcessUiMessage():
Debug.WriteLine($"[NativeBridge.ProcessUiMessage] dequeuing at {DateTime.Now:HH:mm:ss.fff}");
```

**Expected outcome:** If the timestamps show <50ms between enqueue and dequeue, the WM_USER pipeline is not the bottleneck.

### Checkpoint 3 — JS bridge handler (frontend)

In `bridge.ts`, wrap the dispatch with a `console.time`:

```ts
console.time(`bridge:${msg.type}`);
handler(msg.data);
console.timeEnd(`bridge:${msg.type}`);
```

**Expected outcome:** If the handler fires immediately after the message arrives from WebView2 but the DOM doesn't update for seconds, the React state update path needs investigation.

---

## Fix Strategy

Based on findings, the fix is expected to be one or both of:

**Fix A — Remove the unreliable condition in `UserState()` and rely on `UserStateChannelChanged()`:**

`UserStateChannelChanged()` is MumbleSharp's authoritative callback for local channel changes. Add `voice.channelChanged` there instead of (or in addition to) the condition in `UserState()`:

```csharp
protected override void UserStateChannelChanged(User user, uint oldChannelId)
{
    base.UserStateChannelChanged(user, oldChannelId);
    if (user == LocalUser && user.Channel != null)
    {
        _bridge?.Send("voice.channelChanged", new {
            channelId = user.Channel.Id,
            name = user.Channel.Name
        });
        // existing voice.userJoined send can remain or be removed if redundant
    }
}
```

Also remove or guard the duplicate `voice.channelChanged` send in `UserState()` to avoid double-firing.

**Fix B — Include `name` in the `voice.channelChanged` payload:**

The current payload only sends `{ channelId }`. The frontend falls back to `channelsRef.current.find(...)` for the name. If `channelsRef` is stale, the name is wrong or empty. Including `name` in the payload eliminates this dependency.

---

## Success Criteria

After the fix:

- Double-clicking a channel updates the channel indicator in the GUI within ~100ms (matching the audio switch latency).
- No regression on connect — `voice.connected` still dismisses the server list overlay correctly.
- No duplicate `voice.channelChanged` events visible in the browser devtools console.

---

## Files in Scope

| File | Lines of Interest |
|---|---|
| `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` | 420–468 (`UserState`, `UserStateChannelChanged`) |
| `src/Brmble.Client/Bridge/NativeBridge.cs` | 61–93 (`Send`, `ProcessUiMessage`) |
| `src/Brmble.Client/Program.cs` | 265–270 (WM_USER dispatch) |
| `src/Brmble.Web/src/App.tsx` | 249–260 (`onVoiceChannelChanged`) |
| `src/Brmble.Web/src/bridge.ts` | 37–52 (`on`, `off`, dispatch) |
