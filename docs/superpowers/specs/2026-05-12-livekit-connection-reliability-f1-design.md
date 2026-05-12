# Non-Voice Service Connection Reliability F1 Design

**Date:** 2026-05-12
**Status:** Approved design
**Roadmap phase:** F. Connection & Reliability, first slice
**Primary issue:** `#380` reconnect non-voice services independently when Mumble stays connected

## Context

The E. Token & Security phase is implemented. It added scoped LiveKit tokens, token refresh, endpoint rate limiting, active participant tracking, and participant revocation on Mumble disconnects, kicks, bans, and channel moves. That work made authorization and revocation safe enough that F should not reintroduce persisted share recovery unless there is a clear user benefit.

The remaining reliability gap is service-level resilience. Issue `#380` covers three non-voice services that can fail while Mumble voice stays connected:

- Brmble server auth/session tracking.
- Matrix chat channel and DM messaging.
- Screen share WebRTC and supporting LiveKit endpoints.

The native client already has independent WebSocket retry and health polling for the Brmble API, and LiveKit token requests retry transient failures. Matrix also has SDK sync state, but the app does not have a unified reconnect story across these non-voice services. The frontend does not receive clear service-state events for every affected path, does not consistently expose per-service reconnect state in status dots, and does not always refresh credentials, session mappings, chat sync, or active share discovery after service reconnect.

## Goals

- Address issue `#380` by treating Brmble server, Matrix chat, and screen share as reconnectable non-voice services that can recover without restarting Mumble.
- Keep Mumble voice connected when only Brmble server, Matrix chat, or screen share support paths drop.
- Surface explicit non-voice service connection state to React and the existing per-service status dots.
- Refresh Brmble server credentials/session mappings after Brmble API or WebSocket reconnect.
- Restart or refresh Matrix chat sync after credentials/API connectivity recovers.
- Clear stale watched-share and active-share UI when screen share support becomes unavailable or its state can no longer be trusted.
- Re-run active-share discovery after screen share support reconnects so the UI reflects current server state.
- Notify viewers when a watched share ends unexpectedly instead of silently removing the tile.
- Document that share recovery is intentionally manual for F1.

## Non-Goals

- Do not implement connection quality indicators or graceful degradation. Those are F2 and cover roadmap items 36 and 37.
- Do not persist watched shares, publishing state, or LiveKit room state across client restarts.
- Do not recover Brmble server in-memory share state after a server process restart.
- Do not automatically restart browser screen capture after a publisher disconnect, token failure, or LiveKit room interruption.
- Do not auto-rejoin watched shares as a stored preference. Re-discovery can show active shares again, but watching remains a user action.
- Do not change TURN/ICE infrastructure in this slice. Existing groundwork remains as-is unless needed for reconnect cleanup tests.
- Do not redesign Matrix rooms, DM creation, unread tracking, or message persistence.

## Chosen Approach

Use reconnect plus cleanup rather than state recovery.

The native client should own Brmble server transport state because it already manages the Brmble API health check, certificate-authenticated WebSocket connection, credential fetch, and certificate-authenticated LiveKit HTTP calls. React should own Matrix SDK sync state because the Matrix client lives in `useMatrixClient`. Both sides should report into the existing service-status model so the status dots can show which non-voice service is reconnecting.

React should treat service state as a trust boundary for each affected feature. Brmble server reconnect should refresh credentials and session mappings. Matrix reconnect should restart sync and reload active channel or DM timelines from the SDK/server. Screen share reconnect should clear stale watched-share state, re-run active-share discovery for the current channel or all-shares view, and show concise Brmble notifications when watched shares end.

This keeps F1 small and predictable: users can restart sharing or watching with one click, while the app avoids stale or misleading LiveKit state.

## Current Behavior To Preserve

- One LiveKit room is used per voice channel.
- Sharing requires explicit browser capture from the publisher.
- Watching requires explicit user action and may include up to four watched shares.
- Token refresh failure disconnects LiveKit and clears local share/watch state.
- Mumble lifecycle events revoke LiveKit participants and stop publisher shares when authorization changes.
- The Brmble WebSocket already reconnects with exponential backoff while the native client process is running.
- API health polling already emits `server.healthStatus` for general server status.
- `useMatrixClient` already maps Matrix SDK sync states to the `chat` service status.
- `server.credentials` already provides Matrix credentials, room maps, DM maps, and initial session mappings.

## Native Client Design

### Service State Model

Add or normalize a native-side service status event for Brmble-managed non-voice services:

```text
brmble.serviceStatus
```

Payload:

```json
{
  "service": "server" | "session" | "screenshare",
  "state": "connecting" | "connected" | "reconnecting" | "disconnected",
  "reason": "connection-lost",
  "attempt": 1,
  "delayMs": 1000
}
```

`reason`, `attempt`, and `delayMs` are included when the native client has concrete reconnect context; connected events can omit them.

Service meanings:

- `server`: Brmble API reachability, credential fetch, auth token availability, and health checks.
- `session`: Brmble WebSocket session tracking, user mapping snapshots, share started/stopped broadcasts, and Brmble-client activation events.
- `screenshare`: LiveKit token requests, active-share discovery, share-start/share-stop endpoint calls, and local WebRTC room trust.

