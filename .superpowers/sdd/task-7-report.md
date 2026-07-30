# Task 7 Report: Selection Types, Server-Scoped Persistence, and Safe Rendering

## Status

DONE

## What Changed

- Added the exact built-in, custom, and combined companion selection types:
  `BuiltInCompanionId`, `CustomCompanionId`, and `CompanionSelection`.
- Added strict custom ID normalization for `custom:<matrix-event-id>` values while
  preserving all built-in IDs and the legacy `clip` to `floppy` fallback.
- Added `OverlaySettings.companionSelectionsByServer`, normalization of persisted
  server maps, and `companionForServer` lookup with the legacy `myCompanion`
  fallback.
- Mirrored the server selection map in native `OverlaySettings` as a non-null
  `Dictionary<string, string>` so old configs deserialize to an empty map and new
  values round-trip through native settings.
- Added `resolveCompanionDisplay(selection, gallery)` to keep requested selections
  separate from renderable displays. Custom selections render only when matching,
  non-redacted metadata exists and the scoped atlas cache key is ready; all other
  custom states render `floppy`.
- Integrated the custom companion gallery into `App` without warming the metadata
  list. The local selected custom companion is requested on demand, and a remote
  custom companion is requested only when that user is the active rendered
  display.
- Stored the capability's server-returned `selectedCompanionId` under
  `capability.galleryRoomId`, persisted optimistic user changes, and restored the
  complete previous overlay settings in React, local storage, and native settings
  when `voice.setCompanion` fails.
- Preserved unsupported-server behavior: custom selections are never applied
  without the capability, while built-in selections remain available.
- Preferred additive `customCompanionId` values when present while keeping legacy
  `companionId: "floppy"` payloads compatible.
- Carried optional `atlasCacheKey` values through companion lookup entries, local
  user state, idle/event/speaker displays, bridge snapshots, and the full overlay.
- Protected all currently rendered atlas keys during cache writes/pruning and
  guarded async completions against server changes and redactions.
- Updated `CompanionSprite` to read custom blobs from IndexedDB, display the
  built-in floppy atlas until the read succeeds, create one object URL for the
  mounted custom sprite, and revoke it on key change or unmount.

## Test Results

- Required focused suite:
  `npm.cmd run test -- src/components/SettingsModal/InterfaceSettingsTypes.test.ts src/components/CompanionOverlay src/App.customCompanion.test.tsx`
  - PASS: 8 files, 49 tests.
- Existing App regression suite:
  `npm.cmd run test -- src/App.screenShareStart.test.ts`
  - PASS: 1 file, 95 tests.
- Frontend production build:
  `npm.cmd run build`
  - PASS: TypeScript project build and Vite production bundle.
- Native client suite:
  `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --no-restore`
  - PASS: 281 tests, 0 failed, 0 skipped.
- `git diff --check`
  - PASS: no whitespace errors.

## TDD Evidence

1. Added normalization, independent server scope, readiness fallback, redaction,
   dual-field compatibility, IndexedDB read, and object URL cleanup tests before
   production changes.
2. Ran the required initial focused command.
3. Confirmed the expected red state: 3 test files failed, with 10 failing and 11
   passing tests. Failures were specifically caused by unsupported custom IDs,
   missing `companionForServer`, missing `resolveCompanionDisplay`, missing bridge
   selection normalization, and the custom sprite indexing the built-in atlas map.
4. Implemented only the Task 7 production behavior.
5. Re-ran the focused tests. One intermediate failure identified retained mock call
   history between URL lifecycle tests; the test setup was isolated, then all 49
   focused tests passed.
6. Ran the broader App suite, frontend build, and native suite after the final
   self-review fixes.

## Files Changed

- `src/Brmble.Client/Services/AppConfig/AppSettings.cs`
- `src/Brmble.Web/src/App.tsx`
- `src/Brmble.Web/src/App.customCompanion.test.tsx`
- `src/Brmble.Web/src/components/CompanionOverlay/CompanionSprite.test.tsx`
- `src/Brmble.Web/src/components/CompanionOverlay/CompanionSprite.tsx`
- `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.tsx`
- `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts`
- `src/Brmble.Web/src/components/CompanionOverlay/overlayTypes.ts`
- `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.test.ts`
- `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.ts`

## Self-Review

- Requirements coverage: verified selection types, normalization, server-scoped
  persistence, credential restore, optimistic rollback, unsupported capability
  fallback, local selected-only requests, remote rendered-only requests, cache-key
  propagation, protected keys, IndexedDB reads, object URL cleanup, deletion,
  temporary recovery, permanent redaction, and dual-field compatibility.
- Backward compatibility: built-in IDs retain their prior atlas and overlay
  behavior; `myCompanion` remains the fallback for old settings and servers.
- Request discipline: searched all Task 7 call sites and confirmed there is one
  App atlas request path, driven only by the selected local companion, the active
  remote display, or an explicit user selection. No metadata iteration requests
  media.
- Async safety: old-room atlas completions cannot mark keys ready after a server
  switch; redacted entries cannot become renderable; object URLs are revoked by
  both the requesting App lifecycle and mounted sprite lifecycle.
- Scope: no upload/picker UI or moderation UI was added. Unrelated untracked files
  were not modified or staged.

## Concerns

None.

## Re-review Fix: Prevent Stale Custom Atlas Rendering

### Summary

- Bound the mounted custom object URL to both the companion ID and its atlas cache key.
- The sprite now derives its displayed atlas during render: it uses a custom URL only
  when that URL belongs to the current custom companion and cache key; otherwise it
  immediately uses the built-in floppy atlas.
- Kept the existing async IndexedDB lookup and object URL revocation on replacement
  and unmount.
