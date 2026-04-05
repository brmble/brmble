# Voice Controls Context Menu Design

## Overview

Add a context menu to the mute button in the user panel that provides quick access to voice controls. The menu displays the current transmission mode setting, input volume slider, and a shortcut to open full voice settings.

## Architecture

### Component Changes

1. **Extend `ContextMenu.tsx`** — Add support for `checkbox` and `slider` item types alongside existing `item` and `divider`
2. **Extend `UserPanel.tsx`** — Add context menu state and right-click handler to the mute button
3. **New CSS** — Add styling for checkbox and slider items within context menu
4. **Update `App.tsx`** — Pass audio settings and handlers to UserPanel

### Data Flow

```
UserPanel (mute button right-click)
  └── Opens VoiceContextMenu at (x, y)
  ├── Reads settings from localStorage on open
  ├── Checkbox/slider changes → update localStorage + send bridge event
  └── Voice Settings click → App.tsx: setSettingsTab('audio'); setShowSettings(true)
```

Settings persistence uses the same bridge + localStorage approach as SettingsModal.

## New ContextMenu Item Types

```typescript
type ContextMenuItem =
  | { type: 'divider' }
  | { type: 'item'; label: string; onClick?: () => void; icon?: React.ReactNode; disabled?: boolean; children?: ContextMenuItem[] }
  | { type: 'checkbox'; label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }
  | { type: 'slider'; label: string; value: number; min: number; max: number; onChange: (value: number) => void; disabled?: boolean };
```

### Checkbox Item
- Displays label with a checkbox indicator on the right
- Click toggles the checked state and calls `onChange`
- Supports `disabled` state

### Slider Item
- Displays label with current value and a range input below
- Dragging updates the value in real-time and calls `onChange`
- Value is displayed as percentage: `${value}%`
- Min: 0, Max: 250 (matches AudioSettings inputVolume range)

## UserPanel Changes

### New Props

```typescript
interface UserPanelProps {
  // ... existing props
  audioSettings?: AudioSettings;        // For reading current values
  onAudioSettingsChange?: (settings: AudioSettings) => void;  // For writing changes
  onOpenAudioSettings?: () => void;      // For opening settings modal
}
```

### New State

```typescript
const [voiceContextMenu, setVoiceContextMenu] = useState<{ x: number; y: number } | null>(null);
```

### Mute Button Change

Add `onContextMenu` handler to the mute button:

```tsx
<button
  onContextMenu={(e) => {
    e.preventDefault();
    setVoiceContextMenu({ x: e.clientX, y: e.clientY });
  }}
  // ... existing handlers
>
```

### Context Menu Items

```
┌─────────────────────────────┐
│ ◉ Push to Talk         ☐   │  ← checkbox
│ ─────────────────────────  │
│ Input Volume         50%  ──│  ← slider
│ ─────────────────────────  │
│ ⚙ Voice Settings          │  ← opens settings on audio tab
└─────────────────────────────┘
```

- **Push to Talk checkbox**: Checked = 'pushToTalk', Unchecked = 'voiceActivity'
- **Input Volume slider**: 0-250 range, displays percentage
- **Voice Settings**: Opens SettingsModal on the Audio tab

## App.tsx Changes

### New State

Need to expose audio settings state from SettingsModal context, or read from localStorage directly in UserPanel.

**Option A** (recommended): Read settings directly in UserPanel from localStorage:
- Avoids lifting state to App.tsx
- Consistent with how SettingsModal already works
- UserPanel reads `localStorage.getItem('brmble-settings')` on menu open

**Option B**: Lift settings state to App.tsx:
- More complex refactoring
- Better for future features that need shared state
- Defer to future if needed

### Pass to UserPanel

```tsx
<UserPanel
  // ... existing props
  onOpenAudioSettings={() => {
    setSettingsTab('audio');
    setShowSettings(true);
  }}
/>
```

## Context Menu Items Detail

### Push to Talk (checkbox)
- Label: "Push to Talk"
- Checked: `transmissionMode === 'pushToTalk'`
- On change: Update `transmissionMode` to `'pushToTalk'` or `'voiceActivity'`
- Saves to localStorage and sends `settings.update` via bridge

### Input Volume (slider)
- Label: "Input Volume: {value}%"
- Value: `inputVolume` (0-250)
- Min: 0, Max: 250
- On change: Update `inputVolume`
- Saves to localStorage and sends `settings.update` via bridge

### Voice Settings (item)
- Label: "Voice Settings"
- Icon: Cog wheel SVG
- On click: Call `onOpenAudioSettings()`

## CSS Changes

Add styles for new item types in `ContextMenu.css`:

```css
.context-menu-checkbox {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-xs) var(--space-sm);
}

.context-menu-checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent-primary);
}

.context-menu-slider {
  padding: var(--space-xs) var(--space-sm);
}

.context-menu-slider label {
  display: block;
  margin-bottom: var(--space-xs);
}

.context-menu-slider input[type="range"] {
  width: 100%;
  height: 4px;
  accent-color: var(--accent-primary);
}
```

## Backward Compatibility

- `ContextMenu` remains backward compatible — existing `item` and `divider` types work unchanged
- `UserPanel` new props are all optional — existing usage continues to work
- Settings read/write uses existing bridge API

## Error Handling

- If localStorage read fails, use default values
- If bridge send fails, show toast notification
- Menu closes on any item interaction (matches existing behavior)
