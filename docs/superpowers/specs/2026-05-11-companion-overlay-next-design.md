# Companion Overlay Next Design

**Date:** 2026-05-11
**Status:** Approved for planning
**Supersedes:** `docs/superpowers/specs/2026-05-10-brmblegotchi-companion-overlay-design.md`, `docs/superpowers/specs/2026-05-11-companion-overlay-orchestrator-design.md`

## Goal

Define the next design for the companion overlay based on the implementation that already exists today.

This design is not a greenfield reimagining of the overlay. It starts from the current shipped structure:

- overlay event bridge
- shared overlay snapshot model
- `Full Companion` mode
- `Minimal` mode
- current speaker and event rendering
- existing overlay settings

The purpose of this document is to describe the next change set needed to evolve that implementation into the desired companion-driven overlay.

## Current Baseline

The current overlay already provides a working foundation:

- Overlay enable/disable, mode, and position settings
- A `Full Companion` presentation with a single main sprite and speech bubble
- A `Minimal` presentation for low-noise speaker awareness
- A shared overlay model for recent events and active speakers
- Event filtering for channel messages, direct messages, join/leave, moderation, and speakers
- A bridge between native client state and the overlay web UI

That means the next phase should focus on replacing the current simplified sprite-state logic rather than rebuilding the overlay from scratch.

## Product Direction

The next version of `Full Companion` should behave like a single-character stage that dynamically swaps which companion is on screen based on voice and chat activity.

The desired behavior is:

- Only one main companion is visible at a time
- The visible companion may be:
  - the local user's companion
  - another user's companion
  - the local user's companion acting as a proxy when another user has no companion
- Chat has the highest display priority
- Active speaking has the next priority after chat
- Join/leave events come after chat and speaking
- Idle falls back to the local user's own companion

`Minimal` mode should remain as it is today for users who want speaker awareness without the companion system.

## Hard Rules

### Overlay mode boundary

`Minimal` mode is intentionally preserved.

Rules:

- `Minimal` keeps its existing behavior and purpose
- `Minimal` does not depend on companion assets
- Companion selection logic applies only to `Full Companion`
- Users who do not want a companion overlay can continue using `Minimal` without regression

### Single active companion

`Full Companion` may show only one main companion at a time.

Speaker indicators may still exist around it, but there is exactly one primary companion display.

### Automatic source selection

The companion source is selected automatically at runtime.

There is no separate runtime toggle for:

- own companion
- another user's companion
- proxy companion

Those are outcomes of the display rules.

## Companion Asset Contract

Every companion used by `Full Companion` must follow the same `.webp` atlas structure.

Required row mapping:

- Row 1 = `idle`
- Row 4 = `chat`
- Row 9 = `speaking`

This mapping is fixed across all companions.

For the next phase, join/leave displays should reuse the `chat` pose family rather than requiring an extra mandatory row.

## Runtime Model Changes

The current overlay snapshot is centered around:

- `recentEvents`
- `activeSpeakers`
- `visualState`

That is enough for the current implementation, but not enough for the next behavior because the overlay now needs to decide:

1. which user is represented
2. which sprite row is active
3. whether the item came from chat, speaking, join, or leave
4. whether muted/live badges are present
5. whether the item is active or waiting in a queue

The next implementation should therefore introduce a `Full Companion` display orchestrator.

Suggested conceptual state:

- `activeDisplay`
- `chatQueue`
- `eventQueue`
- `speakerCandidates`
- companion lookup by user/session
- local overlay flags such as local mute and live state

The existing snapshot can still remain the bridge-facing shape if helpful, but `Full Companion` should no longer derive its behavior from `visualState` alone.

## Display Priority

`Full Companion` resolves one active display using this order:

1. chat
2. speaking
3. join/leave
4. idle

Implications:

- chat may immediately replace idle
- speaking may replace idle and join/leave, but not active chat
- join/leave waits behind both chat and speaking
- idle appears only when nothing else is eligible

## Event And Queue Behavior

### Chat messages

