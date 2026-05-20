# Design: Mumble ACL Support

**Date:** 2026-05-15
**Status:** Approved

## Overview

Implement full Mumble ACL support in Brmble so ACL administration works the same way as the original Mumble client. Mumble remains the only source of truth for ACL rules, groups, inheritance, and token-based access behavior. Brmble acts as a management client and synchronization layer: it reads canonical ACL state from Mumble, submits edits back to Mumble, refreshes canonical state after writes, and mirrors snapshots locally only for UI responsiveness, broadcasting, and diagnostics.

This project is broader than unlocking one blocked UI action. It establishes the server-side ACL management path Brmble is currently missing, including channel ACL and group editing, token-related rule handling, canonical refresh after writes, and real-time propagation of refreshed ACL state to connected Brmble admin clients.

## Goals

- Make ACL administration in Brmble behave like native Mumble.
- Keep Mumble authoritative for permission evaluation and channel-entry decisions.
- Add a Brmble server-side ACL service that can fetch, edit, refresh, and broadcast canonical ACL state.
- Support native Mumble ACL concepts including:
  - channel-scoped groups
  - inherited ACL rules
  - rule order
  - `applyHere` / `applySubs`
  - user selectors
  - group selectors
  - token/password selectors via `@#...`
  - selector modifiers such as inversion and locality
- Enable currently blocked or limited admin workflows that depend on ACL support, especially password-protected channels.

## Non-Goals

- Brmble does not become a second source of truth for ACL data.
- Brmble does not become the authority for permission enforcement.
- Brmble does not block or allow joins using its own local ACL decision engine.
- Brmble does not introduce Brmble-only ACL semantics that do not map cleanly to native Mumble behavior.
- Brmble does not attempt optimistic multi-writer conflict merging in v1.

## Authority Model

- Mumble is the canonical source of truth for:
  - ACL rule definitions
  - group membership
  - inheritance behavior
  - token-based selectors and resulting access behavior
  - effective permission evaluation
- Brmble may persist mirrored ACL snapshots in its database, but those records are cache/materialized-view state only.
- If local Brmble snapshot data disagrees with Mumble, Mumble wins immediately.
- Permission-sensitive user actions should continue to follow actual Mumble server responses. Brmble can show likely affordances from effective permission data, but it must not treat local ACL mirrors as final authority.

## Native Mumble Compatibility Rules

- Channel entry behavior must remain Mumble-native:
  - the Mumble server decides whether a user may enter or traverse a channel
  - Brmble reflects success or denial rather than preempting the decision
- Effective permissions used by the running client should continue to come from actual Mumble permission flow such as `PermissionQuery`.
- ACL administration should resemble native Mumble's mental model:
  - ACLs are attached to channels
  - groups are channel-scoped and inheritable
  - rules are ordered top-to-bottom
  - inherited rules are visible but not edited as local rules unless explicitly overridden on the target channel

## Architecture

### 1. `MumbleAclService`

Add a server-side ACL application service in `src/Brmble.Server` as the single Brmble entry point for ACL administration.

Responsibilities:

- Fetch channel ACL/group state from Mumble using the existing ICE proxy methods:
  - `getACL`
  - `setACL`
  - `addUserToGroup`
  - `removeUserFromGroup`
- Translate Mumble ICE payloads into Brmble-owned DTOs for the web/admin layers.
- Accept Brmble ACL edit requests, translate them back into Mumble ICE payloads, submit them to Mumble, and return refreshed canonical state.
- Expose a small, stable API surface so the rest of Brmble does not depend directly on generated ICE types.

### 2. `AclSnapshotRepository`

Add a repository for mirrored ACL snapshots in Brmble's database.

Responsibilities:

- Persist canonical snapshots of channel ACL/group state after successful fetches from Mumble.
- Store sync metadata such as:
  - `channelId`
  - `fetchedAt`
  - freshness/stale marker
  - a hash, version marker, or canonical payload checksum for change detection
- Support quick initial admin UI hydration and websocket replay after reconnect.
- Support diagnostics and audit-oriented troubleshooting when users report stale or conflicting ACL views.

Important constraint:

- Snapshot rows are not authoritative. They exist to improve Brmble behavior around UI loading, broadcasting, and observability, not to replace Mumble.

### 3. `AclSyncCoordinator`

Add a synchronization coordinator responsible for canonical refresh and broadcast behavior.

Responsibilities:

- After every Brmble-issued ACL write:
  1. write to Mumble
  2. re-fetch canonical ACL/group state from Mumble
  3. persist the refreshed snapshot
  4. broadcast ACL-changed events to relevant Brmble clients
- Optionally warm snapshots for known channels on startup.
- Mark snapshots stale when refresh fails or when known sync assumptions become invalid.
- Reconcile out-of-band edits made by other Mumble clients via:
  - refresh on ACL admin screen open
  - targeted refresh triggers after relevant admin actions
  - optional periodic reconciliation if needed later

Constraint:

- If Mumble does not provide an ACL-changed callback, Brmble must not claim strict push-perfect synchronization for external edits. It should provide best-effort refresh and canonical replacement.

### 4. `AclAdminEndpoints`

Add server endpoints for ACL administration reads and writes.

Responsibilities:

- Serve ACL/group state for a requested channel.
- Accept ACL/group update commands from the web admin UI.
- Route all writes through `MumbleAclService`.
- Return canonical refreshed state after successful writes.

Read policy:

- On admin screen open, Brmble may use a fresh local snapshot for immediate paint.
- Brmble should also validate against Mumble and replace stale or changed data with canonical state when returned.

### 5. Web Admin UI

Add ACL administration UI that follows native Mumble's model closely.

Expected shape:

- Channel-scoped ACL administration surface with:
  - Groups tab
  - ACL tab
