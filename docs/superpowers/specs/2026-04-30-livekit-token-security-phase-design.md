# LiveKit Token & Security Phase Design

**Date:** 2026-04-30
**Status:** Implemented. E1 and E2 have landed, including token refresh before expiry and participant-scoped early revocation for observed voice lifecycle changes.
**Scope:** Historical design for the LiveKit security phase split into `E1: Access Control Foundation` and `E2: Token Lifecycle Hardening`.

## Overview

Brmble's current LiveKit screenshare stack is functionally working, but the security model is still incomplete. Tokens are too coarse, some discovery paths are insufficiently protected, and long-lived access is not tightly tied to current channel membership and permission state.

This design defines the next LiveKit phase as a focused security project, not a general reliability or UX wave. The phase is intentionally split into two sub-phases so Brmble can first make watch/publish authorization correct, then make that access durable, revocable, and resistant to abuse.

One product clarification is important: share discovery metadata and share watch permission are not the same thing. Brmble should allow authenticated users to see who is currently sharing, including across channels, while still restricting actual watch access to the correct channel membership context.

## Goals

- Make the server the single authority for LiveKit publish and subscribe permissions while keeping share discovery as authenticated visibility metadata.
- Separate publisher and viewer access through explicit token scoping.
- Tie actual LiveKit watch/publish access to actual channel membership and permission state rather than room-name knowledge.
- Add short-lived token lifecycle controls and abuse resistance. E2 includes shorter token expiry metadata, targeted rate limiting, duplicate-start suppression, token refresh before expiry, and participant-scoped early revocation.
- Include one tiny client-side guardrail that prevents duplicate share-start attempts during the token/connect path.

## Non-Goals

- Auto-reconnect, crash recovery, or broader connection hardening from roadmap phase `F`.
- TURN/ICE hardening beyond the existing groundwork already in the codebase.
- General viewer or broadcaster UX improvements unrelated to auth/token correctness.
- Service-status redesign.
- Broader screenshare flow polish outside the duplicate-start guardrail.

## Phase Structure

### E1. Access Control Foundation

`E1` establishes the access model. It answers who is allowed to discover active shares as product metadata, who is allowed to subscribe as a viewer, and who is allowed to publish as a sharer.

Deliverables:

- auth on `GET /livekit/active-share`
- room-level permission checks tied to actual channel permissions for watch/publish actions
- explicit token scoping for `publish` vs `subscribe`
- server-side decision rules for publish and subscribe access, with authenticated discovery kept separate

### E2. Token Lifecycle Hardening

`E2` builds on `E1` by controlling duration, abuse resistance, token rotation, and active-session revocation. It does not invent new authorization rules; it only enforces and maintains the access model established in `E1`.

Deliverables:

- short-lived token expiry metadata
- rate limiting on relevant LiveKit endpoints
- one tiny duplicate-start guardrail during the LiveKit auth/connect path
- token rotation before expiry
- early revocation on kick, leave, or permission loss

## Core Design

The core boundary is:

- `E1` decides **who is allowed**
- `E2` decides **how long access remains valid and how abuse/failures are contained**

This is the smallest decomposition that still feels architectural rather than arbitrary. It also gives Brmble a clean first ship: LiveKit access rules become correct before the token/session lifecycle becomes more sophisticated.

## Authorization Model

The server should be the single authority for every LiveKit watch/publish action. For each relevant request, the server evaluates:

- who the user is
- which room/channel they are targeting
- whether they are currently allowed in that channel
- whether they are requesting `publish` or `subscribe` access
- whether that requested action matches their current permission level

This model applies consistently to:

- `POST /livekit/token`
- share-start/share-stop validation paths where they still depend on server-side state

`GET /livekit/active-share` remains authenticated, but it should be treated as discovery metadata rather than as the same permission gate used for watch access.

Recommended behavior:

- `active-share` requires the same authenticated identity model already used by the other LiveKit endpoints
- `active-share` returns current share metadata to authenticated known users even if they are not in the sharer's channel
- token requests must declare intended access mode: `publish` or `subscribe`
- the server issues a token with only the grants required for that mode
- the server refuses publish tokens if the user is not allowed to share in that channel
- the server refuses subscribe tokens if the user is not allowed to view that channel's shares
- room names remain channel-derived, but watch/publish access is checked against current channel membership/permissions rather than simply trusting room-name knowledge

## Data Flow

### E1 request flow

1. Client requests `active-share` or `token`
2. Server authenticates the client identity
3. For `active-share`, server returns current share metadata for authenticated known users
4. For `token`, server resolves the user's current channel/membership/permission state
5. Server validates the requested watch/publish action against that state
6. Server either rejects the request or returns the scoped token/result

This means share discovery remains visible product metadata, while publish and subscribe flow through the stricter server-side access rules.

### E2 lifecycle flow

1. Server issues shorter-lived tokens
2. Server returns expiry metadata so the client flow is rotation-ready
3. Rate limiting constrains repeated token/discovery abuse
4. The duplicate-start guard prevents overlapping share-start/token-connect attempts on the client
5. The client refreshes tokens before expiry for active share/watch sessions
6. The server tracks active LiveKit participants and removes affected identities when observed voice lifecycle events revoke access
7. Revocation uses retrying participant removal to cover transient LiveKit API failures and join-after-revoke timing windows

The lifecycle layer should not create a second set of rules. It only maintains and enforces the access model defined by `E1`.

## Endpoint Design

### `GET /livekit/active-share`

- Require the same certificate-based identity validation used by the other LiveKit endpoints.
- Reject unauthenticated or unknown-cert callers with `401`.
- Return current share metadata to authenticated known users, including shares from other channels.
- This endpoint is discovery-only and must not be treated as watch authorization.