When a chat message arrives:

- If idle is active, show it immediately
- If another chat item is active, append it to `chatQueue`
- If speaking or join/leave is active, append it to `chatQueue`

Display behavior:

- duration: 5 seconds
- companion: sender's companion, otherwise proxy
- row: 4
- bubble: factual message text

### Speaking

When a user starts speaking:

- add them to `speakerCandidates`
- they become eligible only after 0.5 seconds of continuous speech
- if no higher-priority item is active, promote the first eligible speaker to the active display
- if another speaker is already active, keep the new one waiting

Display behavior:

- companion: speaker's companion, otherwise proxy
- row: 9
- no chat bubble by default

Tie-breaking:

- first user to cross the 0.5 second threshold wins
- if effectively simultaneous, preserve event arrival order

When a user stops speaking:

- keep their indicator visible in a cooling state for about 3 seconds
- if they were the active main display, switch to the next eligible speaker or fall back according to priority rules

### Join and leave

When a join/leave event arrives:

- if idle is active and no higher-priority work is pending, it may display immediately
- otherwise append it to `eventQueue`

Display behavior:

- duration: 3 seconds
- companion: event user's companion, otherwise proxy
- row: 4
- bubble: factual join/leave text

### Idle

When no chat, eligible speaker, or queued join/leave item is active:

- show the local user's own companion
- use row 1
- show no bubble

## Muted And Live

Muted and live are badge concerns, not separate display kinds.

### Local muted state

When the local user is muted:

- suppress speaker-driven main companion switching
- hide active-speaking indicators
- continue showing chat normally
- continue showing join/leave normally
- keep idle available

The muted badge appears only when the currently displayed companion represents the local user.

### Live state

The live badge appears whenever the active represented user is currently streaming.

This applies to:

- the local user's companion while idle or during local events
- another user's companion when they are the active display and are streaming

## Settings Direction

The existing settings surface should remain the home for this feature:

- `Enable Companion Overlay`
- `Overlay Mode`
- `Overlay Position`
- event toggles for messages, DMs, join/leave, moderation, and speakers

Add one new `Full Companion`-specific setting:

- `My Companion`

For this phase, only the local user's companion selection needs to be configurable in settings. Remote-user companion ownership can arrive later via profile/config data without changing the orchestrator rules.

## UI Boundary

The current UI split is useful and should remain:

- shared overlay state and bridge plumbing
- `FullCompanionOverlay`
- `MinimalOverlay`
- sprite rendering component

The next phase should evolve these boundaries rather than replace them:

- `MinimalOverlay` stays as-is
- `FullCompanionOverlay` becomes orchestrator-driven
- `CompanionSprite` becomes atlas-row driven with badge overlays
- current speaker stack remains supportive UI, not the main display selector

## Migration From Current Implementation

The main technical migration is:

- from `visualState` choosing one generic sprite look
- to `activeDisplay` choosing represented user, row, badges, and bubble content

The bridge and settings structure can stay mostly intact.

The biggest change belongs in the overlay model layer and the full companion rendering path.

## Testing Strategy

Add or update tests around the implementation that already exists.

Required cases:

1. `Minimal` mode still behaves exactly as before
2. Idle `Full Companion` shows the local user's companion on row 1
3. Chat preempts idle and lasts 5 seconds
4. Multiple chats serialize through `chatQueue`
5. Speaking requires a 0.5 second threshold
6. Chat outranks speaking
7. Join/leave waits behind chat and speaking, then displays for 3 seconds
8. Stopped speakers cool down in indicators before disappearing
9. Local mute suppresses speaking displays but not chat/join/leave
10. Live badge appears on the active represented companion

## Recommended Planning Framing

The implementation plan should treat this as an incremental redesign of the current overlay, not a restart.

Recommended framing:

1. preserve current minimal mode and bridge structure
2. add companion selection and atlas rendering to full mode
3. replace full-mode `visualState` logic with an orchestrator
4. keep the rollout focused on the already-implemented overlay architecture
