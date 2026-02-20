# Leave Voice Button Improvements — Design

## Problem

Two UX gaps exist in the current leave-voice feature:

1. **No visual feedback when rejoin is unavailable.** When a user connects and leave-voice auto-activates (no previous channel stored), the "Rejoin Voice" button is a silent no-op. It looks pressable but does nothing.

2. **Manual move to root does not activate leave voice.** If a user double-clicks the root channel in the channel tree (or is moved there externally), the app does not treat this as a leave-voice action — the user ends up in root unmuted and undeafened with no stored previous channel.

---

## Improvement 1 — Disable leave voice button when no previous channel

### Approach

Add a `_canRejoin` boolean tracked in `MumbleAdapter.cs`. Emit a new `voice.canRejoinChanged` bridge event (`{ canRejoin: bool }`) whenever the value changes. The frontend stores `canRejoin` state and passes it to `UserPanel`, which conditionally disables the leave voice button.

### Backend changes (`MumbleAdapter.cs`)

- Add `private bool _canRejoin;` field (defaults `false`).
- Add private helper `EmitCanRejoin()` that sends `voice.canRejoinChanged` and updates `_canRejoin`.
- Call `EmitCanRejoin(false)` in `Disconnect()` alongside the existing resets.
- In `ActivateLeaveVoice()`: call `EmitCanRejoin(_previousChannelId != null)` after setting state.
- In `LeaveVoice()` rejoin branch: call `EmitCanRejoin(false)` after clearing `_previousChannelId`.
- In `UserState()` manual-escape-hatch branch (`else if (_leftVoice)`): call `EmitCanRejoin(false)` alongside `leftVoiceChanged`.

### Frontend changes

**`App.tsx`:**
- Add `selfCanRejoin` state (`boolean`, default `false`).
- Listen to `voice.canRejoinChanged` → update `selfCanRejoin`.
- On `voice.disconnected`, reset both `selfLeftVoice = false` and `selfCanRejoin = false`.
- Pass `canRejoin={selfCanRejoin}` down to `Header`.

**`Header.tsx`:**
- Add `canRejoin?: boolean` to props interface.
- Thread it down to `UserPanel`.

**`UserPanel.tsx`:**
- Add `canRejoin?: boolean` to props interface.
- Leave voice button: add `disabled={leftVoice && !canRejoin}` HTML attribute and append `disabled` CSS class when `leftVoice && !canRejoin`.

### Button state matrix

| `leftVoice` | `canRejoin` | Button label   | Button state |
|-------------|-------------|----------------|--------------|
| `false`     | `false`     | Leave Voice    | Enabled      |
| `true`      | `false`     | Rejoin Voice   | **Disabled** |
| `true`      | `true`      | Rejoin Voice   | Enabled      |

---

## Improvement 2 — Manual move to root activates leave voice

### Approach

Extend the `UserState()` channel-change handler in `MumbleAdapter.cs` with a third branch that detects a self-initiated (or external) move into root channel (id `0`) while not already in leave-voice mode.

### Backend changes (`MumbleAdapter.cs`)

In the `if (previousChannel.HasValue && userState.ChannelId != previousChannel && isSelf)` block, add a third branch after the existing `else if (_leftVoice)`:

```
else if (userState.ChannelId == 0 && ReceivedServerSync)
```

When triggered:
- `_previousChannelId = previousChannel` (store the channel they just left; guaranteed non-null, non-zero by outer conditions)
- Call `ActivateLeaveVoice()` — no `channelMoveInProgress` since the user is already in root

**Guards (all implicit from surrounding conditions):**
- `!_leaveVoiceInProgress` — outer `if` is entered only in `else` path from first branch
- `!_leftVoice` — we are in `else` path from second branch
- `userState.ChannelId == 0` — explicitly checked
- `previousChannel != 0` — guaranteed because outer condition is `ChannelId != previousChannel` and `ChannelId == 0`
- `ReceivedServerSync` — prevents firing during initial state-sync burst on connect

**Interaction with Improvement 1:**
`ActivateLeaveVoice()` emits `canRejoinChanged` with `true` (since `_previousChannelId` is set before the call), so the Rejoin Voice button is immediately enabled.

### What does NOT change

- The `else if (_leftVoice)` escape hatch (manual move to non-root clears leave voice) is unaffected.
- `LeaveVoice()` itself is unaffected.
- No frontend changes required for Improvement 2.

---

## Key invariants preserved

- Root channel (id `0`) is never stored as `_previousChannelId`.
- `_canRejoin` always reflects whether `_previousChannelId` is non-null.
- `_leaveVoiceInProgress` is `false` whenever no programmatic channel move is in flight.
