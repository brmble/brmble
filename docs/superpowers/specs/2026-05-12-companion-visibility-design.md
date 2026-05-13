# Companion Visibility Design

**Date:** 2026-05-12  
**Status:** Approved  
**Goal:** Enable users to see each other's selected companions in voice channel overlays

## Problem Statement

Today, companion selection is only stored in the web client's settings. The overlay can render the local user's chosen companion, but remote users still fall back to proxy behavior because the rest of the voice stack does not know their real selection.

That creates the current mismatch:

- local settings know `myCompanion`
- the native voice client knows session, Matrix user ID, and Brmble-client status
- the Brmble server WebSocket distributes session-mapping updates
- none of those shared paths currently carry companion ownership

The result is that when user A speaks, user B sees user B's own companion acting as a proxy instead of user A's actual companion.

## Desired Behavior

When a user selects a companion, that choice should:

1. update the local overlay immediately
2. persist on the Brmble server for cross-device reuse
3. flow into the native voice client's user/session state
4. appear to other users in the same voice channel in real time

If the real companion is not known for a user, the existing proxy fallback should remain in place.

## Design Principles

- Reuse existing architecture instead of inventing a parallel voice-state protocol
- Keep `App.tsx` user state as the frontend source for remote-user companion data
- Keep overlay rendering logic focused on presentation, not bridge orchestration
- Use lowercase companion IDs everywhere: `bee`, `engineer`, `floppy`, `patch`, `pip`, `retro`
- Treat remote visibility as server-backed state, but allow local settings to remain immediately responsive

## Existing Architecture To Extend

The current implementation already has the right bones:

- the web app stores `overlay.myCompanion` in settings and localStorage
- the native client (`MumbleAdapter`) owns bridge handlers and Brmble API communication
- the Brmble server authenticates clients via certificate-backed `/auth/*` endpoints
- the Brmble server WebSocket pushes session-mapping changes to connected native clients
- the frontend already derives `companionsByUser` from `users` in `App.tsx`

This design extends those paths instead of adding a new `voice.channelState` protocol or a separate frontend context just for companion visibility.

## Source Of Truth

There are two related but different truths in this feature:

### Local preference

The selected companion in web settings remains the immediate local preference for the current device. Changing it should still update local settings right away so the user sees instant UI feedback.

### Shared remote visibility state

The Brmble server stores the companion that other clients should see for that user. This server value is what gets attached to session mappings and distributed to other channel members.

### Reconciliation rule

- When a live sync succeeds, local settings and server state match
- When a sync cannot run because the user is not connected to a Brmble-backed voice session, local settings still change locally and will be pushed on the next eligible connection
- If a live sync attempt fails while connected, the web client reverts to the previous local value so the user does not sit in a split-brain state during an active shared session

## Architecture

### 1. Database Schema

Add companion storage to the `users` table:

```sql
ALTER TABLE users ADD COLUMN companion_id TEXT DEFAULT 'bee';
```

Field details:

- Type: `TEXT`
- Default: `'bee'` to match the current frontend default
- Stored values: lowercase companion IDs only

Schema migration in `Database.cs` should follow the existing column-add pattern:

```csharp
var hasCompanionId = conn.ExecuteScalar<int>(
    "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='companion_id'");
if (hasCompanionId == 0)
    conn.Execute("ALTER TABLE users ADD COLUMN companion_id TEXT DEFAULT 'bee'");
```

`UserRepository` should expose:

```csharp
public async Task<string> GetCompanionId(long userId)
public async Task SetCompanionId(long userId, string companionId)
```

`GetCompanionId` should normalize null or unknown values back to `'bee'` so existing rows and bad legacy data do not leak invalid IDs into runtime state.

### 2. Server API

Add a dedicated authenticated endpoint alongside the existing `/auth/*` endpoints:

`POST /auth/companion`

Request:

```json
{
  "companionId": "floppy"
}
```

Success response:

```json
{
  "companionId": "floppy"
}
```

Failure responses:

- `400` for invalid companion IDs
- `401` for missing/unknown client certificate
- `500` for persistence failures

This endpoint should:

1. authenticate the caller from the client certificate
2. validate the submitted companion ID against the allowed lowercase set
3. persist the value through `UserRepository.SetCompanionId`
4. update the in-memory session mapping for the caller if they currently have an active Mumble session
5. broadcast a channel-scoped WebSocket event so connected channel members receive the new companion immediately

### 3. Session Mapping Model

Extend the server session-mapping model to carry companion data:

```csharp
public record SessionMapping(
    string MatrixUserId,
    string MumbleName,
    long UserId,
    string CompanionId,
    bool IsBrmbleClient = false);
```

