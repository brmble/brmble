# Remember Last Channel Setting Design

## Problem

When a registered Mumble user connects, the server places them in their last channel. Currently the client unconditionally activates leave-voice mode, disabling controls. Issue #339 fixes the immediate bug, but users should also have the option to start in root instead.

## Setting

- **Key**: `RememberLastChannel` (C#) / `rememberLastChannel` (frontend)
- **Label**: "Rejoin last voice channel on connect"
- **Hint**: "When connecting to a server, automatically rejoin the voice channel you were in last time. Does not affect reconnection after temporary disconnects."
- **Default**: `true`
- **Location**: Connection tab, below Reconnect toggle

## Behavior Matrix

| Scenario | Setting ON | Setting OFF |
|---|---|---|
| Fresh connect, registered user in non-root channel | Stay in channel, controls enabled | Move to root, activate leave-voice |
| Fresh connect, user in root | Activate leave-voice | Activate leave-voice |
| Reconnect after temp disconnect | Stay in channel | Stay in channel |

## Implementation

### Backend (`MumbleAdapter.cs`)

Add `_isReconnect` boolean flag:
- Set `true` in `ReconnectLoop()` before calling `Connect()`
- Cleared after `ServerSync` completes

In `ServerSync` handler, after checking channel ID:
- If non-root AND not reconnect AND `RememberLastChannel` is off: move user to root (channel 0) and activate leave-voice
- Otherwise: use existing logic from issue #339 fix

### Settings (`AppSettings.cs`)

Add `bool RememberLastChannel = true` to `AppSettings` record.

### Frontend (`ConnectionSettingsTab.tsx`)

Add toggle in Connection section. Update `ConnectionSettings` interface and `handleConnectionChange` in `SettingsModal.tsx`.

## Files Changed

- `src/Brmble.Client/Services/AppConfig/AppSettings.cs`
- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- `src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.tsx`
- `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
