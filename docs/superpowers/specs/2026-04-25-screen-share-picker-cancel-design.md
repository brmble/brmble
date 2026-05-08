# Screen Share Picker Cancel Design

**Date:** 2026-04-25
**Status:** Implemented
**Branch:** `fix/screenshare-self-slot`
**Related issue:** `#483` - misleading screen share status when user cancels the share picker

## Overview

Canceling the OS/browser screen-share picker is normal user behavior and must not be treated as a technical failure. Brmble should treat picker cancel exactly like a manual abort before sharing begins: no sharer notification, no retained screen-share error, and LiveKit status returning to the correct non-error state.

This fix has landed and is kept here as the design record for the shipped behavior.

This design is a focused follow-up to the recent screen-share auto-stop work. It narrows the start-sharing failure path so benign picker cancellation does not flow into the generic `error` handling intended for actual technical failures.

## Goals

- Treat picker cancel as manual-equivalent product behavior.
- Prevent the red disconnected/error status after canceling the picker.
- Prevent the new sharer-side technical failure notification after canceling the picker.
- Preserve the existing technical failure path for true share-start errors.
- Remove the misleading temporary `connecting` state while the picker dialog is still open.

## Non-Goals

- Introduce a new user-visible cancel state.
- Change viewer behavior; no share ever started.
- Redesign the screen-share button UI.
- Rework the broader LiveKit status system beyond this cancel path.

## Current Problem

Current `startSharing()` behavior in `src/Brmble.Web/src/hooks/useScreenShare.ts` treats all share-start failures the same:

1. picker or publish attempt throws
2. `screenShareError` is set
3. local stop reason flows through `error`
4. App status becomes disconnected/red with the thrown error string
5. App notification mapping can show a technical failure message

In parallel, `App.tsx` sets LiveKit status to `connecting` as soon as the user presses the share button, before the picker resolves. That produces a misleading flow:

- button press -> `connecting`
- user cancels picker -> `error`

Issue `#483` makes it explicit that canceling the picker should not look like permission denial or technical failure.

## Desired Behavior

### Picker cancel

Picker cancel includes the case where the user opens the OS/browser source picker and dismisses it without selecting a source.

Behavior:

- treat it exactly like a manual abort before sharing started
- do not retain `screenShareError`
- do not emit the sharer technical failure notification
- if not watching any shares, LiveKit status returns to `idle`
- if watching shares, LiveKit status remains `connected`

### True share-start failure

True start failure includes real technical problems after the user intended to share, such as a publish failure or unexpected runtime issue.

Behavior:

- keep the existing technical failure path
- `screenShareError` may be set
- technical failure notification may be shown to the sharer
- LiveKit status may enter disconnected/error state when appropriate

## Architecture

### Pre-share cancel classification

`useScreenShare` should classify picker-cancel errors before the generic `error` path runs.

This is a pre-share decision point in `startSharing()`:

- benign cancel / abort -> manual-equivalent early exit
- real failure -> existing `error` path

This does not require a new product-level stop reason. Product behavior should remain equivalent to `manual`.

### Status timing

`App.tsx` should not set LiveKit service status to `connecting` merely because the picker was opened.

For the share-start path:

- leave status unchanged while the picker is unresolved
- once sharing actually starts, normal `connected` state handling takes over through `isSharing`
- if the picker is canceled, the status effect falls back naturally to `idle` or stays `connected` if the user is watching shares

Viewer-side watch connection behavior can keep its existing `connecting` state because it reflects an actual room subscription attempt.

## Data Flow

### Start-sharing with picker cancel

1. User presses Share Screen.
2. Brmble opens the OS/browser picker.
3. User cancels.
4. `startSharing()` recognizes the thrown error as user-cancel/abort.
5. Brmble clears any temporary local start state without setting `screenShareError`.
6. No local share-ended notification is emitted.
7. Status settles to:
   - `idle` if not watching
   - `connected` if still watching

### Start-sharing with true failure

1. User presses Share Screen.
2. User selects a source or the share start proceeds far enough to represent a real attempt.
3. A technical failure occurs.
4. `startSharing()` falls through to the `error` path.
5. Existing status and sharer-notification error handling remains active.

## Error Recognition Strategy

The implementation should identify browser/LiveKit picker-cancel errors using known abort-style signals rather than treating every thrown start error as equivalent.

Typical examples to consider:

- `AbortError`
- browser/user-cancel variants exposed by the underlying capture flow
- user-cancel wording such as permission dialog dismissed or selection canceled

The implementation should keep this recognition narrow so true failures do not get swallowed accidentally.

## Testing Strategy

### Automated tests

Add or update tests for:

- picker cancel is classified as benign/manual-equivalent behavior
- picker cancel does not set `screenShareError`
- picker cancel does not trigger the share-ended technical notification path
- true start failures still map to `error`
- LiveKit status logic falls back to `idle` or remains `connected` when share start is canceled

### Manual verification

Verify these cases:

1. Join voice, click Share Screen, cancel the picker, while not watching anyone.
2. Confirm no notification and LiveKit status returns to idle.
3. Join voice, watch someone else's share, click Share Screen, cancel the picker.
4. Confirm no notification and LiveKit status stays connected.
5. Trigger a real share-start failure and confirm technical error behavior still appears.

## Risks

- Browser/platform cancel errors are not always represented with one exact error shape, so the classifier needs to be specific enough to catch known cancel cases without masking real faults.
- Status logic is currently split between direct `updateStatus(...)` calls and effect-driven state reconciliation, so this fix must avoid creating a new mismatch between immediate status updates and steady-state status.

## Success Criteria

- Canceling the screen-share picker no longer shows a technical failure notification.
- Canceling the screen-share picker no longer leaves LiveKit in a red/disconnected error state.
- If not watching, status returns to idle after cancel.
- If watching, status remains connected after cancel.
- Real share-start failures still produce the intended error behavior.
