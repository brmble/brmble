# Screen Share Self-Slot Bugfix Batch — Design Spec

**Date:** 2026-04-21
**Status:** Implemented
**Depends on:** Sub-project A2 (Multi-Share Layouts) — implemented
**Branch:** `fix/screenshare-self-slot`

## Overview

Fix the A2 regression where clicking your own sharing row can reserve an empty slot in the screen-share grid even though self-preview does not exist. In the same patch, clean up the channel-list sharing UI so the share monitor icon no longer occupies the status-icon area near the avatar and no longer displaces mute/deafen indicators.

This fix has landed and is kept here as the design record for the shipped behavior.

## Goals

- Prevent the local user's share from being treated like a watched remote share.
- Preserve the current watch/unwatch behavior for remote sharers.
- Keep room for a future self-preview feature without shipping broken placeholder behavior now.
- Move the sharing monitor icon behind the `Sharing` label for all sharers.
- Keep mute/deafen indicators visible in their normal status area.

## Non-Goals

- Implement self-preview.
- Add a new toast or notification for self-click behavior.
- Redesign the entire channel-row layout.
- Change grid/focus behavior for valid remote watched shares.

## Current Problem

The sidebar and channel tree currently conflate two different states:

- `sharing`: the user is broadcasting their screen
- `watching`: the viewer is subscribed to that user's share

For the local user, the UI uses `sharingUserSession` as if it also means `watching`. That lets the local sharing row present itself as watched and lets click handlers flow into watch logic, even though the actual `watchingShares` and `remoteVideoEls` state only contain remote participants. The result is inconsistent UI and, in some cases, an empty reserved slot in the grid/focus layout.

## Proposed Behavior

### 1. Local user while sharing

- The local row still shows that the user is `Sharing`.
- The local row is never shown as `Watching`.
- Clicking or double-clicking the local sharing row does nothing visible.
- No notification is shown.

### 2. Remote users while sharing

- Remote sharing rows keep the current watch/unwatch toggle behavior.
- Remote rows continue to reflect actual watch state from `watchingShares`.
- Focused and grid layouts continue to be driven only by actual watched remote shares.

### 3. Sharing icon placement

- The monitor icon moves out of the status-icon slot near the avatar.
- The monitor icon is rendered with the `Sharing` label for all sharers.
- The status-icon slot remains available for mute/deafen indicators.
- A user can therefore be both sharing and muted/deafened without losing those indicators.

## Implementation Shape

### Data flow

`useScreenShare` remains the source of truth for real watch state:

- `watchingShares` contains only remote watched shares.
- `focusedShare` refers only to watched remote shares.
- `remoteVideoEls` contains only attached remote tracks.

This patch should avoid pushing local-user special cases into the hook unless investigation reveals a genuine hook-level bug. The primary fix belongs in the row rendering and event handling in:

- `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`
- `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`

### UI responsibilities

- The status area near the avatar should represent user status icons such as mute/deafen.
- The sharing affordance should live next to the `Sharing` text.
- Remote share rows can keep an interactive monitor control.
- The local share row should render a non-actionable sharing affordance for now so a future self-preview feature can be added without preserving today's broken state mapping.

## Approach Options

### Option 1. UI-only guard with inert local affordance

Keep the icon visible for all sharers, move it next to `Sharing`, and make the local share affordance non-actionable. Remote rows keep the current toggle behavior.

**Pros:** Smallest change, aligns with future self-preview, fixes both bugs together.
**Cons:** Requires slightly more conditional rendering than simply hiding the control.

### Option 2. Remove local share affordance entirely

Show the monitor icon only for remote sharers and omit it for the local row.

**Pros:** Simplest UX today.
**Cons:** Less aligned with future self-preview direction.

### Option 3. Hook-level defensive filtering plus UI cleanup

Add extra guardrails in the hook against any self-watch attempt and also update the row layout.

**Pros:** Stronger defense in depth.
**Cons:** More invasive than needed if the current bug is only caused by UI-state conflation.

## Recommendation

Use Option 1.

It fixes the shipped regression with the smallest correct change, keeps the future self-preview door open, and avoids expanding the patch into unnecessary hook refactoring unless testing reveals another related issue.

## Testing Strategy

### Unit / component coverage

- The local sharing row is not rendered as watched.
- Local share click and double-click paths do not invoke watch behavior.
- Remote share rows still invoke watch/unwatch correctly.
- The sharing monitor icon renders with the `Sharing` label rather than replacing the status area.

### Manual verification

- Share your own screen and click your own row: no empty grid slot appears.
- Watch one or more remote shares while sharing yourself: only remote watched shares appear in the grid.
- Confirm mute/deafen indicators remain visible for sharers.
- Confirm remote sharing toggles still work in both sidebar variants.

## Risks

- `Sidebar.tsx` and `ChannelTree.tsx` currently duplicate similar logic, so the fix must stay consistent in both places.
- If any other code path assumes `sharingUserSession` implies watch state, tests may reveal a second small follow-up fix.

## Success Criteria

- The local sharer can no longer create an empty viewer slot by clicking their own sharing row.
- Remote share watch/unwatch behavior remains intact.
- Sharing rows display the monitor icon next to `Sharing` for all sharers.
- Mute/deafen icons remain visible while a user is sharing.
