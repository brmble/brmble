# Task 4 Report: Workspace State App Integration

## Implementation Summary

- Connected `useScreenShare` remote lifecycle state to the workspace reducer through `REMOTE_WATCH_COUNT_CHANGED`.
- Consumed pending viewer shares when calculating the LiveKit connecting state.
- Kept both chat panels mounted and applied workspace foreground state through ARIA visibility and pointer-event behavior.
- Added Messages-panel reflow classes and the shared `--messages-rail-width` token composition.
- Routed header and shortcut Messages toggles through one App callback.
- Disconnected viewers before user-initiated Matrix channel or server selection so previous-channel attempts are cancelled before selection state changes.

## TDD Evidence

1. Added the pending-viewer lifecycle App integration test before App consumed `remoteWatchCount`.
2. Ran `npm.cmd run test -- src/App.chatMode.test.ts src/App.screenShareStart.test.ts src/App.screenShareEnded.test.ts`.
3. The new test failed as expected: it observed `DMContactList.visible` remain `true` instead of collapsing to `false` while the viewer attempt was pending.
4. Implemented the App reducer dispatch and re-ran the suite successfully.
5. Added a follow-up App test proving an active remote watch collapses Messages without changing the selected channel foreground.

## Test Results

- `npm.cmd run test -- src/App.chatMode.test.ts src/App.screenShareStart.test.ts src/App.screenShareEnded.test.ts src/App.dmDirectoryBehavior.test.tsx`
  - Passed: 179 tests in 4 files.
  - The suite retains an expected pre-existing stderr line from the mocked rejected viewer-connect test: `Screen share error: viewer failed`.
- `npm.cmd run build`
  - Passed: TypeScript project build and Vite production build.
- `git diff --check`
  - Passed with no whitespace errors.

## Files Changed

- `src/Brmble.Web/src/App.tsx`
- `src/Brmble.Web/src/App.css`
- `src/Brmble.Web/src/App.screenShareStart.test.ts`
- `src/Brmble.Web/src/App.dmDirectoryBehavior.test.tsx`
- `.superpowers/sdd/task-4-report.md`

## Self-Review

- Remote-watch changes dispatch only the reducer event that updates `remoteWatchCount` and the Messages panel state; foreground selection remains reducer-owned and untouched by lifecycle events.
- Channel and server selection call the existing `disconnectViewer()` reference before updating the selected channel, while the existing channel-change effect remains as a defensive cleanup path.
- Local broadcasting remains excluded because `remoteWatchCount` originates from `watchingShares` plus `pendingViewerShares`, not local publishing state.
- Blocking screens remain structurally unchanged; workspace rendering applies once the connected content is visible.
- DM rail controls and icons were deliberately not added because they belong to Task 5.

## Concerns

None.