### `POST /livekit/token`

- Require the request to explicitly declare requested access mode.
- Supported modes:
  - `publish`
  - `subscribe`
- Server maps mode to LiveKit grants with least privilege.
- Server validates the caller's current room/channel permission before issuing the token.
- Publish-capable tokens should never be issued to users who only have viewer-level access.

### Rate-limited LiveKit endpoints

At minimum, rate limiting should cover:

- token issuance
- active-share discovery
- any other LiveKit endpoint whose repeated use can leak data or create avoidable backend load

The rate limiter should be scoped narrowly enough to protect these endpoints without becoming a general transport redesign.

## Token Lifecycle Design

### Token scoping

- Viewer tokens are subscribe-only.
- Sharer tokens may include publish capability and only the minimum subscribe capability required for the current architecture.
- The server, not the client, decides which grant set applies.

### Token rotation

- Tokens should become short-lived enough that long-lived unauthorized access is materially reduced.
- The client uses expiry metadata to refresh active LiveKit authorization before expiry.
- Refresh failure is treated as access loss and tears down the affected share/watch session.

### Early revocation

- Access should end early when the user is kicked, leaves the channel, or loses the relevant permission.
- Revocation should be tied to the same server-side source of truth used for token issuance.
- A revoked session should be treated as access loss, not as a generic network failure.
- Active participant identities should be removed without tearing down unrelated valid participants in the same LiveKit room.
- Revocation attempts should be retried briefly because a token can be issued just before voice lifecycle revocation and the participant may join after the first removal attempt.

## Tiny Guardrail

One small client-side guardrail is included in scope:

- if LiveKit is already in the token/connect path for starting a share, a second share-start trigger should be ignored
- no duplicate token request
- no duplicate room connect attempt

This is included only because it directly protects the E-phase auth/token path from duplicated in-flight requests. It is not intended to pull broader UX or reliability work from phase `F` into this spec.

## Error Handling

Security failures should be explicit and non-misleading.

### Unauthenticated request

- return `401`
- do not fall back to anonymous share discovery or token issuance

### Authenticated but unauthorized watch/publish request

- return `403`
- use this for wrong channel, missing permission, or requesting publish access when only subscribe access is allowed

### Discovery failure

- distinguish transport/server failure from authoritative empty state
- do not silently collapse every failure into `shares: []`
- a successful empty discovery response may clear share badges, but a failed discovery request should remain diagnosable

### Rate-limited request

- return `429`
- include enough detail for diagnostics/logging while keeping user-facing copy simple

### Revoked or expired token during active session

- treat this as access loss rather than generic transport failure
- stop sharing/viewing cleanly
- surface a permission/session-ended message instead of a misleading network-error message

### Duplicate start while already connecting

- second trigger is a no-op
- no second token request
- no second connect attempt

Logging should distinguish:

- auth failure
- permission denial
- rate-limit hit
- token refresh failure
- early revocation path

Keeping those separate prevents future `F`-phase reconnect work from being polluted by what are actually access-control failures.

## Testing Strategy

### E1 tests

- `active-share` rejects unauthenticated callers
- `active-share` returns visible share metadata for authenticated users even when they are outside the sharer's channel
- viewer token request returns subscribe-only grants
- sharer token request returns publish-capable grants only when allowed
- publish request is rejected when the user lacks share permission
- subscribe request is rejected when the user lacks view permission
- room/channel mismatch is rejected
- permission changes are enforced from server-side source of truth rather than cached client assumptions

### E2 tests

- short-lived token metadata is returned with an expiry timestamp
- rate limiting blocks repeated token/discovery abuse
- duplicate-start guard suppresses a second in-flight share-start request
- token refresh occurs before expiry without dropping a valid session
- expired token without refresh ends access cleanly
- kick, leave, or permission loss revokes active access
- viewer-only revocation removes only the affected participant and does not broadcast share stop
- publisher revocation stops tracker state and broadcasts share stop
- failed or early participant removal is retried

### Manual verification

- normal share start
- normal viewer join
- connect late and still see the existing share badge
- remain in another channel and still see that a user is sharing
- user kicked while sharing
- user kicked while viewing
- permission removed mid-session
- repeated rapid share button presses
- repeated token endpoint hits

## Open Issue Mapping

Core roadmap/issue alignment:

- `#349` auth on `/livekit/active-share`
- `#351` rate limiting on relevant endpoints
- `#354` early revocation gap

Adjacent guardrail in scope:

- `#359` duplicate-start protection while LiveKit is connecting

Still out of scope for this spec:

- `#380` independent non-voice reconnect

## Risks

- If discovery and watch authorization are conflated, the product will hide useful share metadata even when the user is supposed to see that someone is sharing.
- If room/channel permission rules are underspecified, the token model may become inconsistent between discovery, viewing, and sharing.
- If rotation is introduced before access rules are stable, bugs become harder to diagnose because lifecycle and authorization failures look similar.
- If revocation relies on stale client-side assumptions rather than server-side authority, kicked or moved users may retain access longer than intended.
- If the tiny guardrail grows beyond duplicate-start suppression, the spec will begin to drift into broader UX/reliability work.

## Success Criteria

- LiveKit discovery is authenticated and visible to known users across channels.
- LiveKit token issuance is authenticated and permission-checked server-side.
- Viewer and sharer tokens are scoped to least privilege.
- Active access is limited by short-lived token metadata and prepared for future refresh/revocation work.
- Repeated token/discovery abuse is constrained by rate limiting.
- Duplicate share-start attempts do not create overlapping token/connect requests.
- The phase remains security-focused and does not absorb the broader `F` reconnect/reliability work.
