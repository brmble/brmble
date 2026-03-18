# LiveKit Screen Share Viewer — Design Document

**Date:** 2026-03-06
**Scope:** Receive and view screen shares from other users via LiveKit

---

## Overview

Add screen share viewing to Brmble. When a user in a voice channel starts sharing their screen, all other users in that channel automatically see the stream in a split-panel view above the chat. This builds on the existing publish-only screen share (Phase 1).

## Decisions

- **Connection model:** On-demand — viewers only connect to LiveKit when a share is active
- **Token grants:** Single token type with `CanPublish = true` + `CanSubscribe = true` for all users
- **Notification:** Sharer's client notifies server → server broadcasts via WebSocket event bus
- **Active share tracking:** Server-side in-memory dictionary
- **Late joiners:** Users joining a channel with an active share auto-connect to the stream
- **UI placement:** ChatPanel splits horizontally — video on top, messages on bottom
- **Resizable:** Draggable divider between video and chat, position persisted in localStorage
- **Fullscreen:** Toggle button on hover over the video area
- **User list indicator:** Small screen icon next to the sharer's name in sidebar/channel tree

---

## Backend

### Token Grant Change

Update `LiveKitService.GenerateToken` to set both `CanPublish = true` and `CanSubscribe = true`. All users get a single token type that allows both sharing and viewing.

### Active Share Tracking (`ScreenShareTracker`)

New singleton service with an in-memory dictionary:

```
Dictionary<string, ScreenShareInfo> — roomName → { userName, matrixUserId }
```

Methods:
- `Start(roomName, userName, matrixUserId)` — register an active share
- `Stop(roomName)` — remove an active share
- `GetActive(roomName)` — return share info or null

### New Endpoints

**`POST /livekit/share-started`**
- Called by sharer's client after publishing
- Body: `{ roomName }`
- Authenticates via cert hash, resolves user
- Registers in `ScreenShareTracker`
- Broadcasts `screenShare.started` event via `BrmbleEventBus`

**`POST /livekit/share-stopped`**
- Called by sharer's client on stop
- Body: `{ roomName }`
- Removes from `ScreenShareTracker`
- Broadcasts `screenShare.stopped` event via `BrmbleEventBus`

**`GET /livekit/active-share?roomName=channel-{id}`**
- Called by frontend after joining a channel
- Returns `{ userName, matrixUserId }` if active share exists, or 404

### WebSocket Event Bus Messages

```json
{ "type": "screenShare.started", "roomName": "channel-4", "userName": "maui", "matrixUserId": "@2:noscope.it" }
{ "type": "screenShare.stopped", "roomName": "channel-4" }
```

---

## Frontend

### `useScreenShare` Hook Extensions

Extend the existing hook to handle both publishing and viewing:

**New state:**
- `activeShare: { roomName, userName } | null` — current active share in the channel
- `remoteTrack: RemoteTrack | null` — the received video track from the sharer

**Viewer flow:**
1. Listen for `livekit.screenShareStarted` / `livekit.screenShareStopped` bridge events
2. On `screenShare.started`: request token via bridge → join LiveKit room → subscribe → capture remote video track
3. On `screenShare.stopped`: disconnect from room → clear track
4. On channel change: call `GET /livekit/active-share?roomName=channel-{id}` to check for existing shares

**Updated exports:**
```typescript
{ isSharing, startSharing, stopSharing, error, activeShare, remoteTrack }
```

### `ScreenShareViewer` Component

New component rendered in the top half of the ChatPanel when `remoteTrack` is present.

**Props:** `track: RemoteTrack`, `sharerName: string`, `onClose: () => void`

**Features:**
- Attaches LiveKit video track to a `<video>` element via `track.attach()`
- Dark background (`--bg-deep`) while loading
- Sharer's name overlay (bottom-left, semi-transparent)
- Fullscreen toggle button (top-right, appears on hover)
- Cleans up track attachment on unmount

### ChatPanel Split Layout

When a screen share is active:
- ChatPanel splits horizontally — video on top, messages on bottom
- Draggable divider bar (~4px) between them with grab cursor
- Default split: 50/50
- Split position persisted in localStorage
- Smooth transition when share starts/stops (split expands/collapses)

### User List Screen Share Icon

- Small monitor icon (11x11px) next to the sharer's name
- Appears in both sidebar root users and ChannelTree user rows
- Uses `--accent-secondary` color
- Positioned alongside existing mute/deaf status icons

### App.tsx Wiring

- Pass `activeShare` to Sidebar/ChannelTree for the screen share icon
- Pass `remoteTrack` and `sharerName` to ChatPanel for the viewer
- Sharer's client calls `POST /livekit/share-started` after publishing and `POST /livekit/share-stopped` on stop

---

## C# Bridge Changes

### New Bridge Messages (MumbleAdapter)

**Outgoing (C# → JS):**
- `livekit.screenShareStarted` — forwarded from WebSocket event bus
- `livekit.screenShareStopped` — forwarded from WebSocket event bus

**Incoming (JS → C#):**
- `livekit.shareStarted` — sharer notifies server (POST to `/livekit/share-started`)
- `livekit.shareStopped` — sharer notifies server (POST to `/livekit/share-stopped`)
- `livekit.checkActiveShare` — check for active share on channel join (GET `/livekit/active-share`)

---

## Out of Scope

- Multiple simultaneous screen shares per channel
- Resolution/FPS configuration
- Hardware encoding selection
- Content hint switching (gaming vs desktop)
- Audio sharing (screen share audio track)
- Viewer count display
