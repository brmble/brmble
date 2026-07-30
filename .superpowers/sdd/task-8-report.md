# Task 8 Report: Upload Dialog and Sectioned Companion Picker

## What Changed

- Added the case-insensitive PNG/WebP browser file policy with matching non-empty
  MIME enforcement and empty-MIME allowance for server verification.
- Added a sectioned companion picker with fixed built-ins, distinct custom
  loading/empty/unavailable/ready states, duplicate-name uploader context,
  selected state, viewport-triggered thumbnails, and explicit selected-atlas
  requests.
- Added the custom companion upload dialog with exact guidance and privacy copy,
  5 MiB/name validation, best-effort object-URL preview probing, representative
  rows 1/4/9, server-code error mapping, retry-preserved input, URL cleanup, and
  the required idle/uploading-media/creating-entry/success/error state machine.
- Integrated the picker and upload dialog into full companion mode in Interface
  settings and wired the live gallery and Matrix client from App.
- Locked dialog and parent settings close paths during active media upload or
  gallery-entry creation.
- Documented the Companion Picker Pattern in `docs/UI_GUIDE.md`.

## Test Results

- `npm.cmd run test -- src/components/SettingsModal/customCompanions src/components/SettingsModal/InterfaceSettingsTab.test.tsx src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx`
  - PASS: 5 files, 37 tests.
- `npm.cmd run test -- src/components/SettingsModal/SettingsModal.test.tsx src/App.customCompanion.test.tsx`
  - PASS: 2 files, 16 tests.
- `npm.cmd run type-check`
  - PASS.
- `npm.cmd run build`
  - PASS.
- Focused ESLint for the new custom companion files and Interface settings files
  - PASS.
- `git diff --check`
  - PASS.

## TDD Evidence

1. Added the policy, picker, and upload dialog tests before production files.
2. Ran the brief's focused custom-companion command and observed three expected
   module-resolution failures because the production modules did not exist.
3. Implemented the minimum policy/picker/dialog behavior and reran the suite:
   34 tests passed.
4. Added the Interface settings integration test before integration code and
   observed the expected failure because the old flat Select was still rendered.
5. Implemented settings/App wiring and reran the exact Task 8 focused command:
   37 tests passed.
6. Ran SettingsModal and App custom-companion regressions, updated the old
   dropdown-coupled App test helper for the sectioned picker, and confirmed all
   16 regression tests passed.

## Files Changed

