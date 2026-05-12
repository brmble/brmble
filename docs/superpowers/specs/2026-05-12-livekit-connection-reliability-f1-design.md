# LiveKit Connection Reliability F1 Design

**Date:** 2026-05-12
**Status:** Approved design
**Roadmap phase:** F. Connection & Reliability, first slice

## Context

The E. Token & Security phase is implemented. It added scoped LiveKit tokens, token refresh, endpoint rate limiting, active participant tracking, and participant revocation on Mumble disconnects, kicks, bans, and channel moves. That work made authorization and revocation safe enough that F should not reintroduce persisted share recovery unless there is a clear user benefit.

The remaining reliability gap is service-level resilience. The native client already has independent WebSocket retry and health polling for the Brmble API, and LiveKit token requests retry transient failures. However, the frontend does not receive a clear non-voice service connection state, does not consistently clear stale LiveKit UI when those services become unavailable, and does not always rediscover active shares after service reconnect. Issue `#380` is the first F priority: reconnect non-voice services independently when Mumble stays connected.

## Goals

- Address issue `#380` by treating Brmble API/WebSocket/LiveKit support paths as reconnectable non-voice services that can recover without restarting Mumble.
- Keep Mumble voice connected when only Brmble API/WebSocket/LiveKit support paths drop.
- Surface explicit non-voice service connection state from the native client to React.
- Clear stale watched-share and active-share UI when LiveKit support becomes unavailable or its state can no longer be trusted.
- Re-run active-share discovery after non-voice service reconnect so the UI reflects current server state.
- Notify viewers when a watched share ends unexpectedly instead of silently removing the tile.
- Document that share recovery is intentionally manual for F1.

## Non-Goals

- Do not implement connection quality indicators or graceful degradation. Those are F2 and cover roadmap items 36 and 37.
- Do not persist watched shares, publishing state, or LiveKit room state across client restarts.
- Do not recover Brmble server in-memory share state after a server process restart.
- Do not automatically restart browser screen capture after a publisher disconnect, token failure, or LiveKit room interruption.
- Do not auto-rejoin watched shares as a stored preference. Re-discovery can show active shares again, but watching remains a user action.
- Do not change TURN/ICE infrastructure in this slice. Existing groundwork remains as-is unless needed for reconnect cleanup tests.

## Chosen Approach

Use reconnect plus cleanup rather than state recovery.

The native client should own non-voice service connection state because it already manages the Brmble API health check, certificate-authenticated WebSocket connection, and certificate-authenticated LiveKit HTTP calls. It should emit bridge events when those support paths are connecting, connected, disconnected, and reconnecting. These events are separate from `voice.connected` and `voice.disconnected`; a WebSocket or API drop must not imply that Mumble voice has dropped.

React should treat the non-voice service state as the trust boundary for LiveKit UI. When the service becomes unavailable, React clears watched-share UI and stops treating active-share discovery as current. When the service reconnects, React requests active-share discovery for the current channel or the all-shares view. If a watched share disappears because the publisher stopped, was revoked, moved, or the service state was invalidated, React shows a concise notification such as `Alice's share ended` or `Alice's share ended unexpectedly` depending on whether the stop was explicit or caused by service loss.

This keeps F1 small and predictable: users can restart sharing or watching with one click, while the app avoids stale or misleading LiveKit state.

## Current Behavior To Preserve

- One LiveKit room is used per voice channel.
- Sharing requires explicit browser capture from the publisher.
- Watching requires explicit user action and may include up to four watched shares.
- Token refresh failure disconnects LiveKit and clears local share/watch state.
- Mumble lifecycle events revoke LiveKit participants and stop publisher shares when authorization changes.
- The Brmble WebSocket already reconnects with exponential backoff while the native client process is running.
- API health polling already emits `server.healthStatus` for general server status.

## Native Client Design

### Service State Model

Add a native-side service status event for Brmble non-voice services:

```text
brmble.serviceStatus
```

Payload:

```json
{
  "service": "api" | "websocket" | "livekit",
  "state": "connecting" | "connected" | "reconnecting" | "disconnected",
  "reason": "connection-lost",
  "attempt": 1,
  "delayMs": 1000
}
```

`reason`, `attempt`, and `delayMs` are included when the native client has concrete reconnect context; connected events can omit them. The initial implementation can use `websocket` as the primary trust signal for real-time share events and `livekit` for token/active-share HTTP failures. `api` can mirror health polling when useful, but UI cleanup should key off the service that affects LiveKit correctness.

