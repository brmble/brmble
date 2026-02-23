# Auto-Connect on Startup Design

**Date:** 2026-02-23
**Issue:** #91 — Auto-connect to server on startup with opt-in setting

## Problem

When the application starts, the user always lands on the server list and must manually click
"Connect." Users who routinely connect to the same server want the app to connect automatically
on launch. The feature must be opt-in, off by default, and provide enough control to choose
which server to connect to.

## Chosen Approach

A global toggle with a single server selector. No per-server checkboxes — the user enables
auto-connect once and picks either "last connected server" or a specific server from a dropdown.

## Settings Model

Two new fields on `AppSettings`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `AutoConnectEnabled` | `bool` | `false` | Global toggle. Off by default. |
| `AutoConnectServerId` | `string?` | `null` | Server ID to auto-connect to. `null` means "last connected server." |

One new field on `ConfigData` (outside `AppSettings`, not user-editable):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `LastConnectedServerId` | `string?` | `null` | Updated automatically on every successful connection. |

`LastConnectedServerId` is tracked automatically, like `WindowState` and `ClosePreference`.
It is written to `config.json` whenever `ServerSync` fires (connection succeeds), regardless
of whether the connection was manual or automatic.

## Config File

The additions to `config.json`:

```json
{
  "servers": [ ... ],
  "settings": {
    "audio": { ... },
    "shortcuts": { ... },
    "messages": { ... },
    "overlay": { ... },
    "speechEnhancement": { ... },
    "autoConnectEnabled": false,
    "autoConnectServerId": null
  },
  "lastConnectedServerId": null,
  "window": { ... },
  "closePreference": null
}
```

## UI: New "Connection" Tab in Settings Modal

A sixth tab is added to the Settings modal, between the existing tabs and Identity.
The tab label is "Connection."

### Layout

```
[  ] Auto-connect on startup

     Connect to:  [ Last connected server  v ]  (?)
```

- **Toggle:** Controls `AutoConnectEnabled`.
- **Dropdown:** Shown always, but disabled when the toggle is off. Lists "Last connected server"
  as the first option, followed by all saved servers by label.
- **Tooltip (?):** A small icon next to the "Connect to" label. On hover, displays:
  *"Choose 'Last connected server' to reconnect where you left off, or pick a specific server
  to always connect to that one."*

### UX States

**New user (no servers saved):**

```
[  ] Auto-connect on startup

     Connect to:  [ Last connected server  v ]  (?)

     You can also choose a specific server once you've added one.
```

The toggle is interactive — the user can enable it even without servers. It simply has no effect
until they connect to a server for the first time. The dropdown only shows "Last connected server."
A muted hint note below the dropdown explains that specific-server selection becomes available
once servers are saved. This ensures new users discover the feature exists.

**User with servers saved:**

```
[x] Auto-connect on startup

     Connect to:  [ Last connected server  v ]  (?)
                   -------------------------
                   | Last connected server  |
                   | My Home Server         |
                   | Work Server            |
                   -------------------------
```

The hint note disappears once servers exist in the dropdown. The tooltip remains as the
permanent way to understand the two modes.

**Auto-connect disabled:**

```
[  ] Auto-connect on startup

     Connect to:  [ Last connected server  v ]  (?)    <-- greyed out
```

The dropdown is visible but disabled. Users can see what options exist without enabling the
feature first.

## Startup Flow

On application launch, in `Program.cs`, after WebView2 is initialized:

```
AppConfigService.Load()
  ├─ Read AutoConnectEnabled, AutoConnectServerId, LastConnectedServerId
  │
  ├─ AutoConnectEnabled == false?
  │     └─ Do nothing. Frontend shows server list as today.
  │
  └─ AutoConnectEnabled == true?
        ├─ Resolve target server:
        │     ├─ AutoConnectServerId != null → look up that server in the server list
        │     ├─ AutoConnectServerId == null → use LastConnectedServerId
        │     └─ Resolved server not found (deleted) → fall back to server list
        │
        └─ Trigger connection via the same voice.connect path used for manual connects
              └─ Frontend receives voice.connecting / voice.connected as normal
```

The auto-connect uses the exact same connection path as a manual connect. No new bridge
messages are needed for the connection itself. The frontend just needs to know that an
auto-connect is in progress so it can show the connecting state instead of the server list.

## Auto-Connect Failure

If auto-connect fails (server down, network issue), use the existing reconnect loop:

- Exponential backoff: 2s, 4s, 8s, 16s, 30s (caps at 30s)
- Frontend shows the reconnecting UI with attempt counter
- User can cancel, which drops them to the server list

This reuses the existing `ReconnectLoop` in `MumbleAdapter.cs` — no new retry logic needed.

## Tracking Last Connected Server

When a connection succeeds (`ServerSync` fires), `AppConfigService.SaveLastConnectedServerId(id)`
is called to persist the server ID. This happens on every successful connection — manual or auto.

The server ID comes from the `id` field in the `voice.connect` message payload, which matches
the `ServerEntry.Id` in the server list.

## Bridge Protocol

No new bridge messages for the connection flow. The only additions are to the existing
settings protocol:

| Direction | Message | Change |
|-----------|---------|--------|
| Frontend → C# | `settings.get` | Response now includes `autoConnectEnabled`, `autoConnectServerId` |
| Frontend → C# | `settings.set` | Can now include `autoConnectEnabled`, `autoConnectServerId` |
| C# → Frontend | `settings.current` | Now includes the new fields |
| C# → Frontend | `settings.updated` | Now includes the new fields |

## Files Changed

### C#

| File | Change |
|------|--------|
| `Services/AppConfig/AppSettings.cs` | Add `AutoConnectEnabled`, `AutoConnectServerId` fields |
| `Services/AppConfig/AppConfigService.cs` | Add `LastConnectedServerId` to `ConfigData`; add `SaveLastConnectedServerId()` method; add `GetLastConnectedServerId()` method |
| `Services/AppConfig/IAppConfigService.cs` | Add interface methods for last-connected tracking |
| `Services/Voice/MumbleAdapter.cs` | Call `SaveLastConnectedServerId` in `ServerSync`; add auto-connect trigger on startup |
| `Program.cs` | Add auto-connect logic after WebView2 init |

### Frontend

| File | Change |
|------|--------|
| `src/components/SettingsModal/SettingsModal.tsx` | Add "Connection" tab |
| `src/components/SettingsModal/ConnectionSettingsTab.tsx` | New component: toggle, dropdown, tooltip, hint text |
| `src/components/SettingsModal/ConnectionSettingsTab.css` | Styles for the new tab |

## Edge Cases

- **No servers saved:** Auto-connect is a no-op. Show server list.
- **Target server deleted:** If `AutoConnectServerId` points to a deleted server, fall back to
  `LastConnectedServerId`. If that's also gone, show server list.
- **Never connected before:** `LastConnectedServerId` is `null`. Auto-connect is a no-op even
  if enabled. Show server list.
- **Auto-connect + reconnect failure:** After the reconnect loop gives up, show
  `voice.reconnectFailed` and land on the server list.

## Acceptance Criteria

- "Auto-connect on startup" toggle visible in a new Connection tab in Settings.
- Toggle is off by default.
- When enabled with "Last connected server," client connects to the most recently used server.
- When enabled with a specific server selected, client always connects to that server.
- `LastConnectedServerId` is tracked on every successful connection.
- Connection failures use the existing reconnect loop with cancel option.
- New users see a hint that specific-server selection appears once they add servers.
- Tooltip explains the difference between the two dropdown modes.
- Dropdown is visible but disabled when auto-connect is off.
- Setting persists across restarts via `config.json`.
