# LiveKit Token Refresh And Revocation Design

**Date:** 2026-05-11
**Status:** Implemented. This completes the remaining E2 token lifecycle hardening scope for issue `#354`; phase F is the next LiveKit roadmap focus.

## Context

Issue #354 tracks the remaining E2 token lifecycle hardening work. The E1 access-control foundation is already in place: LiveKit token requests are scoped by access mode and authorized against the caller's current Mumble channel membership. The first E2 pass added shorter expiry metadata, rate limiting, and duplicate-start protection.

The remaining gap is active access. A user who already joined a LiveKit room should be removed promptly when their voice/channel authorization changes, and valid users should refresh access before token expiry without dropping an active share or watch session.

This design has landed. Manual two-client validation covered share/watch, viewer leave, sharer leave, viewer move, sharer move, reconnect after viewer disconnect, reconnect after sharer disconnect, and preservation of valid share sessions. The untested manual scenario is the three-client case where one viewer is revoked while another viewer continues watching; this is covered by the design and automated tests and remains useful for broader manual regression passes.

## Goals

- Refresh LiveKit tokens before expiry for active share/watch sessions.
- Keep valid active sessions alive across token rotation.
- Remove affected LiveKit participants early when they disconnect, leave voice, move channel, are kicked/banned, or lose channel permission.
- Re-authorize refresh/token requests using current Mumble session and channel membership.
- Preserve other valid participants in the same LiveKit room.
- Add tests for refresh timing, refresh failure cleanup, and revocation events.

## Non-Goals

- Do not tear down an entire LiveKit room when only one participant loses access.
- Do not add persisted LiveKit session state; in-memory bookkeeping is sufficient for active server process state.
- Do not attempt to cryptographically revoke an already-issued JWT. LiveKit JWTs remain bearer tokens until expiry; early revocation is implemented by removing active participants and denying future tokens.
- Do not automatically restart browser screen capture after a disconnect. A reconnect creates a fresh authorization path, but sharing requires client-side capture to be started again intentionally.

## Chosen Approach

Use participant-scoped revocation plus client token refresh.

The server records active LiveKit participant bookkeeping when it issues a token. This record is not an authorization source; it only answers, "which LiveKit identities may need to be removed if this Mumble session or user loses access?" Authorization continues to come from `ISessionMappingService` and `IChannelMembershipService`.

When Mumble lifecycle events show that a user no longer belongs in a voice channel, the server removes only that user's LiveKit participant identity from affected rooms. If that user was publishing, the existing screen-share tracker is stopped and `screenShare.stopped` is broadcast. If the user was only watching, no share stop event is emitted; the affected client is disconnected from LiveKit while publishers and other valid viewers continue.

The React screen-share hook stores the active room, access mode, and `expiresAt` from token responses. It schedules a refresh before expiry. A successful refresh keeps the authorization lease current. A failed refresh means the current LiveKit session is no longer safely authorized, so the hook disconnects from the room and cleans local share/watch state using the existing interruption paths.

## Server Components

### LiveKit Participant Tracker

Add a small singleton service for active participant bookkeeping. Each record should include:

- `roomName`
- `matrixUserId`
- `userId`
- `sessionId`
- `accessMode`
- `expiresAt`

The tracker should support:

- Upsert on token issuance.
- Remove by room and participant identity when a local client disconnects cleanly.
- Find and remove all records for a session when the Mumble session disconnects.
- Find and remove records for a session that no longer match the current channel room after a move.
- Prune expired records opportunistically.

This tracker should be deliberately small and in-memory. If the server restarts, existing LiveKit participants may remain until token expiry or LiveKit detects disconnects; this is acceptable for the current hardening phase because token TTL remains short.

### Token Endpoint

`/livekit/token` already validates the certificate, resolves the user, parses `roomName` and `accessMode`, and authorizes against current Mumble channel membership. After successful token metadata generation, it should record the active participant in the tracker using the current session id and returned `expiresAt`.

Refresh requests should use the same endpoint and same authorization rules. No special refresh endpoint is required.

### Mumble Lifecycle Revocation

