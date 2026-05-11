# Companion Overlay Orchestrator Design

**Date:** 2026-05-11
**Status:** Approved for planning
**Related:** `docs/superpowers/specs/2026-05-10-brmblegotchi-companion-overlay-design.md`

## Goal

Define how the `Full Companion` overlay chooses which companion is visible, which sprite row is rendered, and how chat, speaker activity, join/leave, muted, and live-streaming states interact without disturbing the existing `Minimal` overlay mode.

## Scope

This design refines the previously approved companion overlay direction with concrete runtime rules for:

- Companion asset structure
- Active display selection
- Queue ordering and timing
- Muted and live badges
- The boundary between `Full Companion` and `Minimal`

This design does not change the purpose of the overlay, event categories, or the existing requirement that only one main companion is shown at a time.

## Non-Goals

- Reworking the `Minimal` overlay presentation
- Reintroducing Tamagotchi care or growth mechanics
- Designing a profile system for remote users to upload or manage companions
- Defining final `.webp` art production workflows beyond the required atlas contract

## Companion Asset Contract

Every companion used by the `Full Companion` overlay must follow the same `.webp` atlas layout.

Required row meanings:

- Row 1: `idle`
- Row 4: `chat`
- Row 9: `speaking`

All companions must use the same semantic row mapping so the overlay runtime can switch rows generically without per-companion logic.

### Source selection

The overlay may render three conceptual companion sources:

1. The local user's own companion
2. Another user's configured companion
3. The local user's companion as a proxy when another user has no companion

The source is chosen automatically by the active display rules; it is not a separate manual runtime toggle.

## Display Model

The current `visualState`-first model is not expressive enough for the new requirements. `Full Companion` should instead be driven by an `activeDisplay` model that answers four questions together:

1. Which user is being represented?
2. Which display kind is active?
3. Which atlas row should render?
4. Which badges and bubble text should be shown?

Suggested conceptual shape:

- `sourceUser`
- `displayKind` = `idle | chat | speaking | join | leave`
- `atlasRow`
- `speechBubbleText`
- `badges`
- `startedAt`
- `expiresAt`

Supporting runtime collections:

- `chatQueue`
- `eventQueue`
- `speakerCandidates`
- companion lookup by user/session
- local overlay flags such as `isLocalMuted` and `isLocalLive`

## Priority Rules

The `Full Companion` overlay always resolves to exactly one `activeDisplay`.

Priority order:

1. `chat`
2. `speaking`
3. `join/leave`
4. `idle`

This means:

- Chat can preempt idle immediately
- Speaking can preempt idle and join/leave, but not active chat
- Join/leave waits behind chat and speaking
- Idle is the fallback whenever nothing else is eligible

## Queue And Timing Rules

### Chat

- On arrival, a chat message should display immediately if the current display is `idle`
- If another chat item is already active, the new chat is appended to `chatQueue`
- If `speaking` or `join/leave` is active, the chat item is appended to `chatQueue`
- Each chat item remains visible for 5 seconds

When a chat item becomes active:

- The displayed companion is the sender's companion if available
- Otherwise the local user's companion is used as a proxy
- The overlay renders row 4
- The speech bubble shows the chat line

### Speaking

- A user entering speaking state is first added to `speakerCandidates`
- They become eligible for the main display only after speaking continuously for 0.5 seconds
- If no higher-priority item is active, the first eligible speaker becomes the active display immediately
- If another speaker is already the active display, new eligible speakers wait their turn

When a speaking display is active:

- The displayed companion is the speaker's companion if available
- Otherwise the local user's companion is used as a proxy
- The overlay renders row 9

Tie-breaking:

- First speaker to cross the 0.5 second threshold wins
- If two speakers are effectively simultaneous, preserve first event order

### Speaker stop behavior

