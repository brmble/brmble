# Reconnect-When-Disconnected Setting Design

**Date:** 2026-02-23
**Related:** Auto-connect on startup (#91)

## Problem

The existing `ReconnectLoop` in `MumbleAdapter.cs` always activates on unexpected disconnection
(exponential backoff: 2s, 4s, 8s, 16s, 30s cap). Some users may prefer to stay disconnected
after a drop rather than have the client automatically retry. This setting gives them control
over that behavior.

## Chosen Approach

A global opt-out toggle on `AppSettings`. MumbleAdapter reads the setting at the reconnect
decision point. When disabled, the client sends `voice.disconnected` with a
`reconnectAvailable` flag, and the frontend shows a manual "Reconnect" button.

## Settings Model

One new field on `AppSettings`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `ReconnectEnabled` | `bool` | `true` | Opt-out toggle. On by default. |

No new `ConfigData` fields. No per-server configuration.

## Config File

Addition to `config.json`:

```json
{
  "settings": {
    "audio": { ... },
    "shortcuts": { ... },
    "messages": { ... },
    "overlay": { ... },
    "speechEnhancement": { ... },
    "autoConnectEnabled": false,
    "autoConnectServerId": null,
    "reconnectEnabled": true
  }
}
```

## Backend Logic

In `MumbleAdapter.cs`, the reconnect decision point is at the end of the process loop
(currently line ~245):

```csharp
if (!_intentionalDisconnect && !ct.IsCancellationRequested
    && _reconnectHost != null && _reconnectCts == null)
{
    // Unexpected drop — clean up and start reconnect loop.
    Disconnect();
    Task.Run(() => ReconnectLoop());
}
```

The change: before entering `ReconnectLoop()`, read `ReconnectEnabled` from
`_appConfigService.GetSettings()`. If disabled:

- Skip `ReconnectLoop()`
- Send `voice.disconnected` with `reconnectAvailable = true`
- The frontend shows "Disconnected" status and a "Reconnect" button

If enabled, behavior is unchanged — `ReconnectLoop()` fires as today.

The setting is read at decision time (not cached), so toggling it in Settings takes
effect on the next disconnect without restarting.

## UI: Connection Tab Update

The Connection tab currently has a "Startup" section header. Both that header and a
new "Reconnection" header are removed — the tab is a flat list of controls:

```
[x] Automatically reconnect when disconnected

[ ] Auto-connect on startup
Connect to: [Last connected server v]  (?)
```

- The reconnect toggle is placed **above** the auto-connect toggle.
- No section headers. The tab has few enough controls that headers add clutter.
- The toggle maps to `reconnectEnabled` in the `ConnectionSettings` interface.

## Disconnected State (Reconnect Disabled)

When the user is unexpectedly disconnected and `ReconnectEnabled` is `false`:

1. C# sends `voice.disconnected` with `{ reconnectAvailable: true }`
2. Frontend shows "Disconnected" status text
3. A "Reconnect" button is displayed
4. Clicking "Reconnect" sends `voice.connect` with the same server parameters
   used for the last connection (host, port, username, password)
5. This reuses the existing manual connect flow — no new bridge messages needed

## Bridge Protocol

No new message types. One change to an existing message:

| Direction | Message | Change |
|-----------|---------|--------|
| C# → Frontend | `voice.disconnected` | Add optional `reconnectAvailable: bool` field |

The `reconnectAvailable` flag tells the frontend whether to show a manual Reconnect
button. It is `true` when reconnect is disabled but reconnect parameters are available
(i.e., the user was previously connected and could reconnect manually).

Settings flow uses the existing `settings.get` / `settings.set` / `settings.current` /
`settings.updated` messages — `reconnectEnabled` is included alongside the other fields.

## Files Changed

### C#

| File | Change |
|------|--------|
| `Services/AppConfig/AppSettings.cs` | Add `ReconnectEnabled = true` field |
| `Services/Voice/MumbleAdapter.cs` | Check `ReconnectEnabled` before `ReconnectLoop()`; send `reconnectAvailable` in `voice.disconnected` when skipping reconnect |

### Frontend

| File | Change |
|------|--------|
| `src/components/SettingsModal/ConnectionSettingsTab.tsx` | Add reconnect toggle above auto-connect; remove section headers; add `reconnectEnabled` to `ConnectionSettings` interface |
| `src/components/SettingsModal/ConnectionSettingsTab.css` | Minor spacing adjustments if needed |
| `src/App.tsx` | Handle `reconnectAvailable` flag in `voice.disconnected` handler; add Reconnect button logic |

## Edge Cases

- **Setting toggled while reconnect loop is active:** No effect on the current loop.
  The loop runs to completion (or cancellation). The new setting value applies on the
  *next* unexpected disconnect.
- **Intentional disconnect:** `_intentionalDisconnect` is `true`, so the reconnect
  decision point is never reached. The setting has no effect on manual disconnects.
- **Auto-connect failure:** Auto-connect triggers `voice.connect` which goes through
  the normal connection path. If that connection later drops, the reconnect setting
  applies as usual.

## Acceptance Criteria

- "Automatically reconnect when disconnected" toggle visible in Connection tab.
- Toggle is **on** by default (opt-out).
- When enabled, unexpected disconnections trigger the existing reconnect loop (unchanged).
- When disabled, unexpected disconnections show "Disconnected" + a "Reconnect" button.
- Clicking "Reconnect" reconnects to the same server via the standard `voice.connect` flow.
- Connection tab has no section headers — flat list of controls.
- Setting persists across restarts via `config.json`.
- Setting is read at disconnect time, not cached — changes take effect immediately.