On user disconnect:

- Look up the old session mapping before removing it.
- Stop and broadcast active shares for that user, as current code already does.
- Remove the user's LiveKit participant identity from every tracked room for that session, including viewer-only records.
- Remove session and channel membership after revocation bookkeeping is captured.

On user channel move:

- Capture the previous channel before updating membership.
- Update the membership to the new channel.
- For tracked LiveKit participant records on that session, keep records matching the new `channel-<id>` room and revoke records for any other room.
- For revoked publish records, stop and broadcast the screen share.
- For revoked subscribe records, only remove the LiveKit participant.

On kick/ban/leave voice:

- These flow through Mumble disconnect/session removal in the current server callback path, so they should use the same session revocation path.

On permission loss without a move/disconnect:

- If the server receives a channel/user state event that makes current channel authorization false, revoke the affected participant records using the same helper as channel move.
- If the current Mumble integration cannot observe fine-grained ACL changes yet, the token endpoint still denies future refreshes once membership/permission checks fail. Early participant removal for ACL-only changes can be added where that event source becomes available.

## Client Refresh Flow

`useScreenShare` should treat `expiresAt` as an authorization lease for the current LiveKit room connection.

After connecting with a token:

- Store the active `roomName`, effective `accessMode`, and `expiresAt`.
- Schedule refresh before expiry, with a safety window rather than waiting until the last moment.
- If the room is upgraded from subscribe to publish, replace the stored lease with the publish lease.
- Clear the timer on room disconnect, local cleanup, component unmount, and superseded room requests.

On refresh success:

- Update the stored expiry and schedule the next refresh.
- Keep the existing LiveKit room connected.

On refresh failure:

- Invalidate the room lifecycle.
- Disconnect the LiveKit room.
- If sharing, stop local share with an interruption/error reason.
- Clear watched shares and pending viewer attempts.
- Surface a concise error so the UI can indicate that LiveKit access could not be renewed.

The LiveKit client SDK may not need the new token injected into an already-connected room for the immediate connection to stay alive, but the refresh is still useful because it revalidates authorization before expiry and detects permission loss promptly. If the SDK exposes a supported token-update API in the installed version, the implementation can use it; otherwise, the refreshed token is treated as a renewed server-side authorization lease.

## Reconnect Behavior

A reconnect is a fresh authorization path.

If a user disconnects while sharing, the server removes their old LiveKit participant, stops their tracked share, and broadcasts `screenShare.stopped`. When the user auto-reconnects to Mumble, they receive a new session id. If they land back in the same voice channel, future token requests are valid again, but the old screen capture is not automatically resumed.

If a user disconnects while watching, the server removes only their LiveKit participant. The publisher and other viewers remain connected. When the user reconnects and is back in the same voice channel, discovery can find the existing share and the client can request a fresh subscribe token to watch again.

## Testing

Server tests should cover:

- Token issuance records participant bookkeeping with room, identity, session, mode, and expiry.
- Disconnect revokes all tracked participant records for the old session, including viewer-only records.
- Channel move revokes records for the previous channel but preserves records for the new channel.
- Publishing revocation stops tracker state and broadcasts `screenShare.stopped`.
- Viewer revocation removes the participant without broadcasting a share stop.
- Expired tracker records are pruned and are not revoked repeatedly.

Client tests should cover:

- Refresh is scheduled before `expiresAt`.
- Refresh success schedules the next refresh without disconnecting the room.
- Refresh failure disconnects and clears share/watch state.
- Pending refresh timers are canceled when the room disconnects or a room request is superseded.

## Risks And Constraints

- LiveKit JWTs cannot be revoked after issuance, so short TTL plus participant removal is the practical enforcement model.
- In-memory participant tracking is process-local. A server restart may lose revocation bookkeeping for already-connected participants, but short token TTL and LiveKit disconnect behavior limit exposure.
- Browser capture should not be auto-restarted after revocation or reconnect because that would surprise users and may violate browser capture expectations.
- Permission-loss events are only as complete as the Mumble event sources available to the server. Future ACL event integration can reuse the same participant revocation helper.
