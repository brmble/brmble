# Settings Persistence Design

**Date:** 2026-02-20
**Issue:** #63 — Persist settings changes between sessions
**Branch:** feature/settings-persistence

## Problem

Settings changes made in the UI (audio, shortcuts, messages, overlay) are not persisted across
application restarts. The current implementation stores settings in `localStorage`, which has two
problems:

1. The C# backend (transmission mode, hotkeys) is never notified of saved settings on startup.
2. `localStorage` is origin-scoped: dev mode (`localhost:5173`) and production (`brmble.local`)
   are different origins, so settings do not carry over between modes.

## Chosen Approach

**C# as the single source of truth.** `AppConfigService` manages a single `config.json` file in
`%APPDATA%\Brmble\`, combining the server list and all app settings. The frontend removes all
`localStorage` usage and reads/writes settings exclusively via the bridge.

This follows the same pattern as `ServerlistService` (which this service replaces).

## Config File

**Location:** `%APPDATA%\Brmble\config.json`

```json
{
  "servers": [
    { "id": "...", "label": "...", "host": "...", "port": 64738, "username": "..." }
  ],
  "settings": {
    "audio": {
      "inputDevice": "default",
      "outputDevice": "default",
      "inputVolume": 100,
      "outputVolume": 100,
      "transmissionMode": "voiceActivity",
      "pushToTalkKey": null
    },
    "shortcuts": {
      "toggleMuteKey": null,
      "toggleDeafenKey": null,
      "toggleMuteDeafenKey": null
    },
    "messages": {
      "ttsEnabled": false,
      "ttsVolume": 100,
      "notificationsEnabled": true
    },
    "overlay": {
      "overlayEnabled": false
    }
  }
}
```

**Migration:** If `config.json` does not exist but `servers.json` does, the service reads the
server list from `servers.json` and writes it into a fresh `config.json` with default settings.

## Bridge Protocol

| Direction        | Message            | Payload                      |
|------------------|--------------------|------------------------------|
| Frontend → C#    | `settings.get`     | *(empty)*                    |
| C# → Frontend    | `settings.current` | `{ settings: AppSettings }`  |
| Frontend → C#    | `settings.set`     | `{ settings: AppSettings }`  |
| C# → Frontend    | `settings.updated` | `{ settings: AppSettings }`  |

Existing `servers.*` messages are unchanged.

## Startup Flow

```
AppConfigService constructor
  ├─ Load config.json (or migrate from servers.json)
  └─ Expose GetSettings() / GetServers()

Program.cs — after all services initialized
  └─ Call mumbleAdapter.ApplySettings(appConfigService.GetSettings())
      ├─ SetTransmissionMode(audio.transmissionMode, audio.pushToTalkKey)
      └─ SetShortcut("toggleMute", shortcuts.toggleMuteKey), etc.

Frontend bridge ready
  └─ Send settings.get
      └─ C# responds with settings.current
          └─ Frontend renders UI with persisted values
```

## Settings Change Flow

```
User changes a setting in the UI
  └─ Frontend sends settings.set { settings: {...} }
      └─ AppConfigService saves to config.json
      └─ AppConfigService applies backend-relevant settings:
          ├─ audio → mumbleAdapter.SetTransmissionMode()
          └─ shortcuts → mumbleAdapter.SetShortcut()
      └─ C# sends settings.updated back to frontend
```

## Files Changed

### C#
| File | Change |
|------|--------|
| `Services/Serverlist/ServerlistService.cs` | Renamed to `AppConfigService.cs` |
| `Services/Serverlist/IServerlistService.cs` | Renamed to `IAppConfigService.cs` |
| `Services/Voice/MumbleAdapter.cs` | Add `ApplySettings(AppSettings)` method |
| `Program.cs` | Update references; call `ApplySettings()` after init |

### Frontend
| File | Change |
|------|--------|
| `src/components/SettingsModal/SettingsModal.tsx` | Remove `localStorage`; send `settings.get` on mount; send `settings.set` on change |

No changes to individual settings tab components (`AudioSettingsTab`, `ShortcutsSettingsTab`, etc.)
or to `CertificateService`.

## Acceptance Criteria

- Settings persist across application restarts.
- Backend state (transmission mode, hotkeys) is correctly restored on startup.
- Settings work identically in dev mode and production mode.
- Existing server list data is migrated automatically from `servers.json`.
- No `localStorage` usage remains for settings.
