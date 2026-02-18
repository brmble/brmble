# Settings Screen Enhancement Design

## Overview
Enhance the Brmble settings screen with Mumble-style options including audio controls, shortcuts, messages, and a placeholder for overlay.

## Current State
The SettingsModal (`src/Brmble.Web/src/components/SettingsModal/`) has:
- Account section (username display)
- Audio section (input/output device dropdowns, push-to-talk toggle)
- Appearance section (compact mode toggle)

## Proposed Changes

### 1. Audio Section (Enhanced)
Add volume controls to existing audio section:
- Input Volume slider (0-150%)
- Output Volume slider (0-150%)

### 2. Shortcuts Section (New)
Add a new section for keyboard shortcuts:
- Push-to-Talk key binding with "Press key to record" UI
- Display current key or show "Not bound" if unset

### 3. Messages Section (New)
Add notification preferences:
- Text-to-Speech toggle (read incoming messages aloud)
- Message notifications toggle (toast/popup for new messages)
- TTS Volume slider (when TTS enabled)

### 4. Overlay Section (Placeholder)
Add a placeholder for future overlay functionality:
- Enable overlay toggle (non-functional, displays "Coming soon" tooltip)

## UI/UX

### Layout
Use a tabbed interface within the SettingsModal:
- Tabs: Audio | Shortcuts | Messages | Overlay
- Each tab is a separate component

### Styling
- Match existing SettingsModal.css patterns
- Use toggle-input class for toggles
- Use slider elements with custom styling

## Data Flow

### Frontend State
- Settings stored in React state within SettingsModal
- Persist to localStorage for persistence between sessions

### Bridge Messages (Future)
For future backend integration:
- `settings.getAudioDevices` - Request available audio devices
- `settings.setVolume` - Set input/output volume
- `settings.setShortcut` - Set push-to-talk key
- `settings.setTTS` - Configure TTS options

## Acceptance Criteria
1. Settings modal displays tabs for Audio, Shortcuts, Messages, Overlay
2. Audio tab shows input/output device dropdowns + volume sliders + push-to-talk
3. Shortcuts tab shows push-to-talk key binding with press-to-record UI
4. Messages tab shows TTS toggle, notifications toggle, TTS volume
5. Overlay tab shows toggle (non-functional, placeholder)
6. Settings persist to localStorage
7. Existing functionality (account, appearance) preserved or integrated
