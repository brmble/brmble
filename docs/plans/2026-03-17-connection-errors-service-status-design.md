# Connection Error Display + Per-Service Status Indicators

**Issues:** #309, #190
**Branch:** `fix/display-connection-error-309`
**Date:** 2026-03-17

## Problem

When a connection fails, users see no explanation. Error details are available in the C# backend (socket errors, server rejections, DNS failures) and sent via `voice.error` bridge messages, but the frontend handler only logs to `console.error`. The UI shows generic text like "Connection Failed" with no reason.

Additionally, the sidebar shows a single status dot for voice only. Users have no visibility into the health of other services (Chat/Matrix, Brmble Server, Screenshare/LiveKit).

## Solution Overview

1. **Enhanced ConnectionState** (issue 309): Add error reason text to the existing full-panel ConnectionState component for `failed`, `disconnected`, and `reconnecting` states.
2. **Per-service status indicators** (issue 190): Replace the single sidebar status dot with a multi-dot row showing all four services, with tooltips for detail.
3. **Unified service status model**: A React context (`useServiceStatus`) provides a single source of truth for all service statuses and errors.

## Data Model

```ts
type ServiceName = 'voice' | 'chat' | 'server' | 'livekit';

type ServiceState = 'connected' | 'connecting' | 'disconnected' | 'unavailable';

type ServiceStatus = {
  state: ServiceState;
  error?: string;   // last error message, cleared on new connect attempt
  label?: string;   // e.g. "mumble.example.com:64738"
};

type ServiceStatusMap = Record<ServiceName, ServiceStatus>;
```

### Display Names

| Key | Display Name |
|-----|-------------|
| `voice` | Voice |
| `chat` | Chat |
| `server` | Brmble |
| `livekit` | Screenshare |

### Default States

| Service | Initial State | Reason |
|---------|--------------|--------|
| Voice | `disconnected` | No connection attempted |
| Chat | `unavailable` | Depends on voice credentials |
| Brmble | `unavailable` | No server URL configured |
| Screenshare | `unavailable` | Feature under development |

### Error Lifecycle

- Set when `*.error` bridge message arrives or exception is caught
- Cleared when service transitions to `connecting` (new attempt clears old error)
- Persists through `disconnected`/`failed` so the UI can display it

## React Architecture

### `useServiceStatus` Context

A React context provides:
- `statuses: ServiceStatusMap` (read-only current state)
- `updateStatus(service: ServiceName, update: Partial<ServiceStatus>)` (state updater)

The existing `connectionStatus` state in App.tsx is replaced by `statuses.voice.state`. Components that consumed `connectionStatus` now read from the context.

### Status Sources

| Service | Source | Mechanism |
|---------|--------|-----------|
| Voice | Bridge messages | `voice.connected`, `voice.disconnected`, `voice.error`, etc. |
| Chat | Matrix JS SDK | Sync state events from `useMatrixClient` |
| Brmble | HTTP polling | New `useServerHealth` hook polls `/health` endpoint |
| Screenshare | Hardcoded | Initially `unavailable`; updated when LiveKit feature lands |

## UI Components

### Enhanced ConnectionState (issue 309)

New optional prop: `errorMessage?: string`

When set and the state is `failed`, `disconnected`, or `reconnecting`, display the error below the subtext:

```
      [Brmble Logo]

    Connection Failed

  Could not connect to server

  "Connection refused to mumble.example.com:64738"

     [Back to Server List]
```

Error text styling: `--accent-danger-text` color, `--font-mono` font, `--text-sm` size.

The reconnecting panel also shows the previous error for context:

```
      [Brmble Logo - heartbeat]

       Reconnecting...

  Attempting to restore connection

  "Process error: Connection reset by peer"

          [Cancel]
```

### Sidebar Multi-Dot (issue 190)

Replace the single status dot + text with a row of four 8px dots:

```
  Server Name
  ● ● ● ○
```

Visual rules:
- `connected`: `--status-connected` (green), solid
- `connecting`: `--accent-secondary`, blink animation
- `disconnected`: `--accent-primary` (red), solid
- `unavailable`: `--text-muted` at 40% opacity (gray), solid

Each dot has a `<Tooltip>` showing service name and status:
- "Voice: Connected"
- "Chat: Disconnected — Sync failed"
- "Brmble: Connected"
- "Screenshare: Unavailable"

If a service has an error, the tooltip includes it after the state.

## Backend / Bridge Changes

### C# Fixes (MumbleAdapter)

1. **Validation errors (lines 112-128):** After sending `voice.error`, also send `voice.disconnected` so the frontend doesn't get stuck in `connecting` state.

2. **`Reject` and `PermissionDenied` (lines 2048-2063):** Add `NotifyUiThread()` calls so error messages are delivered promptly.

3. **Credential fetch failure (line 1104-1107):** Send `voice.error` instead of only `Debug.WriteLine` so the frontend knows about Matrix credential failures.

### No New Bridge Message Types

- Matrix runs client-side (JS SDK) — status comes from SDK events
- Server health is polled from JS — no bridge involvement
- LiveKit is initially hardcoded — no bridge involvement
- Credential fetch failure uses existing `voice.error` (it's triggered by the voice service flow)

## Out of Scope

- Toast notifications for mid-session errors (future enhancement)
- Service-specific action buttons in sidebar (e.g., "Reconnect Chat")
- Expandable service details panel