And extend the native client cache similarly:

```csharp
internal record SessionMappingEntry(
    string MatrixUserId,
    string MumbleName,
    string CompanionId,
    bool IsBrmbleClient = false);
```

Companion data should be populated whenever the server creates or refreshes a mapping:

- auth response payload
- initial WebSocket snapshot
- `userMappingAdded` broadcasts for newly mapped users
- direct companion-change broadcasts

`ISessionMappingService` should gain one targeted update method for live changes:

```csharp
bool TryUpdateCompanionId(int sessionId, string companionId)
```

That avoids rebuilding unrelated session metadata when only the companion changes.

### 4. WebSocket Protocol

Do not add a new `voice.channelState` message. Reuse the existing Brmble WebSocket event stream and extend its payloads.

#### Extend `sessionMappingSnapshot`

```json
{
  "type": "sessionMappingSnapshot",
  "mappings": {
    "12345": {
      "matrixUserId": "@1:brmble.app",
      "mumbleName": "Alice",
      "companionId": "bee",
      "isBrmbleClient": true
    }
  }
}
```

#### Extend `userMappingAdded`

```json
{
  "type": "userMappingAdded",
  "sessionId": 12345,
  "matrixUserId": "@1:brmble.app",
  "mumbleName": "Alice",
  "companionId": "bee",
  "isBrmbleClient": true
}
```

#### Add `companionChanged`

```json
{
  "type": "companionChanged",
  "sessionId": 12345,
  "matrixUserId": "@1:brmble.app",
  "companionId": "floppy"
}
```

This event should be sent only to WebSocket clients whose authenticated user IDs are currently in the same Mumble channel as the changed session.

### 5. Native Bridge Protocol

The web app should keep talking to the native client through the bridge, and the native client should own all server communication.

#### Client -> native bridge

```json
{
  "type": "voice.setCompanion",
  "companionId": "floppy"
}
```

Handled by `MumbleAdapter.RegisterHandlers`.

#### Native -> web bridge: response

```json
{
  "type": "voice.setCompanionResponse",
  "success": true,
  "companionId": "floppy"
}
```

or

```json
{
  "type": "voice.setCompanionResponse",
  "success": false,
  "companionId": "bee",
  "error": "Invalid companion ID"
}
```

#### Native -> web bridge: remote live update

```json
{
  "type": "voice.companionChanged",
  "session": 12345,
  "matrixUserId": "@1:brmble.app",
  "companionId": "floppy"
}
```

### 6. Native Client Responsibilities

`MumbleAdapter` should become the single owner of companion sync between the web app and the Brmble server.

Responsibilities:

1. register a new `voice.setCompanion` handler
2. validate the lowercase ID before making any server call
3. if `_apiUrl` or client certificate is unavailable, return a failure response for live sync attempts
4. POST the change to `/auth/companion` using the same BouncyCastle TLS helper pattern already used for other authenticated endpoints
5. update `_sessionMappings` when a sync succeeds
6. emit `voice.setCompanionResponse`
7. parse WebSocket `companionChanged` messages and emit `voice.companionChanged`
8. include `companionId` in `voice.connected` and `voice.userJoined` payloads when known

### 7. Frontend Responsibilities

Do not move this logic into a new `BridgeContext` or a new overlay reducer. The current app structure already has the right ownership.

#### Settings flow

When the user changes `My Companion` in the settings UI:

1. `SettingsModal` still updates settings state and localStorage immediately
2. if the app is currently connected to a Brmble-backed voice session, the frontend also sends `voice.setCompanion`
3. wait for `voice.setCompanionResponse`
4. on failure, restore the previous `overlay.myCompanion` value and show an error notification

If the user is not currently in a Brmble-backed voice session, the change remains local only for now. The next eligible voice connection should trigger a reconciliation send so the server catches up.

#### Voice-state flow

Remote-user companion data should continue to flow through the existing `users` array in `App.tsx`.

That means:

- `User` in `App.tsx` gains `companionId?: CompanionId`
- `onVoiceConnected` stores `companionId` from each user payload
- `onVoiceUserJoined` stores `companionId` for newly seen users
- `onSessionMappingSnapshot` and `onUserMappingUpdated` should also merge `companionId` into existing users
- `onVoiceCompanionChanged` updates the matching user entry in place

The overlay should continue deriving `companionsByUser` from `users`, but now it should use the remote user's real `companionId` when present instead of hardcoding only the local user's companion.

#### Overlay model

`overlayModel.ts` does not need a new reducer action. The design should preserve its current responsibility:

- it receives already-shaped `companionsByUser`
- it decides whether to show the real companion or proxy fallback
- it remains presentation logic only

