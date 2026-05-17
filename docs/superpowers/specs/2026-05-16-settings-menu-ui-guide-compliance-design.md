# Settings Menu UI Guide Compliance Design

**Date:** 2026-05-16
**Status:** Approved design

## Context

After pulling `main` to `abac4909`, the settings menu still has several UI patterns that do not match `docs/UI_GUIDE.md`. The goal is to make the settings menu a clean example for future AI agents and human contributors: no ad-hoc help text, no CSS-only tooltips, no hidden normal-user settings, no invalid nested interactive controls, no emoji/text icons where centralized icons exist, and no hardcoded visual values where tokens should be used.

## Goals

- Bring all settings tabs in line with the UI guide.
- Standardize settings `?` help on the shared `SettingsHelp` component.
- Remove plain inline settings help paragraphs under controls.
- Fix invalid nested button structure in Admin ban rows.
- Replace text delete glyphs with centralized icons.
- Replace hardcoded settings CSS values with tokens or local CSS custom properties.
- Document that Admin settings is the only place settings sub-tabs are allowed.

## Non-Goals

- Do not redesign the full settings modal.
- Do not remove Admin sub-tabs.
- Do not change settings persistence or bridge behavior.
- Do not change the meaning/defaults of any settings.
- Do not add new settings.
- Do not alter unrelated UI outside `SettingsModal` unless a shared component or guide update requires it.

## Admin Sub-Tab Exception

Admin users are advanced users. Admin settings may use sub-tabs because admin-only tasks are specialized and less frequently used.

Normal user settings must not hide settings in sub-tabs or nested menus. If a normal setting exists, it should be visible in its settings tab without requiring another submenu layer.

Update `docs/UI_GUIDE.md` to document this exception near the Settings Tab Pattern.

## Settings Help Standardization

Create or reuse `SettingsHelp` in `src/Brmble.Web/src/components/SettingsModal/SettingsHelp.tsx`. It wraps the shared `Tooltip` component and renders the preferred Screen Share style:

```tsx
<SettingsHelp content="Higher resolution uses more bandwidth" label="More information about resolution" />
```

Rules:

- Use a real `button type="button"` with `aria-label`.
- Use `Tooltip` with `position="right"` and `align="start"`.
- Use shared `.settings-info-btn`, `.settings-label-group`, and `.settings-label` styles from `SettingsModal.css`.
- Do not use CSS-only `data-tooltip` spans.
- Do not duplicate raw `Tooltip + ? button` markup in settings tabs.

Migrate:

- `AudioSettingsTab.tsx` tooltip-icon spans to `SettingsHelp`.
- `ScreenShareSettingsTab.tsx` raw `Tooltip + ?` buttons to `SettingsHelp`.

Remove:

- Audio `.tooltip-icon` CSS.
- Screen Share tab-local `.settings-info-btn`, `.settings-label-group`, and `.settings-label` CSS if duplicated.

## Inline Help Cleanup

Remove plain inline settings help paragraphs under controls. If the explanation is still useful, move it to `SettingsHelp` attached to the relevant control.

Targets:

- `AudioSettingsTab.tsx`: WaveIn microphone hint becomes `SettingsHelp` near `Input Device` or `Capture API`.
- `InterfaceSettingsTab.tsx`: overlay description is removed or moved to `SettingsHelp` near `Enable Companion Overlay`.
- `ScreenShareSettingsTab.tsx`: system audio/browser support note is removed or moved to `SettingsHelp` near `System Audio`.
- `ConnectionSettingsTab.tsx`: empty server hint is removed or moved to `SettingsHelp` near `Connect to`.

Inline text remains allowed for empty states, loading states, validation errors, and feature placeholders.

## Admin Ban Row Structure

`AdminSettingsTab.tsx` currently nests the `Unban` button inside the clickable summary button. This is invalid interactive markup.

Refactor the ban row so:

- The expand/collapse control is its own button or equivalent accessible control.
- `Unban` is a sibling button, not nested inside another button.
- Clicking the summary still expands/collapses details.
- Clicking `Unban` still opens the existing confirmation flow.
- Keyboard focus order is logical.

## Icon Cleanup

Replace delete glyphs in settings profile rows:

- `ProfileSettingsTab.tsx`: replace `✕` with `<Icon name="x" />`.
- `ProfilesSettingsTab.tsx`: replace `✕` with `<Icon name="x" />`.

The visible button meaning stays the same. Add accessible labels if missing.

## Token And CSS Cleanup

Replace hardcoded or ad-hoc visual values in settings CSS:

- `ScreenShareSettingsTab.css`: replace `16px` padding/margin with `var(--space-md)` or remove the extra padding if modal content already provides spacing.
- `ProfilesSettingsTab.css`: replace `box-shadow: 0 4px 12px ...` with an existing token or a token-backed expression that matches the guide.
- `ProfilesSettingsTab.css`: replace `gap: 0.125rem` with an existing spacing token or remove if unnecessary.
- `ProfileSettingsTab.tsx` and `ProfilesSettingsTab.tsx`: replace inline `animationDelay: ${index * 50}ms` with a CSS variable such as `--stagger-index`, and compute delay in CSS using `var(--stagger-step)`.
- `InterfaceSettingsTab.css`: remove the global `.btn-danger` override if unused. If still needed, scope it to a component-specific class.

Fixed pixel sizes for intentionally square icons/buttons may remain only when they are part of an established component pattern or local CSS custom property. Do not replace every `width: 100%` or `min-width: 0`; those are layout semantics, not token violations.

## Tests

Add or update focused tests:

- `SettingsHelp` renders an accessible question-mark help button and displays tooltip content on focus/hover.
- `AudioSettingsTab` no longer renders `.tooltip-icon` or `[data-tooltip]`.
- `ScreenShareSettingsTab` uses accessible `SettingsHelp` buttons for its help affordances.
- `AdminSettingsTab` renders ban summary and `Unban` as sibling buttons, not nested buttons, and `Unban` remains clickable.
- Profile delete buttons render the centralized `Icon` output and do not include the `✕` text glyph.

Verification commands:

```bash
cd src/Brmble.Web
npm run test -- src/components/SettingsModal/SettingsHelp.test.tsx src/components/SettingsModal/AudioSettingsTab.test.tsx src/components/SettingsModal/ScreenShareSettingsTab.test.tsx src/components/SettingsModal/AdminSettingsTab.test.tsx src/components/SettingsModal/ProfileSettingsTab.test.tsx src/components/SettingsModal/ProfilesSettingsTab.test.tsx
npm run build
```

Use existing test files when present. If a listed test file does not exist, create the smallest focused test file needed.

## Success Criteria

- No SettingsModal code uses CSS-only `tooltip-icon` / `data-tooltip` help.
- Settings tabs use `SettingsHelp` for `?` explanations.
- Plain inline help paragraphs under settings controls are removed or converted to `SettingsHelp`.
- Admin ban rows have no nested buttons.
- Profile delete buttons use `<Icon name="x" />`.
- Targeted settings tests pass.
- Frontend build passes.
- `docs/UI_GUIDE.md` documents Admin-only settings sub-tabs and the normal-user no-submenu rule.
