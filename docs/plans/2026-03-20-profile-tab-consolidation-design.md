# Profile Tab Consolidation Design

Merge the separate "Profile" and "Profiles" settings tabs into a single "Profile" tab.

## Current State

- **Profile tab** (`ProfileSettingsTab`): Avatar section, Certificate section (fingerprint + server username), Manage section (global export/import)
- **Profiles tab** (`ProfilesSettingsTab`): Profile list with per-profile activate/edit/export/delete, inline add form

## New Layout (single "Profile" tab)

### Section 1: Avatar (unchanged)
Avatar display, name, upload/remove buttons. No changes.

### Section 2: Profile (replaces "Certificate")
- Dropdown/select to switch active profile (disabled when connected)
- Removes fingerprint display and "current server username"

### Section 3: Manage Profiles (replaces "Manage")
- Full profile list from ProfilesSettingsTab: items with icon, name, fingerprint, activate/edit/export/delete
- Inline add form (name + generate/import)
- Dashed "+ Add Profile" button
- Per-profile export already handled via Export button on each item
- Old global export/import buttons removed (redundant)

## Removals
- "Profiles" tab button from tab bar
- `ProfilesSettingsTab` as standalone tab (content migrates into `ProfileSettingsTab`)
- Fingerprint display from old Certificate section
- "Current server username" display
- Old global Export/Import certificate buttons

## Changes
- "Certificate" header -> "Profile" with dropdown
- "Manage" header -> "Manage Profiles" with profile list
- `ProfileSettingsTab` imports `useProfiles` hook
- `SettingsModal` removes 'profiles' tab type and button