- Added rerender regressions for custom-to-floppy and custom-to-custom transitions.

### Tests Run

- `npm.cmd run test -- src/components/CompanionOverlay/CompanionSprite.test.tsx src/components/CompanionOverlay/overlayModel.test.ts src/App.customCompanion.test.tsx`
  - PASS: 3 files, 32 tests.
- `npm.cmd run test -- src/components/SettingsModal/InterfaceSettingsTypes.test.ts src/components/CompanionOverlay/overlayModel.test.ts src/components/CompanionOverlay/CompanionSprite.test.tsx src/hooks/useCustomCompanionGallery.test.tsx src/App.customCompanion.test.tsx src/hooks/useCompanionOverlayPublisher.test.ts`
  - PASS: 6 files, 59 tests.

### Files Changed

- `src/Brmble.Web/src/components/CompanionOverlay/CompanionSprite.tsx`
- `src/Brmble.Web/src/components/CompanionOverlay/CompanionSprite.test.tsx`
- `.superpowers/sdd/task-7-report.md`

### Concerns

None.

## Review Fix: Exact Optimistic Rollback and App Integration Coverage

### Summary

- Removed the legacy `previousCompanion` value from the live-change callback
  contract.
- Captured the complete authoritative `overlaySettingsRef.current` object before
  each optimistic companion update and stored that exact object with the pending
  request.
- Restored the complete snapshot on failure, preserving the prior custom
  selection for the current gallery room, every other server selection, the
  built-in fallback, and all overlay flags.
- Added real `App` rendering tests for exact rollback, server-map credential
  persistence, and unsupported-capability request behavior while retaining the
  existing helper regressions.

### TDD Evidence

- Before the production fix:
  `npm.cmd run test -- src/App.customCompanion.test.tsx`
  - FAIL: 1 file, 1 failed and 6 passed tests.
  - The rollback test received `!gallery:test: "retro"` instead of the exact
    previous `custom:$sprite:test` selection.
- After the production fix:
  `npm.cmd run test -- src/App.customCompanion.test.tsx`
  - PASS: 1 file, 7 tests.

### Required Verification

- `npm.cmd run test -- src/components/SettingsModal/InterfaceSettingsTypes.test.ts src/components/CompanionOverlay/overlayModel.test.ts src/components/CompanionOverlay/CompanionSprite.test.tsx src/hooks/useCustomCompanionGallery.test.tsx src/App.customCompanion.test.tsx src/hooks/useCompanionOverlayPublisher.test.ts`
  - PASS: 6 files, 57 tests.
- `npm.cmd run build`
  - PASS: TypeScript project build and Vite production bundle.
- `git diff --check`
  - PASS: no whitespace errors.

### Files Changed

- `src/Brmble.Web/src/App.tsx`
- `src/Brmble.Web/src/App.customCompanion.test.tsx`
- `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- `.superpowers/sdd/task-7-report.md`

### Concerns

None.

## Re-review Fix: Modal-Owned Rollback and Sprite URL Re-entry

### Summary

- Changed the real `SettingsModal` companion callback to carry the complete
  modal-owned overlay object from immediately before the companion change.
- Updated `App` to build the optimistic selection and retain its rollback from
  that authoritative modal snapshot instead of `overlaySettingsRef.current`.
- Replaced the mocked modal/direct callback App coverage with a real modal
  interaction that changes an overlay flag, changes the companion before any
  `settings.updated` echo, rejects the companion request, and verifies the
  preceding flag change survives rollback.
- Cleared the custom atlas state owned by a departing sprite effect when its
  object URL is revoked, guarded by URL identity so stale cleanup cannot clear a
  newer atlas.
- Added a custom A to floppy to custom A regression with the returning IndexedDB
  read held pending, verifying the revoked URL is not rendered again.

### TDD Evidence

- Before the production fixes:
  `npm.cmd run test -- src/components/CompanionOverlay/CompanionSprite.test.tsx src/App.customCompanion.test.tsx`
  - FAIL: 2 files, 2 failed and 12 passed tests after test-fixture corrections.
  - App restored `showChannelMessages: true` instead of the modal-owned
    pre-change value `false`.
  - `CompanionSprite` rendered `url("blob:custom-atlas")` after that URL had been
    revoked and custom A was selected again.

### Tests Run

- Required focused suite:
  `npm.cmd run test -- src/components/SettingsModal/SettingsModal.test.tsx src/components/CompanionOverlay/CompanionSprite.test.tsx src/App.customCompanion.test.tsx`
  - PASS: 3 files, 22 tests.
- Broader focused suite:
  `npm.cmd run test -- src/components/SettingsModal/InterfaceSettingsTypes.test.ts src/components/SettingsModal/SettingsModal.test.tsx src/components/CompanionOverlay/overlayModel.test.ts src/components/CompanionOverlay/CompanionSprite.test.tsx src/hooks/useCustomCompanionGallery.test.tsx src/App.customCompanion.test.tsx src/hooks/useCompanionOverlayPublisher.test.ts`
  - PASS: 7 files, 68 tests.
- `npm.cmd run build`
  - PASS: TypeScript project build and Vite production bundle.
- `git diff --check`
  - PASS: no whitespace errors.

### Files Changed

- `src/Brmble.Web/src/App.tsx`
- `src/Brmble.Web/src/App.customCompanion.test.tsx`
- `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- `src/Brmble.Web/src/components/CompanionOverlay/CompanionSprite.tsx`
- `src/Brmble.Web/src/components/CompanionOverlay/CompanionSprite.test.tsx`
- `.superpowers/sdd/task-7-report.md`

### Concerns

None.