- `.superpowers/sdd/task-8-report.md`
- `docs/UI_GUIDE.md`
- `src/Brmble.Web/src/App.tsx`
- `src/Brmble.Web/src/App.customCompanion.test.tsx`
- `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`
- `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.css`
- `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.test.tsx`
- `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- `src/Brmble.Web/src/components/SettingsModal/customCompanions/CompanionPicker.tsx`
- `src/Brmble.Web/src/components/SettingsModal/customCompanions/CompanionPicker.css`
- `src/Brmble.Web/src/components/SettingsModal/customCompanions/CompanionPicker.test.tsx`
- `src/Brmble.Web/src/components/SettingsModal/customCompanions/customCompanionFilePolicy.ts`
- `src/Brmble.Web/src/components/SettingsModal/customCompanions/customCompanionFilePolicy.test.ts`
- `src/Brmble.Web/src/components/SettingsModal/customCompanions/CustomCompanionUploadDialog.tsx`
- `src/Brmble.Web/src/components/SettingsModal/customCompanions/CustomCompanionUploadDialog.css`
- `src/Brmble.Web/src/components/SettingsModal/customCompanions/CustomCompanionUploadDialog.test.tsx`

## Self-Review

- Confirmed gallery metadata/rendering does not call thumbnail or atlas loaders.
- Confirmed custom rows use `useViewportThumbnail`; thumbnail failure never
  falls back to a full atlas.
- Confirmed selecting one custom row requests only that entry's full atlas.
- Confirmed create receives only trimmed `name` and uploaded `content_uri`;
  browser dimensions and MIME are not included in the create request.
- Confirmed unsupported type, over-size file, and invalid name block submission,
  while preview failure and unusual dimensions do not.
- Confirmed all active phases suppress duplicate submission and disable file
  replacement, Cancel, Escape, overlay close, and parent Settings close.
- Confirmed object URLs are revoked on file replacement and dialog unmount.
- Confirmed the capability-disabled gallery omits Custom while preserving all
  built-in choices.
- Fixed a React ref lint finding by separating the viewport callback ref from
  thumbnail render state.
- No Task 9 moderation UI was added.

## Concerns

- Automated visual browser inspection could not run because the browser policy
  rejected the local `127.0.0.1` preview URL. Responsive layout is covered by
  token-based CSS, component tests, focused lint, type checking, and a production
  build, but Classic/Retro visual screenshots were not captured.
- A broad lint invocation also reports longstanding errors in App and
  SettingsModal outside this change. Focused lint for the new files and modified
  Interface settings files passes.

## Review Fix: Active Upload Tab Lock

### Summary

- Disabled every Settings tab while a custom companion media upload or gallery
  entry creation is active, and added a guarded tab-change callback so direct
  activation cannot unmount the Interface tab or its upload dialog.
- Added a pending-upload regression that attempts tab activation by click and
  keyboard, verifies the Interface picker and upload dialog remain mounted, and
  confirms Settings Escape and overlay close stay locked until completion.

### Tests Run

- `npm.cmd run test -- src/components/SettingsModal/customCompanions src/components/SettingsModal/InterfaceSettingsTab.test.tsx src/components/SettingsModal/SettingsModal.test.tsx src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx`
  - PASS: 6 files, 46 tests.

### Files Changed

- `.superpowers/sdd/task-8-report.md`
- `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- `src/Brmble.Web/src/components/SettingsModal/SettingsModal.test.tsx`

## Re-Review Fix: Preserve Active Upload During Prop Synchronization

### Summary

- Guarded the `initialTab` synchronization effect while a custom companion
  upload or entry creation is active, so prop-driven tab updates cannot unmount
  the Interface tab and clear the parent upload lock.
- Extended the pending-upload regression to rerender the modal with a different
  `initialTab`, verify the Interface picker and upload dialog remain mounted,
  retain the existing click/keyboard close-lock assertions, and confirm Close
  becomes available only after the upload flow completes.

### Tests Run

- `npm.cmd run test -- src/components/SettingsModal/SettingsModal.test.tsx src/components/SettingsModal/customCompanions src/components/SettingsModal/InterfaceSettingsTab.test.tsx src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx`
  - PASS: 6 files, 46 tests.

### Files Changed

- `.superpowers/sdd/task-8-report.md`
- `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- `src/Brmble.Web/src/components/SettingsModal/SettingsModal.test.tsx`

## Final Re-Review Fix: Nested Escape Handling

### Summary

- The upload dialog now claims Escape during the capture phase and prevents the
  parent Settings handler from processing the same key event.
- Idle Escape closes only the upload dialog, leaving Settings open. During
  `uploading-media` and `creating-entry`, the dialog still claims Escape but
  closes neither dialog, preserving the existing active-upload lock.
- Existing active tab and `initialTab` upload-lock behavior remains covered by
  the integration regression.

### Tests Run

- `npm.cmd run test -- src/components/SettingsModal/SettingsModal.test.tsx src/components/SettingsModal/customCompanions src/components/SettingsModal/InterfaceSettingsTab.test.tsx src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx`
  - PASS: 6 files, 47 tests.

### Files Changed

- `.superpowers/sdd/task-8-report.md`
- `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- `src/Brmble.Web/src/components/SettingsModal/SettingsModal.test.tsx`
- `src/Brmble.Web/src/components/SettingsModal/customCompanions/CustomCompanionUploadDialog.tsx`

### Visual Verification

- Classic/Retro visual verification remains for the controller; no new visual
  browser verification was performed for this focused keyboard-handling fix.
