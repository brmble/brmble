# Chat Image Paint Background Final Fix Report

## Scope

Reviewed the implementation plan at `docs/superpowers/plans/2026-07-26-chat-image-paint-background.md` and the final review package at `.superpowers/sdd/chat-image-final-review-c8c8f25..9ce3f46.diff`.

Changed only the requested paint-background boundaries:

- `src/Brmble.Web/src/App.tsx`
- `src/Brmble.Web/src/App.dmDirectoryBehavior.test.tsx`
- `src/Brmble.Web/src/components/ChatPanel/ImageAttachment.tsx`
- `src/Brmble.Web/src/components/ChatPanel/ChatPanel.test.tsx`

Existing unrelated worktree changes were left untouched.

## Root Causes

1. The channel `ChatPanel` received the paint-background callback whenever paint setup was available, even while a paint session was active. A retained callback could still open the confirmation prompt after a session began.
2. `ImageAttachment` forwarded every image context-menu event before its image load completed. The error fallback did not forward events, but the normal loading button did.
3. Chat-image preparation used an async continuation without associating it with the setup state that initiated it. A late success could reopen setup after cancellation, and a late failure could replace a newer setup action with an error notification.

## Fixes

### Active Session Boundary

- The normal channel `ChatPanel` now receives `onUseAsPaintBackground` only when paint setup is available and `activePaintSessionId` is null.
- The prop is omitted entirely while a session is active.
- The callback also checks current paint eligibility before it opens the confirmation prompt, so a retained stale callback cannot open or replace setup.

### Image Readiness Boundary

- `ImageAttachment` now invokes its image context-menu callback only after `onLoad` has completed and while it has no error.
- Existing positive context-menu coverage explicitly fires the image `load` event before asserting the paint action.
- A focused loading-state regression test confirms the paint action is unavailable before load.

### Stale Preparation Boundary

- Added a monotonic preparation generation ref in `App`.
- Each chat-image action captures its generation and source channel before confirmation.
- The continuation verifies that generation, channel, current availability, and active-session state after confirmation and again after the image preparation await.
- Stale successes and failures now return without changing setup state or showing an error.
- Pending preparation is invalidated on ordinary header setup open, setup close/cancel, setup completion, active paint open/close and automatic active-session clearing, channel changes, disconnects, and other unavailable paint states.

## Tests Added Or Updated

- Active session test: verifies the channel panel receives no paint-background callback while paint is active, and a previously captured callback opens neither confirmation nor setup.
- Loading-state test: verifies an unloaded image cannot expose the paint action.
- Existing positive image-menu test: fires `load` before expecting the action.
- Stale success test: verifies a late preparation cannot reopen setup after newer header setup is cancelled.
- Stale failure test: verifies a late preparation failure cannot replace newer header setup with an error notification.

## TDD Evidence

Before the implementation, the focused test run failed with the expected four regressions:

- Paint action appeared before image load.
- The callback remained on the channel panel during an active session.
- A late successful preparation reopened cancelled setup.
- A late failed preparation displayed the preparation error.

## Verification

Passed:

```text
npm.cmd run test -- src/components/ChatPanel/ChatPanel.test.tsx src/App.dmDirectoryBehavior.test.tsx src/App.paintFlow.test.tsx
3 test files passed, 47 tests passed

npm.cmd run type-check
tsc -b tsconfig.test.json --force passed
```