- Inherited group/rule visibility
- Ordered rule list
- Support for:
  - user selectors
  - `@group` selectors
  - `@#token` selectors
  - inversion
  - locality modifiers
  - allow/deny bitmasks
  - `applyHere`
  - `applySubs`
- UI that feels like a Mumble admin client rather than a new custom permission system

The runtime permission flow used elsewhere in Brmble stays separate. Existing feature gating based on effective permissions continues to rely on Mumble-derived permission results rather than the ACL editor state itself.

## Data Flow

### Read Flow

1. Admin opens ACL UI for a channel.
2. Brmble loads the latest snapshot if it is still fresh enough for immediate rendering.
3. Brmble fetches canonical ACL/group state from Mumble.
4. If canonical state differs from the snapshot:
   - snapshot is updated
   - stale UI data is replaced
   - connected admin clients are notified of the canonical change
5. UI renders the canonical channel ACL model.

### Write Flow

1. Admin edits ACL rules, groups, or token-related selectors in Brmble.
2. Brmble sends the write request to `AclAdminEndpoints`.
3. `AclAdminEndpoints` routes the request to `MumbleAclService`.
4. `MumbleAclService` translates the request to Mumble ICE types and writes to Mumble.
5. `AclSyncCoordinator` immediately re-fetches canonical ACL/group state from Mumble.
6. Brmble persists the refreshed snapshot.
7. Brmble broadcasts the canonical updated ACL state to connected admin clients.
8. UI updates from the refreshed canonical payload, not from the optimistic draft.

### External-Change Flow

1. Another Mumble client or admin tool changes ACL state outside Brmble.
2. Brmble does not assume it knows about the change instantly unless Mumble exposes a relevant event.
3. On the next refresh trigger, Brmble re-fetches canonical state from Mumble.
4. If state changed, Brmble updates the snapshot and replaces local admin UI state with the canonical result.

## Access Tokens

- Brmble should support native Mumble token/password selector behavior through ACL rule editing rather than inventing a separate Brmble token authorization system.
- Token selectors remain represented as native ACL selectors using the `@#...` pattern.
- Permission enforcement still happens only when the user presents tokens to Mumble and Mumble evaluates the rule set.
- Brmble's role is to expose, edit, store mirrored snapshots of, and refresh these ACL structures.

## Error Handling

- If Mumble is unavailable, ACL editing is unavailable.
- Brmble must not silently accept edits into local storage and pretend they were applied.
- If a write fails before Mumble confirms success:
  - return an error to the UI
  - keep the current canonical snapshot unchanged
- If a write succeeds in Mumble but Brmble fails during canonical refresh:
  - return a warning-state response such as "change may have succeeded, but refresh failed"
  - mark the affected snapshot stale
  - require the next successful fetch to re-establish certainty
- If Brmble fetches canonical state and sees differences from the UI's current draft because another writer changed the channel:
  - canonical state wins
  - Brmble replaces the displayed ACL state
  - v1 should ask the admin to review rather than attempt an automatic merge
- Permission-denied responses from Mumble should surface clearly in the UI as actual authorization failures, not generic network errors.

## Real-Time Sync Expectations

- For Brmble-issued writes, synchronization should feel immediate:
  - write to Mumble
  - re-fetch canonical state
  - broadcast update
- For out-of-band changes, synchronization is best-effort and native-compatible:
  - refresh on screen open
  - refresh after relevant actions
  - optional reconciliation passes if needed
- Brmble should not claim stronger consistency than the Mumble event model supports.

## Testing

### Server Tests

- Mapping tests from Mumble ICE ACL/group payloads to Brmble DTOs
- Mapping tests from Brmble DTO write models back to Mumble ICE payloads
- Write-path tests covering:
  - write to Mumble
  - canonical re-fetch
  - snapshot persistence
  - websocket or event broadcast
- Failure tests covering:
  - Mumble unavailable
  - invalid channel id
  - invalid user/group references
  - permission denied
  - successful write followed by failed refresh

### Integration Tests

- Integration coverage around `getACL`
- Integration coverage around `setACL`
- Integration coverage around `addUserToGroup`
- Integration coverage around `removeUserFromGroup`
- End-to-end validation that canonical refresh after write returns the Mumble-owned final state

### Web Tests

- Render inherited vs local rules correctly
- Preserve top-to-bottom ACL rule order
- Edit selectors for:
  - user
  - group
  - token
  - inverted selectors
  - locality-modified selectors
- Surface stale-state replacement correctly when canonical data changes
- Show actionable error states for permission denied and service unavailable

### Regression Coverage

- Channel password management paths that were previously blocked on ACL support
- Existing permission-based UI actions continue relying on Mumble-effective permissions
- No Brmble-only pre-check blocks a join that should be decided by the Mumble server

## Risks

- Native Mumble ACL semantics are subtle, especially around inheritance, locality, meta groups, and ordered allow/deny behavior. The Brmble DTO model and UI must preserve these semantics without simplifying them into a lossy representation.
- If Brmble over-relies on cached snapshots, admins may see stale ACL state and make incorrect edits. Canonical refresh policy must stay strict.
- If Brmble tries to infer more real-time external-change certainty than Mumble actually exposes, users will see confusing overwrite behavior. The product should be explicit about canonical refresh rather than pretending to have stronger guarantees.

## Implementation Notes

- Brmble already has generated Mumble ICE bindings exposing ACL operations, so this project should build on that existing surface rather than introducing a second protocol path.
- Brmble already receives effective permission information from the Mumble client path via `PermissionQuery`, so ACL administration should complement rather than replace that mechanism.
- Existing admin features blocked on ACL support should be migrated onto this new canonical ACL management path once the foundation is in place.