Matrix chat status should continue to report through the existing `chat` service status in React because the Matrix SDK runs in the web layer, not the native client.

### Brmble Server Credential Refresh

When `server` transitions from unavailable to connected while Mumble remains connected, the native client should fetch fresh Brmble credentials through the existing certificate-authenticated `/auth/token` flow. The refreshed payload should be sent through the existing `server.credentials` bridge event.

This refresh is needed because the Matrix access token, room maps, DM maps, and session mappings can become stale during an outage. It should not reconnect Mumble or require a voice reconnect.

### Session WebSocket Reconnect Events

`StartWebSocketConnection` should emit:

- `connecting` before the first connection attempt.
- `connected` after a successful WebSocket upgrade and receipt of a usable session snapshot.
- `reconnecting` after a dropped connection before the backoff delay.
- `disconnected` only when the reconnect loop stops because the service was intentionally stopped or credentials/API URL are no longer available.

These events must not call `Disconnect()` and must not emit `voice.disconnected`.

On reconnect, the WebSocket path should request or receive a fresh `sessionMappingSnapshot` so React can repair user Matrix IDs, Brmble-client markers, and share event routing without a voice reconnect.

### Screen Share HTTP Reliability

The existing `livekit.requestToken` retry loop should remain short and bounded. On transient failure after all retries, emit `brmble.serviceStatus` for `screenshare` with `disconnected` or `reconnecting` depending on whether another retry loop is active. The frontend can use the existing `livekit.tokenError` for request-specific failures and the service status event for broader UI trust.

`livekit.checkActiveShare` should emit a service status failure when active-share discovery cannot reach the API. A later successful token, share-start/share-stop, or active-share request should emit `screenshare` `connected`.

## React Design

### Service Status State

React should subscribe to `brmble.serviceStatus` and store or forward native service state into the existing `useServiceStatus` model. This state is distinct from the existing voice connection status.

Service mapping:

- Native `server` updates the Brmble server status dot.
- Native `session` updates the session-tracking/server-realtime status used by user mappings and share broadcasts.
- Native `screenshare` updates the screen-share status dot.
- Matrix SDK sync continues to update the `chat` status dot from `useMatrixClient`.

The screen-share UI should treat these conditions as unavailable:

- Session WebSocket service is reconnecting or disconnected.
- Screen-share service is disconnected after token, share endpoint, or active-share failures.
- Brmble server is disconnected and no session WebSocket connection is available.

### Brmble Server Reconnect Handling

When `server` reconnects:

- Accept fresh `server.credentials` and replace stale Matrix credentials.
- Update room maps and DM maps from the refreshed credentials.
- Keep Mumble voice state unchanged.
- Do not clear local chat history solely because credentials refreshed.

When `server` becomes unavailable:

- Mark dependent non-voice services as degraded if they cannot operate without the API.
- Keep existing Matrix messages visible, but block or fail new sends through existing error paths if the Matrix client cannot sync.
- Keep voice connected.

### Matrix Chat Reconnect Handling

When Matrix sync reports `RECONNECTING`, `ERROR`, or `STOPPED`, the `chat` status dot should show connecting or disconnected. When sync returns to `PREPARED` or `SYNCING`, it should show connected.

When refreshed credentials arrive after Brmble server reconnect:

- Recreate or refresh the Matrix client if the access token, homeserver URL, room map, or DM map changed.
- Let the Matrix SDK perform a fresh sync.
- Reload the active channel or DM messages from the Matrix SDK/server after sync is prepared.
- Preserve already-rendered local message history until fresh sync replaces or augments it.

### Cleanup On Service Loss

When LiveKit support becomes unavailable:

- Disconnect the current LiveKit room if one exists.
- Clear watched-share tiles and remote video elements.
- Clear focused-share state.
- Clear current active-share discovery results for the current scope.
- Keep `isSharing` consistent with the local LiveKit room state. If the local publisher room is interrupted, stop local share with the existing `interrupted` path.
- Do not call Mumble disconnect.

This cleanup should reuse existing `useScreenShare` interruption and disconnect paths rather than adding a second lifecycle system.

### Rediscovery On Service Reconnect

When WebSocket/LiveKit support transitions back to connected:

- Request active-share discovery for the current voice channel.
- If the user is on the server-root/all-shares view, request all active shares.
- Ignore stale discovery responses using the existing request id and baseline event version logic.
- Do not automatically watch previous shares. Users can click Watch again if the share is still active.

### Unexpected Share Notifications

When a watched share is removed, React should distinguish three cases:

- Manual viewer stop: no notification.
- Explicit `screenShare.stopped` event for a watched publisher: show `Alice's share ended`.
- Service loss, LiveKit room disconnect, token refresh failure, or track loss without a matching explicit stop event: show `Alice's share ended unexpectedly`.

The notification should be concise and reuse the existing Brmble notification queue patterns. It should not block reconnect or discovery.

## Server Design

No new persisted server recovery is needed for F1.

