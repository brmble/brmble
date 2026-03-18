# LiveKit Screen Share — Design Document

**Date:** 2026-03-05
**Scope:** Publish-only screen sharing via LiveKit SFU

---

## Overview

Add screen sharing to Brmble using the LiveKit SFU already running in the container. Users can publish their screen from the voice controls bar. Viewing is out of scope for this phase.

## Decisions

- **Scope:** Publish-only (no viewer UI yet)
- **Token flow:** Dedicated `POST /livekit/token` endpoint (not bundled in `/auth/token`)
- **Room mapping:** 1:1 with Mumble channels / Matrix rooms (room name derived from channel ID)
- **UI placement:** Share Screen button in the UserPanel voice controls bar
- **SDKs:** `Livekit.Server.Sdk.Dotnet` (backend), `livekit-client` (frontend)
- **Routing:** LiveKit signaling proxied through YARP on port 8080 (`/rtc/*` → internal `:7880`)
- **No bridge involvement:** WebView2's Chromium engine handles screen capture natively

---

## Backend

### Configuration

New `LiveKitSettings` options class:

```csharp
public class LiveKitSettings
{
    public string ApiKey { get; set; }
    public string ApiSecret { get; set; }
    public string InternalUrl { get; set; } = "http://127.0.0.1:7880";
}
```

Bound from env vars: `LiveKit__ApiKey`, `LiveKit__ApiSecret`.

### Token Generation (`LiveKitService`)

- Receives cert hash + room name
- Resolves user identity from `UserRepository`
- Uses LiveKit SDK `AccessToken` to generate JWT:
  - Identity = user display name
  - Room = channel-derived room name
  - Grants: `canPublish = true`, `canSubscribe = false`
- Returns signed JWT

### Token Endpoint (`LiveKitEndpoints`)

```
POST /livekit/token
Body: { "roomName": "channel-123" }
Response: { "token": "jwt...", "url": "wss://server/rtc" }
```

- Extracts cert hash via `ICertificateHashExtractor` (same pattern as `AuthEndpoints`)
- Calls `LiveKitService.GenerateToken()`
- Returns token + public WebSocket URL

### YARP Route

Add LiveKit cluster and route alongside existing Continuwuity proxy:

- Route: `/rtc/{**catch-all}` → `http://127.0.0.1:7880/rtc/{**catch-all}`
- Supports WebSocket upgrade for LiveKit signaling
- WebRTC media (UDP) goes directly to exposed ports 50100-50200

### Docker Changes

`entrypoint.sh` additions:

```sh
export LiveKit__ApiKey="$LIVEKIT_API_KEY"
export LiveKit__ApiSecret="$LIVEKIT_API_SECRET"
```

No changes to `livekit.yaml`, `supervisord.conf`, or `docker-compose.yml`.

---

## Frontend

### `useScreenShare` Hook

Manages the screen sharing lifecycle:

- **`startSharing(roomName)`:**
  1. Fetch token from `POST /livekit/token`
  2. Create LiveKit `Room`, connect to WebSocket URL
  3. Call `room.localParticipant.setScreenShareEnabled(true)` (triggers browser screen picker)
  4. Update state: `isSharing = true`

- **`stopSharing()`:**
  1. Disable screen share track
  2. Disconnect from room
  3. Update state: `isSharing = false`

- **Exports:** `{ isSharing, startSharing, stopSharing, error }`

### UserPanel Button

New screen share button in `UserPanel.tsx`:

- Positioned between mute/deafen and DM buttons
- Monitor/screen SVG icon
- Active state when sharing
- Disabled when not connected to voice (no channel context)
- Click toggles start/stop sharing

### npm Package

`livekit-client` — official LiveKit JavaScript SDK

---

## Out of Scope

These will be addressed in future iterations:

- Viewing other users' screen shares
- Resolution/FPS configuration
- Hardware encoding selection (NVENC, QuickSync)
- Content hint switching (gaming vs desktop)
- Multiple simultaneous screen shares per channel
