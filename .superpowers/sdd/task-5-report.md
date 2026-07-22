# Task 5 Report: Accessible Messages Controls and Collapsed Rail

## Status

DONE

## Implementation Summary

- Added a persistent Messages-panel rail with a single keyboard-accessible toggle.
- Added exact accessible labels: `Collapse Messages panel` while expanded and `Expand Messages panel` while collapsed.
- Kept the Messages content subtree mounted. When collapsed, only that subtree receives `inert` and `aria-hidden`, preserving local search and scroll state.
- Added a collapse effect that dismisses the local contact context menu without selecting or closing a contact.
- Added centralized `chevron-left` and `chevron-right` icons and documented them in the UI guide.
- Added transition-token-based rail/content transitions plus a reduced-motion override.

## TDD Evidence

1. Added component tests before production changes.
2. Ran `npm.cmd run test -- src/components/DMContactList/DMContactList.test.tsx` before implementation.
3. The initial run failed as expected: both named panel controls were absent and an open context menu remained after collapse (4 failures, 9 passing tests).
4. Implemented the minimum behavior to satisfy those cases, then reran verification.

## Test Results

- `npm.cmd run test -- src/components/DMContactList/DMContactList.test.tsx`: PASS, 13 tests passed.
- `npm.cmd run type-check`: PASS.
- `git diff --check`: PASS before commit.

## Files Changed

- `src/Brmble.Web/src/components/DMContactList/DMContactList.tsx`
- `src/Brmble.Web/src/components/DMContactList/DMContactList.css`
- `src/Brmble.Web/src/components/DMContactList/DMContactList.test.tsx`
- `src/Brmble.Web/src/components/Icon/Icon.tsx`
- `docs/UI_GUIDE.md`

## Self-Review

- Confirmed the list, search input, and contact entries are not unmounted during automatic visibility changes.
- Confirmed the toggle remains outside the inert region, so focus stays on a usable control when collapsing.
- Confirmed rapid repeated toggles resolve to the final parent-owned `visible` state.
- Confirmed collapse clears the context menu and does not call selection or close callbacks.
- Confirmed no inline SVG was added to `DMContactList`; chevrons use the central `Icon` map.
- Confirmed only the five requested Task 5 files were committed.

## Concerns

None.

## Commit

`9a4aa4ae feat: add collapsible messages panel rail`

---

# Task 5 Review Fix Report

## Fixes

- Added focus handoff to the persistent rail toggle when a visibility transition collapses content that contains the active element; the toggle handler also hands focus off before requesting a collapse.
- Added a collapsed-only rail unread badge derived from the total `contacts` unread count, while contact-level unread badges render only when the panel is expanded.
- Kept the contact-list subtree mounted and removed the visibility transition from the opacity transition so the existing opacity token governs the visual fade without delaying visibility changes.

## Tests

- Reworked Enter and Space coverage around a stateful visibility harness, asserting label, icon, content state, and search preservation through collapse and expansion.
- Added focused-contact handoff coverage for an actual parent-owned visibility state transition.
- Added expanded/collapsed unread-indicator coverage.
- Strengthened context-menu collapse coverage to assert no select or close callbacks and retained the selected contact.

## Verification

- `npm.cmd run test -- src/components/DMContactList/DMContactList.test.tsx`: PASS, 15 tests passed.
- `npm.cmd run type-check`: PASS.
- `git diff --check`: PASS.

## Files Changed

- `src/Brmble.Web/src/components/DMContactList/DMContactList.tsx`
- `src/Brmble.Web/src/components/DMContactList/DMContactList.css`
- `src/Brmble.Web/src/components/DMContactList/DMContactList.test.tsx`
- `.superpowers/sdd/task-5-report.md`

## Concerns

- Draft preservation is not owned by `DMContactList`; this component has no draft state or draft callbacks to preserve or reset.
