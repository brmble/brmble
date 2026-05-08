# LiveKit Share Visibility State Design

**Date:** 2026-05-04
**Status:** Approved
**Scope:** Correct the share visibility/watch state model after manual testing showed root-channel watch attempts, stale LiveKit status, and disappearing cross-channel badges.

## Overview

Manual testing showed that the current screenshare state model still conflates two concepts:

- who is currently sharing somewhere on the server
- whether the current user may watch a specific share from their current channel

Recent root/global discovery work made share badges visible in root, but `activeShares` is still doing too many jobs. That caused root icons to remain clickable, cross-channel badges to disappear when switching into an empty room, and stale LiveKit status after a watch window closed.

This design splits global visibility from watch eligibility and tightens watcher cleanup so status reflects actual watch/share state.

## Goals

- Keep share badges/icons visible globally when users are sharing in any channel.
- Prevent root or wrong-channel clicks from starting a LiveKit watch connection.
- Allow watch only when the current user is in the sharer's channel.
- Keep LiveKit sidebar status aligned with actual local sharing/watching state.
- Clean up stale watcher state when a watched screen-share track unsubscribes or a sharer stops/disconnects.

## Non-Goals

- Changing server-side token authorization.
- Changing the product rule that share visibility is global.
- Adding future per-channel privacy controls.
- Changing LiveKit room lifecycle beyond stale watcher cleanup.
- Redesigning sidebar visual layout.

## Recommended Model

### Visibility state

Introduce or clarify a global visibility concept, effectively:

- `knownActiveShares`: all currently known active shares across channels

This state powers badges/icons everywhere:

- root user list
- channel user list
- any future global share overview

It should not be pruned just because the user enters an empty channel.

### Watch eligibility

Watching is a separate action check:

- user can see that someone is sharing even outside that share's channel
- user can only start watching when their current channel matches the share's `roomName`
- root is never a watch-eligible context because root is not a real share room

The UI should therefore render icons outside the eligible channel as presence-only, not as watch buttons.

## Root And Cross-Channel Behavior

Expected behavior:

- user B in root sees user A's share badge in channel 1
- clicking that badge from root does not start LiveKit
- user B in channel 2 still sees user A's share badge from channel 1
- clicking that badge from channel 2 does not start LiveKit
- user B joins channel 1, then the badge becomes watch-actionable

This keeps visibility broad and access narrow.

## Watcher Cleanup

The watch UI and sidebar status must derive from the same actual watcher state.

If a watched screen-share track unsubscribes, or the sharer stops/disconnects:

- remove the relevant watched-share entry
- detach/remove the remote video element
- clear focused share if it points to the removed share
- disconnect the LiveKit room if nothing is being watched and the local user is not sharing
- let `App` status fall back from `connected` to idle/error based on the remaining state

Do not fix stale status by changing only the sidebar status derivation. The stale state originates in `useScreenShare` and should be cleaned up there.

## Data Flow

### Discovery

- root requests global discovery
- channels may request room-scoped discovery for freshness
- both update the global known-share visibility state without deleting unrelated known shares unless the response scope is global and authoritative

### Realtime events

- `screenShare.started` adds or updates the global known share
- `screenShare.stopped` removes the global known share
- realtime events should not be ignored merely because the current selected channel is different

### Watch action

- UI receives click on a share badge/icon
- UI resolves the share's actual `roomName`
- UI compares the current channel to that `roomName`
- if they do not match, do not call `connectAsViewer`
- if they match, call `connectAsViewer` with the share's actual `roomName`

## Error Handling

- wrong-channel/root watch attempts should be no-op or show a small explanatory disabled affordance, but must not initiate LiveKit connection
- failed watch token requests should still be handled as authorization/connection failures
- stale watcher cleanup should not show a share-ended warning unless the local user was sharing and the stop reason warrants it

## Testing Strategy

### Visibility tests

- global discovery populates badges across rooms
- switching from root to an empty channel keeps badges for shares in other channels
- realtime share-start events from other channels update known shares
- realtime share-stop events from other channels remove known shares

### Watch gating tests

- root badge click does not call `connectAsViewer`
- wrong-channel badge click does not call `connectAsViewer`
- same-channel badge click calls `connectAsViewer` with the share's actual `roomName`
- root should never synthesize `channel-0` for watch

### Cleanup/status tests

- track unsubscribe removes the matching watched share
- sharer stop/disconnect removes watched share and remote video
- LiveKit sidebar status returns to non-connected when no shares are watched and local user is not sharing

## Risks

- If visibility and watch state are only partially separated, root icons may remain clickable or cross-channel badges may disappear again.
- If global discovery is treated as a room-scoped response, it can wipe valid share state.
- If cleanup only updates UI video elements and not watcher state, service status will remain stale.

## Success Criteria

- root shows share badges for users sharing in other channels
- root/wrong-channel badge clicks do not start LiveKit
- same-channel badge clicks still start watching correctly
- moving from root to an empty channel does not hide unrelated share badges
- LiveKit status returns to idle when watching ends because the user moved away, the track unsubscribed, or the sharer stopped