- When a speaker stops, they should not disappear from speaker indicators immediately
- Their indicator remains visible in a cooling state for about 3 seconds
- If the stopped speaker was the main display, the orchestrator should switch to the next eligible speaker when appropriate, otherwise fall back to idle

The recommended v1 timing is:

- speaking threshold: 0.5 seconds
- speaker cooldown/grace: 3 seconds

### Join and leave

- Join and leave events are appended to `eventQueue`
- They may display immediately only when the current display is `idle`
- They wait behind both active chat items and eligible speakers
- Each join/leave display remains visible for 3 seconds

When active:

- The displayed companion is the event user's companion if available
- Otherwise the local user's companion is used as a proxy
- The speech bubble contains the plain factual join/leave line
- The overlay uses the same non-speaking pose family as chat unless dedicated rows are added later

For v1, join/leave should reuse row 4 rather than invent a fourth required atlas row.

### Idle

If there is no active chat, no eligible speaker, and no queued join/leave event, the overlay falls back to:

- local user's own companion
- row 1
- no speech bubble

## Muted And Live Badges

Muted and live are badge overlays, not standalone display kinds.

### Muted

When the local user is muted:

- active speaker indicators are hidden
- speaker-driven companion switching is suppressed
- chat remains eligible
- join/leave remains eligible
- idle still shows the local user's companion

The muted badge appears as a small icon on the currently displayed companion only when that companion represents the local user.

### Live

The live state should always be shown as a badge on whichever companion is currently active if that represented user is streaming.

This applies to:

- local user's companion during idle or any local-user event
- another user's companion when they are the active display and are streaming
- proxy display of another user's event only if the represented user is considered the streaming actor for that display

## Full vs Minimal Boundary

`Minimal` mode must remain backward-compatible and companion-independent.

Hard rules:

- `Minimal` keeps its current behavior for showing who is talking
- `Minimal` does not require companion assets
- Companion selection, atlas rows, and companion badges apply only to `Full Companion`
- Users who do not want a companion-focused overlay can continue using `Minimal` without regression

This boundary reduces rollout risk and keeps the companion system from becoming mandatory.

## Settings Impact

For this phase, settings should stay small and focused.

Add or retain:

- `Enable Companion Overlay`
- `Overlay Mode`
- `Overlay Position`
- `My Companion`
- existing event toggles for channel messages, direct messages, join/leave, moderation, and speakers

For v1, only the local user's companion selection must be stored in settings. Remote-user companion resolution can plug into profile/config data later, as long as the orchestrator already supports fallback to proxy behavior.

## Implementation Guidance

The safest implementation order is:

1. Replace or wrap the current `visualState` logic with an `activeDisplay` orchestrator for `Full Companion`
2. Add tests for queue priority, 0.5 second speaker gating, 3 second speaker cooldown, and fallback to idle
3. Convert `CompanionSprite` into an atlas-row renderer with badge support
4. Wire local companion selection into overlay settings
5. Leave `Minimal` mode unchanged except for any shared event plumbing already in place

## Testing Strategy

Add or update tests for the following cases:

1. Idle shows the local companion on row 1
2. Chat preempts idle and uses row 4 for 5 seconds
3. Multiple chat messages serialize through `chatQueue`
4. A speaker must cross the 0.5 second threshold before taking over
5. Chat outranks speaking when both are pending
6. Join/leave waits behind chat and speaking, then displays for 3 seconds
7. A stopped speaker remains in indicators during cooldown, then disappears
8. Local mute suppresses speaking displays but not chat or join/leave
9. Live badge appears on the active represented companion
10. `Minimal` mode behavior remains unchanged

## Recommendation For Planning

The implementation plan should treat this as a focused `Full Companion` orchestrator upgrade layered on top of the approved overlay direction from 2026-05-10.

The plan should preserve these constraints:

- one active companion at a time
- fixed atlas row contract across all companions
- badges instead of extra sprite states for muted/live
- proxy fallback for users without companions
- no regression in `Minimal` mode
