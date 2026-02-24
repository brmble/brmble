# Design: Add Keyboard Shortcut to Toggle DM Screen

## Overview
Add a configurable keyboard shortcut to toggle the DM screen, consistent with existing voice shortcuts (toggle mute/deafen).

## Changes Required

### 1. ShortcutsSettings interface (`ShortcutsSettingsTab.tsx`)
- Add `toggleDMScreenKey: string | null` to `ShortcutsSettings` interface
- Add `toggleDMScreenKey: null` to `DEFAULT_SHORTCUTS`

### 2. ShortcutsSettingsTab UI (`ShortcutsSettingsTab.tsx`)
- Add new button "Toggle DM Screen" similar to existing shortcut buttons

### 3. App.tsx keydown handler
- Read `settings.shortcuts.toggleDMScreenKey` from settings
- When pressed (with same input-field exclusion logic as PTT), call `toggleDMMode()`

### 4. SettingsModal.tsx
- Already notifies backend on shortcut change via `handleShortcutsChange` — no changes needed beyond the new key being in the interface

## Implementation Notes
- Default to `null` (no binding) so users can configure it themselves
- Reuse existing keyboard handling pattern for PTT (ignore when typing in INPUT/TEXTAREA)
- No backend changes required; shortcut is handled client-side only
