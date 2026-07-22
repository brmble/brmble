# Task 6 Report: Complete Regression Coverage and Validate Product Journeys

## Coverage Audit

The scoped regression suites cover the Task 6 acceptance criteria as follows:

- `src/workspace/workspaceState.test.ts`: Messages-first connection/reset behavior, zero/nonzero remote-watch thresholds, duplicate/idempotent updates, foreground preservation, invalid selected-contact fallback, manual reopen during watching, and the missing manual-close case. The new regression verifies that a manual close while a watch remains active is overridden by reopening Messages after the final watch ends.
- `src/hooks/useScreenShare.test.ts`: pending viewer shares, pending-connect cancellation, start/stop/disconnect cleanup, multiple watched shares, final-share transitions, reconnect/failure behavior, stale-event protection, and channel-scoped cleanup.
- `src/App.screenShareStart.test.ts`: remote-watch panel collapse/reopen, multiple/final duplicate updates, local-share-only behavior, pending watch collapse, manual header/shortcut actions, channel-switch cleanup, and preservation of the current foreground content.
- `src/App.dmDirectoryBehavior.test.tsx` and `src/App.chatMode.test.ts`: connection/reconnection reset, no-contact DM state, selected DM/channel preservation, invalid selected-contact fallback through `onCloseConversation`, unread badge updates without navigation, and header/native shortcut parity.
- `src/components/DMContactList/DMContactList.test.tsx`: expanded/collapsed rail state, keyboard expansion/collapse, focus handoff, unread rail badge, rapid toggles, context-menu cleanup, and preservation of search/selection state.
- `src/App.screenShareEnded.test.ts`: watched-share end notifications and duplicate/end-state handling.

## Validation Results

- Focused new regression: `npm.cmd run test -- src/workspace/workspaceState.test.ts` passed: 12 tests.
- Required workspace suites: `npm.cmd run test -- src/workspace/workspaceState.test.ts src/hooks/useScreenShare.test.ts src/components/DMContactList/DMContactList.test.tsx src/App.chatMode.test.ts src/App.screenShareStart.test.ts src/App.screenShareEnded.test.ts src/App.dmDirectoryBehavior.test.tsx` passed: 7 files, 327 tests.
- Full frontend suite: `npm.cmd run test` initially failed in `src/App.adminChannelUpdate.test.tsx` because that file's `useScreenShare` mock was missing the new `pendingViewerShares` hook field. After updating the mock, `npm.cmd run test -- src/App.adminChannelUpdate.test.tsx` passed: 1 file, 5 tests. A subsequent full `npm.cmd run test` passed: 89 files, 1,029 tests.
- Production build: `npm.cmd run build` passed (`tsc -b && vite build`).

## Manual Native Desktop QA

Manual native desktop verification cannot be performed in this headless agent context because it requires the native client running the built web bundle, desktop window behavior, and live screen-share/voice sessions.

Run the native client with the built web bundle and check:

- [ ] first connection
- [ ] channel navigation with Messages open
- [ ] first/last of multiple remote watches
- [ ] failed and reconnecting watch
- [ ] manual panel open/close beside a stream
- [ ] DM selection below stream
- [ ] channel switch
- [ ] keyboard controls
- [ ] reduced motion
- [ ] supported restored and maximized window widths

## Files Changed

- `src/Brmble.Web/src/workspace/workspaceState.test.ts`
- `src/Brmble.Web/src/App.adminChannelUpdate.test.tsx`
- `.superpowers/sdd/task-6-report.md`

## Concerns

Native desktop QA remains headless-only in this environment; use the checklist above in the native client.

The focused workspace suites emit expected diagnostics for intentionally simulated screen-share connection/discovery failures; they still pass all 327 assertions.