The server keeps `ScreenShareTracker` and `LiveKitParticipantTracker` in memory. If the Brmble server process restarts, active share records are lost. Existing LiveKit participants may remain until LiveKit disconnects them or their tokens expire. This is acceptable for F1 because:

- Tokens are short-lived and refresh requests re-authorize against current Mumble membership.
- Reconstructing share state from LiveKit participants could make stale or unauthorized shares look valid.
- Restarting sharing or watching is lightweight and explicit.

Server work for F1 should be limited to ensuring existing endpoints return clear failures and that active-share discovery remains the source of truth after reconnect.

## Error Handling

- Service reconnect failures should not spam user-visible notifications on every retry.
- User-visible notifications should appear for meaningful state changes: watched share ended, LiveKit support unavailable, or reconnect restored.
- Request-specific errors such as token denial should continue through existing `livekit.tokenError` handling.
- Authorization failures must remain hard failures. Do not retry 4xx token or active-share responses as transient service outages.
- Cleanup should be idempotent because WebSocket drops, LiveKit room disconnects, token failures, and React channel switches can race.

## Testing Strategy

### Native Client Tests

- Brmble API recovery fetches fresh credentials and emits `server.credentials` without reconnecting Mumble.
- WebSocket connect emits `brmble.serviceStatus` `session:connected` after a valid upgrade and usable snapshot.
- WebSocket read failure emits `session:reconnecting` and continues without emitting `voice.disconnected`.
- Intentional voice disconnect stops WebSocket reconnect and emits terminal non-voice service statuses.
- LiveKit token request transient failures keep existing bounded retries.
- LiveKit token request final failure emits both request-specific `livekit.tokenError` and `screenshare` service status.
- Successful LiveKit token or active-share request marks `screenshare` connected again.

### React Tests

- `brmble.serviceStatus` `session` reconnecting clears watched shares and disconnects the LiveKit room without changing voice connection state.
- `brmble.serviceStatus` `screenshare` disconnected clears watched shares and marks screen share unavailable.
- A `server.credentials` refresh updates Matrix credentials without clearing voice state.
- Matrix SDK reconnecting/error states update the `chat` status dot.
- Matrix SDK returning to prepared/syncing reloads active channel or DM messages.
- A screen-share transition back to connected triggers active-share discovery for the current channel.
- The all-shares view requests all active shares after reconnect.
- An explicit `livekit.screenShareStopped` event for a watched share shows a normal ended notification.
- A LiveKit room disconnect or service-loss cleanup for a watched share shows an unexpected-ended notification.
- Manual viewer disconnect does not show a share-ended notification.

### Server Tests

- Existing auth/session mapping and active-share endpoint tests continue to verify authentication and current tracker state.
- No new persistence tests are required because F1 intentionally does not recover server process state.

## Manual Validation

- Connect to a Brmble server, join voice, and start watching a share.
- Temporarily interrupt the Brmble WebSocket/API path while Mumble stays connected.
- Confirm voice remains connected.
- Confirm Brmble server/session status dots show reconnecting or disconnected.
- Restore the API path and confirm fresh credentials/session mappings arrive without reconnecting voice.
- Confirm Matrix chat status returns connected and active chat messages sync again.
- Confirm watched-share UI clears and does not show stale video.
- Confirm active-share discovery refreshes the sidebar/current channel state.
- Confirm the user must click Watch again to view an active share.
- Stop a watched publisher normally and confirm the viewer sees an ended notification.
- Drop the LiveKit room unexpectedly and confirm the viewer sees an unexpected-ended notification.

## Roadmap Updates

After implementation, update `docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md`:

- Mark item 34, auto-reconnect on drop, as partially implemented for service reconnect and UI cleanup, not persisted share recovery.
- Mark item 38, disconnect notification, as implemented for watched-share end notifications.
- Mark item 39, independent service reconnect, as implemented for issue `#380`.
- Leave item 35 TURN/ICE hardening as future unless separate work is done.
- Leave item 40 share state recovery as intentionally deferred or removed from near-term scope.
- Keep items 36 and 37 for F2.

## Risks And Constraints

- The native client currently has a large `MumbleAdapter`; F1 should avoid broad refactoring and add only focused helpers where necessary.
- Service state events can race with request-specific LiveKit events. React cleanup must be idempotent and generation-aware.
- Clearing UI on service loss may feel conservative, but it is safer than showing stale shares.
- Not recovering publisher state means a brief LiveKit failure can end a share. This is acceptable because automatic browser capture recovery is risky and surprising.
- Server restart recovery remains intentionally out of scope because reconstructing share state from LiveKit participants is less trustworthy than explicit user action.

## Success Criteria

- A Brmble API/WebSocket interruption does not disconnect Mumble voice.
- Brmble server credentials/session mappings refresh without a voice reconnect.
- Matrix chat reconnects or refreshes sync after server credentials/connectivity recover.
- The frontend receives explicit non-voice service status events for server, session, and screen-share paths.
- Screen-share UI does not show stale watched or active shares while service state is untrusted.
- Active-share discovery runs automatically after service reconnect.
- Watched viewers get clear normal or unexpected share-ended notifications.
- F2 remains clearly scoped to connection quality indicators and graceful degradation.