### WebSocket Reconnect Events

`StartWebSocketConnection` should emit:

- `connecting` before the first connection attempt.
- `connected` after a successful WebSocket upgrade.
- `reconnecting` after a dropped connection before the backoff delay.
- `disconnected` only when the reconnect loop stops because the service was intentionally stopped or credentials/API URL are no longer available.

These events must not call `Disconnect()` and must not emit `voice.disconnected`.

### LiveKit HTTP Reliability

The existing `livekit.requestToken` retry loop should remain short and bounded. On transient failure after all retries, emit `brmble.serviceStatus` for `livekit` with `disconnected` or `reconnecting` depending on whether another retry loop is active. The frontend can use the existing `livekit.tokenError` for request-specific failures and the service status event for broader UI trust.

`livekit.checkActiveShare` should emit a service status failure when active-share discovery cannot reach the API. A later successful token or active-share request should emit `livekit` `connected`.

## React Design

### Service Status State

React should subscribe to `brmble.serviceStatus` and store a small connection-state map keyed by service. This state is distinct from the existing voice connection status.

The LiveKit UI should treat these conditions as unavailable:

- WebSocket service is reconnecting or disconnected.
- LiveKit service is disconnected after token or active-share failures.
- API health is disconnected and no WebSocket connection is available.

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

The notification should be concise and reuse the existing notification/toast queue patterns. It should not block reconnect or discovery.

## Server Design

No new persisted server recovery is needed for F1.

The server keeps `ScreenShareTracker` and `LiveKitParticipantTracker` in memory. If the Brmble server process restarts, active share records are lost. Existing LiveKit participants may remain until LiveKit disconnects them or their tokens expire. This is acceptable for F1 because:

- Tokens are short-lived and refresh requests re-authorize against current Mumble membership.
- Reconstructing share state from LiveKit participants could make stale or unauthorized shares look valid.
- Restarting sharing or watching is lightweight and explicit.

Server work for F1 should be limited to ensuring existing endpoints return clear failures and that active-share discovery remains the source of truth after reconnect.

## Error Handling

- Service reconnect failures should not spam user-visible toasts on every retry.
- User-visible notifications should appear for meaningful state changes: watched share ended, LiveKit support unavailable, or reconnect restored.
- Request-specific errors such as token denial should continue through existing `livekit.tokenError` handling.
- Authorization failures must remain hard failures. Do not retry 4xx token or active-share responses as transient service outages.
- Cleanup should be idempotent because WebSocket drops, LiveKit room disconnects, token failures, and React channel switches can race.

## Testing Strategy

### Native Client Tests

- WebSocket connect emits `brmble.serviceStatus` `websocket:connected` after a valid upgrade.
- WebSocket read failure emits `websocket:reconnecting` and continues without emitting `voice.disconnected`.
- Intentional voice disconnect stops WebSocket reconnect and emits a terminal service status.
- LiveKit token request transient failures keep existing bounded retries.
- LiveKit token request final failure emits both request-specific `livekit.tokenError` and service status for LiveKit.
- Successful LiveKit token or active-share request marks LiveKit service connected again.

### React Tests

- `brmble.serviceStatus` WebSocket reconnecting clears watched shares and disconnects the LiveKit room without changing voice connection state.
- A transition back to connected triggers active-share discovery for the current channel.
- The all-shares view requests all active shares after reconnect.
- An explicit `livekit.screenShareStopped` event for a watched share shows a normal ended notification.
- A LiveKit room disconnect or service-loss cleanup for a watched share shows an unexpected-ended notification.
- Manual viewer disconnect does not show a share-ended notification.

### Server Tests

- Existing active-share endpoint tests continue to verify authentication and current tracker state.
- No new persistence tests are required because F1 intentionally does not recover server process state.

## Manual Validation

- Connect to a Brmble server, join voice, and start watching a share.
- Temporarily interrupt the Brmble WebSocket/API path while Mumble stays connected.
- Confirm voice remains connected.
- Confirm watched-share UI clears and does not show stale video.
- Restore the API path and confirm active-share discovery refreshes the sidebar/current channel state.
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
- The frontend receives explicit non-voice service status events.
- LiveKit UI does not show stale watched or active shares while service state is untrusted.
- Active-share discovery runs automatically after service reconnect.
- Watched viewers get clear normal or unexpected share-ended notifications.
- F2 remains clearly scoped to connection quality indicators and graceful degradation.
