# Screen Share Auto-Stop Design

**Date:** 2026-04-25
**Status:** Approved
**Branch:** `fix/screenshare-self-slot`
**Related roadmap item:** `docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md` — Broadcaster Controls / Connection & Reliability

## Overview

Brmble should stop local screen sharing automatically when the captured source ends externally, instead of remaining stuck in a sharing state. The sharer should get a reason-appropriate notification for non-manual endings, while viewers should silently stop receiving the feed and clean up their UI through the existing remote stop path.

This design keeps the fix focused on local share lifecycle handling in `useScreenShare`, without broadening into new viewer UX, native-window behavior, or unrelated LiveKit architecture changes.

## Goals

- Auto-stop local sharing when the captured source ends outside Brmble's manual stop flow.
- Distinguish between normal source closure and unexpected interruption for the sharer's notification copy.
- Treat app-close while sharing as part of the `interrupted` bucket rather than a separate reason.
- Ensure remote viewers silently lose the feed and clear state through the existing stop path.
- Make the local stop pipeline idempotent so duplicate end/disconnect events do not double-clean up or double-notify.

## Non-Goals

- Add new viewer notifications.
- Introduce a third dedicated stop reason for app shutdown.
- Redesign the sharing UI beyond existing notification plumbing.
- Rework the entire LiveKit bridge architecture.

## Current Problem

The current implementation in `src/Brmble.Web/src/hooks/useScreenShare.ts` only handles the local share lifecycle through explicit calls to:

- `startSharing()`
- `stopSharing()`
- room disconnect cleanup

It does not currently register lifecycle handling for the captured screen-share track ending externally. As a result:

- the sharer can remain in an incorrect local `isSharing` state after the shared app/window closes
- the clean stop event path is less reliable on abrupt external endings
- there is no consistent reason classification for sharer notifications

## Desired Behavior

### Manual stop

Manual stop includes:

- clicking Brmble's stop-sharing control
- using the browser or OS stop-sharing control intentionally

Behavior:

- local sharing stops cleanly
- no notification is shown to the sharer
- remote viewers silently lose the feed through the normal stop path

### Source closed

Source closed includes:

- the shared app/window is closed
- the chosen capture source disappears in a way that is considered a normal source ending

Behavior:

- local sharing stops automatically
- sharer sees a notification with:
  - title: `Share ended`
  - body: explains the shared window or program was closed
- remote viewers silently lose the feed

### Interrupted

Interrupted includes:

- capture ends for an unexpected non-manual reason
- room disconnect occurs while sharing is still considered active and no more specific reason has already been assigned
- Brmble app shutdown while sharing

Behavior:

- local sharing stops automatically
- sharer sees a notification with:
  - title: `Share ended`
  - body: explains the share ended due to an unexpected technical reason
- remote viewers silently lose the feed

### Error

Error is reserved for true share failures where the share cannot continue because of an actual technical problem in the publish/share pipeline.

Behavior:

- local sharing stops or fails safely
- sharer sees error-oriented notification or existing error surface as appropriate
- remote viewers silently lose the feed if a live share was active

## Architecture

### Single local stop pipeline

`useScreenShare` becomes the single owner of local share termination.

Add one internal stop/cleanup path that:

1. accepts a local stop reason
2. clears local share state exactly once
3. sends the bridge stop event exactly once for a real ended share
4. decides whether a sharer notification should be shown
5. disconnects the room only when no longer sharing and no longer watching

This replaces scattered local stop behavior with one centralized path.

### Reason model

The local stop pipeline should classify endings into:

- `manual`
- `source-closed`
- `interrupted`
- `error`

This is an internal behavioral model, not necessarily a user-facing protocol change.

### Capture lifecycle listeners

After `startSharing()` successfully enables screen sharing, Brmble should capture references to the local screen-share track and/or media stream lifecycle needed to observe when capture ends externally.

Those listeners should route into the shared stop pipeline rather than directly mutating state.

### Disconnect fallback

If the LiveKit room disconnects while local sharing is still active and no earlier reason has already completed cleanup, the disconnect path should fall back to `interrupted`.

This ensures app-close and abrupt teardown still converge on a predictable stop reason.

## Data Flow

### Start flow

1. `startSharing(roomName)` ensures the room exists.
2. Local participant enables screen sharing.
3. Brmble marks local sharing active.
4. Brmble registers capture-end listeners on the local share track/stream.
5. Brmble sends the existing `livekit.shareStarted` bridge event.

### Manual stop flow

1. UI calls `stopSharing()`.
2. `stopSharing()` delegates to the shared stop pipeline with `manual`.
3. The shared stop pipeline disables screen sharing, clears state, suppresses notifications, and emits the stop event once.

### External end flow

1. Browser/media lifecycle reports the capture ended.
2. Brmble classifies the end as `source-closed` or `interrupted`.
3. Brmble runs the shared stop pipeline.
4. Viewers silently lose the share through the existing stop cleanup path.
5. Sharer gets notification copy based on the classified reason.

## Notification Rules

- `manual`: no sharer notification
- `source-closed`: title `Share ended`, body explains the shared window/program was closed
- `interrupted`: title `Share ended`, body explains the share ended due to an unexpected technical reason
- viewers: no new notifications from this feature

## Idempotency Requirements

The stop pipeline must tolerate overlapping end signals, for example:

- track `ended`
- room `Disconnected`
- UI stop call racing with browser stop

Only one cleanup pass should win. Later signals should no-op.

Required guarantees:

- `isSharing` becomes false once
- stop bridge event is sent once
- viewer cleanup is triggered once per ended share
- sharer notification is shown at most once

## Testing Strategy

### Automated tests

Add or update tests in `src/Brmble.Web/src/hooks/useScreenShare.test.ts` to cover:

- manual stop produces no notification-worthy reason
- external track end routes through `source-closed`
- room disconnect while sharing routes through `interrupted`
- duplicate end/disconnect signals do not double-clean state or emit duplicate stop signaling
- existing remote viewer cleanup behavior still passes

### Manual verification

Verify these flows manually:

1. Share a specific app/window, then close that app/window.
2. Share and stop using the browser/OS stop-sharing control.
3. Share and close Brmble while sharing.
4. Observe viewer behavior in all cases: feed disappears without any new notification.

## Risks

- LiveKit/browser APIs may not always provide a richly distinguishable reason for why capture ended, so some `source-closed` vs `interrupted` classification may require a pragmatic heuristic.
- Room disconnect and track-end events may race; idempotent cleanup is required to keep the UI correct.
- The current code already uses `RoomEvent.Disconnected` for broad cleanup, so introducing reason-aware local stop handling must avoid duplicating side effects.

## Success Criteria

- Closing the shared app/window no longer leaves the sharer stuck in a sharing state.
- Manual stop still shows no notification.
- External normal source endings show the neutral `Share ended` notification with source-closed explanation.
- Unexpected interruption shows the `Share ended` notification with technical-reason explanation.
- Viewers silently stop seeing the ended share in all these cases.
- Cleanup remains correct even if multiple stop signals arrive close together.