### 8. Reconciliation On Connect

The current design must support changes made while not connected to voice.

To do that, after the web app receives `voice.connected` for a Brmble-backed session, it should compare:

- local `overlay.myCompanion`
- the connected self user's `companionId` from the native payload

If they differ, the frontend should send `voice.setCompanion` once to reconcile the server to the local preference.

This keeps the feature simple:

- settings remain immediately editable at any time
- remote visibility stays server-backed
- no extra background sync service is required

Last write wins across devices.

### 9. Fallback Behavior

If a remote user has no known companion ID:

- keep proxy behavior
- render the local viewer's companion as the placeholder
- keep `isProxy: true`

If a remote user has a known companion ID:

- set `isProxy: false`
- render that real companion

If the local user changes companion and the live sync fails while connected:

- revert local settings to the previous value
- show an error notification
- do not leave the active session in a local-only divergent state

## Data Flow

### Live change during connected voice session

```text
User changes My Companion in settings
  ↓
SettingsModal updates local settings and localStorage
  ↓
Frontend sends voice.setCompanion to native client
  ↓
MumbleAdapter POSTs /auth/companion to Brmble server
  ↓
Server validates, persists, updates session mapping
  ↓
Server broadcasts companionChanged to same-channel WebSocket clients
  ↓
Native clients emit voice.companionChanged to their web UIs
  ↓
Each frontend updates users[session].companionId
  ↓
Overlay derivation rebuilds companionsByUser
  ↓
Overlays render the real companion
```

### Change made while not connected

```text
User changes My Companion in settings
  ↓
SettingsModal updates local settings and localStorage
  ↓
No live server sync runs yet
  ↓
Later, user connects to a Brmble-backed voice session
  ↓
Frontend compares local myCompanion with self companionId from voice.connected
  ↓
If different, frontend sends one reconciliation voice.setCompanion
  ↓
Server persists and broadcasts as normal
```

## Error Handling

- Invalid companion ID: reject before persistence, return failure response, revert local live change
- Missing `_apiUrl` or missing client certificate during live sync: return failure response, revert local live change
- Database write failure: return failure response, revert local live change, show user-facing error
- WebSocket broadcast failure: log and continue; the persisted value will still appear on later snapshots or reconnects
- Unknown or invalid stored DB value: normalize to `'bee'`

## Testing Considerations

### Manual scenarios

1. User A selects `floppy` while connected and user B in the same channel immediately sees `floppy`
2. User A changes from `bee` to `engineer` mid-session and other channel members update in real time
3. User changes companion while disconnected, reconnects later, and the server reconciles to the local setting
4. User connects from another device and sees the last persisted server-backed companion after sync
5. Non-Brmble client in channel still renders as proxy
6. Invalid companion ID is rejected and local live change is reverted
7. Simulated server write failure reverts the local live change and shows an error

### Code-level tests

- `Database.cs` migration test or initialization coverage for `companion_id`
- `UserRepository` tests for get/set and normalization behavior
- server endpoint tests for `/auth/companion`
- `SessionMappingService` tests for `TryUpdateCompanionId`
- `MumbleAdapter` tests for:
  - `voice.setCompanion` success
  - `voice.setCompanion` failure
  - WebSocket `companionChanged` parsing
  - `voice.connected` payload including `companionId`
- frontend tests for:
  - settings live revert on `voice.setCompanionResponse` failure
  - `users` state update on `voice.companionChanged`
  - overlay deriving real remote companion instead of proxy when `companionId` is present

## Implementation Components

### Database and server

- `src/Brmble.Server/Data/Database.cs`
- `src/Brmble.Server/Auth/UserRepository.cs`
- `src/Brmble.Server/Auth/AuthEndpoints.cs`
- `src/Brmble.Server/Events/ISessionMappingService.cs`
- `src/Brmble.Server/Events/SessionMappingService.cs`
- `src/Brmble.Server/Events/SessionMappingHandler.cs`
- `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs`
- `src/Brmble.Server/Events/BrmbleEventBus.cs`

### Native client

- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

### Frontend

- `src/Brmble.Web/src/App.tsx`
- `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`
- `src/Brmble.Web/src/components/CompanionOverlay/overlayTypes.ts`
- `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts`
- companion-overlay and settings tests near those files

## Success Criteria

- Users see the correct remote companions in the full overlay
- Companion selection persists through the Brmble server and survives reconnects/devices
- Same-channel users receive live companion changes without reconnecting
- The design reuses `voice.connected`, session-mapping updates, and the existing WebSocket pipeline instead of adding a parallel channel-state protocol
- Proxy fallback still works for users without known companion data
- Live sync failures do not leave active sessions in a split-brain state
