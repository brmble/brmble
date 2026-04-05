# Voice Controls Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a context menu to the mute button with quick access to Push-to-Talk toggle, Input Volume slider, and Voice Settings shortcut.

**Architecture:** Extend the existing ContextMenu component with new item types (checkbox, slider). UserPanel manages context menu state and reads/writes audio settings via bridge + localStorage, matching SettingsModal patterns.

**Tech Stack:** React (UserPanel, ContextMenu), TypeScript, CSS

---

## File Structure

- Modify: `src/Brmble.Web/src/components/ContextMenu/ContextMenu.tsx` — Add checkbox/slider item types
- Modify: `src/Brmble.Web/src/components/ContextMenu/ContextMenu.css` — Add styles for new item types
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.tsx` — Add context menu state and right-click handler
- Modify: `src/Brmble.Web/src/App.tsx` — Pass audio settings handlers to UserPanel

---

## Tasks

### Task 1: Extend ContextMenu Item Types

**Files:**
- Modify: `src/Brmble.Web/src/components/ContextMenu/ContextMenu.tsx`

- [ ] **Step 1: Add new item type definitions**

Find the `ContextMenuItem` type definition (around line 6) and update it:

```typescript
type ContextMenuItem =
  | { type: 'divider' }
  | { type: 'item'; label: string; onClick?: () => void; icon?: React.ReactNode; disabled?: boolean; children?: ContextMenuItem[] }
  | { type: 'checkbox'; label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }
  | { type: 'slider'; label: string; value: number; min: number; max: number; onChange: (value: number) => void; disabled?: boolean };
```

- [ ] **Step 2: Add CheckboxMenuItem component**

Add this new component after the `MenuItem` function (before the closing of the file, around line 95):

```typescript
function CheckboxMenuItem({ item, onItemClick }: { item: { type: 'checkbox'; label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }; onItemClick: () => void }) {
  const isDisabled = item.disabled;
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className="context-menu-item-wrapper">
      <button
        className={`context-menu-item context-menu-checkbox${isDisabled ? ' context-menu-item--disabled' : ''}`}
        onClick={() => {
          if (isDisabled) return;
          item.onChange(!item.checked);
          onItemClick();
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        disabled={isDisabled}
      >
        <span className="context-menu-label">{item.label}</span>
        <input
          type="checkbox"
          checked={item.checked}
          onChange={() => {}} // Controlled by parent
          onClick={(e) => e.stopPropagation()} // Prevent double-toggle
          tabIndex={-1}
        />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Add SliderMenuItem component**

Add this new component after `CheckboxMenuItem`:

```typescript
function SliderMenuItem({ item }: { item: { type: 'slider'; label: string; value: number; min: number; max: number; onChange: (value: number) => void; disabled?: boolean } }) {
  const isDisabled = item.disabled;

  return (
    <div className={`context-menu-item-wrapper context-menu-slider${isDisabled ? ' context-menu-item--disabled' : ''}`}>
      <div className="context-menu-slider-label">
        <span className="context-menu-label">{item.label}</span>
      </div>
      <input
        type="range"
        className="context-menu-slider-input"
        min={item.min}
        max={item.max}
        value={item.value}
        onChange={(e) => item.onChange(parseInt(e.target.value, 10))}
        disabled={isDisabled}
      />
    </div>
  );
}
```

- [ ] **Step 4: Update MenuItem to render new types**

Find the `MenuItem` function and update its render logic. The function currently checks for divider. Add checks for checkbox and slider:

```typescript
function MenuItem({ item, depth, onItemClick }: MenuItemProps) {
  if (isDivider(item)) {
    return (
      <div className="context-menu-divider" role="separator" aria-orientation="horizontal" />
    );
  }

  if (item.type === 'checkbox') {
    return <CheckboxMenuItem item={item} onItemClick={onItemClick} />;
  }

  if (item.type === 'slider') {
    return <SliderMenuItem item={item} />;
  }

  if (!isMenuItem(item)) {
    return null;
  }

  // ... existing item rendering code
}
```

- [ ] **Step 5: Update handleItemClick to not close on slider changes**

Find the `handleItemClick` function and update it to keep the menu open when interacting with sliders:

```typescript
const handleItemClick = (item: ContextMenuItem) => {
  if (isMenuItem(item) && item.onClick) {
    item.onClick();
  }
  // Don't close on checkbox or slider interactions — let user continue adjusting
  if (item.type === 'item' || item.type === 'divider') {
    onClose();
  }
};
```

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/ContextMenu/ContextMenu.tsx
git commit -m "feat: add checkbox and slider item types to ContextMenu"
```

---

### Task 2: Add ContextMenu CSS Styles

**Files:**
- Modify: `src/Brmble.Web/src/components/ContextMenu/ContextMenu.css`

- [ ] **Step 1: Add checkbox and slider styles**

Add these styles at the end of the file (after line 149):

```css
.context-menu-checkbox {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.context-menu-checkbox:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.context-menu-checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent-primary);
  pointer-events: none;
  flex-shrink: 0;
}

.context-menu-slider {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  cursor: default;
}

.context-menu-slider-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.context-menu-slider-input {
  width: 100%;
  height: 4px;
  accent-color: var(--accent-primary);
  cursor: pointer;
  padding: 0;
}

.context-menu-slider-input:hover {
  accent-color: var(--accent-hover);
}

.context-menu-slider-input:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/ContextMenu/ContextMenu.css
git commit -m "feat: add checkbox and slider styles to ContextMenu"
```

---

### Task 3: Add Voice Context Menu to UserPanel

**Files:**
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.tsx`

- [ ] **Step 1: Add imports for ContextMenu**

Find the imports at the top (around line 1) and add:

```typescript
import { useState } from 'react';
import { Tooltip } from '../Tooltip/Tooltip';
import Avatar from '../Avatar/Avatar';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import type { ContextMenuItem } from '../ContextMenu/ContextMenu';
import './UserPanel.css';
```

- [ ] **Step 2: Update interface to add audio settings props**

Find the `UserPanelProps` interface (around line 6) and add:

```typescript
interface UserPanelProps {
  // ... existing props
  onOpenAudioSettings?: () => void;
}
```

- [ ] **Step 3: Update component signature and add state**

Find the component function signature and add the new prop, plus state for the context menu:

```typescript
export function UserPanel({ username, onToggleDM, dmActive, unreadDMCount, onOpenSettings, onAvatarClick, avatarUrl, matrixUserId, muted, deafened, leftVoice, canRejoin, onToggleMute, onToggleDeaf, onLeaveVoice, screenSharing, screenShareError, onToggleScreenShare, canScreenShare, speaking, pendingChannelAction, hotkeyPressedBtn, leaveVoiceOnCooldown, muteOnCooldown, deafOnCooldown, onOpenAudioSettings }: UserPanelProps) {
  const [pressedBtn, setPressedBtn] = useState<string | null>(null);
  const [voiceContextMenu, setVoiceContextMenu] = useState<{ x: number; y: number } | null>(null);
  // ... rest of existing state
```

- [ ] **Step 4: Add helper functions for settings**

Add these functions after the existing helper functions (after `handleKeyUp`):

```typescript
const getAudioSettings = (): { transmissionMode: string; inputVolume: number } => {
  try {
    const stored = localStorage.getItem('brmble-settings');
    if (stored) {
      const settings = JSON.parse(stored);
      return {
        transmissionMode: settings?.audio?.transmissionMode || 'pushToTalk',
        inputVolume: settings?.audio?.inputVolume ?? 250,
      };
    }
  } catch {}
  return { transmissionMode: 'pushToTalk', inputVolume: 250 };
};

const saveAudioSettings = (transmissionMode: string, inputVolume: number) => {
  try {
    const stored = localStorage.getItem('brmble-settings');
    const settings = stored ? JSON.parse(stored) : {};
    settings.audio = {
      ...settings.audio,
      transmissionMode,
      inputVolume,
    };
    localStorage.setItem('brmble-settings', JSON.stringify(settings));
    // Notify backend via bridge
    import('../../bridge').then(({ default: bridge }) => {
      bridge.send('settings.update', { settings });
    });
  } catch (e) {
    console.error('Failed to save audio settings:', e);
  }
};
```

- [ ] **Step 5: Add context menu items function**

Add this function before the return statement:

```typescript
const voiceContextMenuItems: ContextMenuItem[] = [
  {
    type: 'checkbox',
    label: 'Push to Talk',
    checked: getAudioSettings().transmissionMode === 'pushToTalk',
    onChange: (checked) => {
      const mode = checked ? 'pushToTalk' : 'voiceActivity';
      const { inputVolume } = getAudioSettings();
      saveAudioSettings(mode, inputVolume);
    },
  },
  { type: 'divider' },
  {
    type: 'slider',
    label: `Input Volume: ${getAudioSettings().inputVolume}%`,
    value: getAudioSettings().inputVolume,
    min: 0,
    max: 250,
    onChange: (value) => {
      const { transmissionMode } = getAudioSettings();
      saveAudioSettings(transmissionMode, value);
    },
  },
  { type: 'divider' },
  {
    type: 'item',
    label: 'Voice Settings',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
    onClick: () => {
      setVoiceContextMenu(null);
      onOpenAudioSettings?.();
    },
  },
];
```

- [ ] **Step 6: Add onContextMenu to mute button**

Find the mute button (around line 129) and add the onContextMenu handler:

```tsx
<button 
  className={`btn btn-ghost btn-icon user-panel-btn mute-btn ${(muted || leftVoice || deafened) ? 'active' : ''} ${activeBtn === 'mute' ? 'pressed' : ''} ${(leftVoice || deafened || muteOnCooldown) ? 'disabled' : ''}`}
  onMouseDown={handleMouseDown('mute')}
  onMouseUp={handleMouseUp('mute', onToggleMute)}
  onMouseLeave={handleMouseLeave}
  onKeyDown={handleKeyDown('mute')}
  onKeyUp={handleKeyUp('mute', onToggleMute)}
  onContextMenu={(e) => {
    e.preventDefault();
    setVoiceContextMenu({ x: e.clientX, y: e.clientY });
  }}
  disabled={leftVoice || deafened || muteOnCooldown}
>
```

- [ ] **Step 7: Add ContextMenu render at end of component**

Find the end of the return statement (before the closing `);` of the component) and add:

```tsx
{voiceContextMenu && (
  <ContextMenu
    x={voiceContextMenu.x}
    y={voiceContextMenu.y}
    items={voiceContextMenuItems}
    onClose={() => setVoiceContextMenu(null)}
  />
)}
```

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Web/src/components/UserPanel/UserPanel.tsx
git commit -m "feat: add voice context menu to mute button"
```

---

### Task 4: Update App.tsx to Pass Handler to UserPanel

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Find UserPanel in App.tsx and add onOpenAudioSettings prop**

Find the UserPanel component render (around line 1890) and add the new prop:

```tsx
<UserPanel
  username={username}
  // ... existing props
  onOpenAudioSettings={() => {
    setSettingsTab('audio');
    setShowSettings(true);
  }}
/>
```

- [ ] **Step 2: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: wire up onOpenAudioSettings handler to UserPanel"
```

---

### Task 5: Test the Implementation

- [ ] **Step 1: Build and check for errors**

```bash
cd src/Brmble.Web && npm run build
```

Expected: Build completes without errors

- [ ] **Step 2: Verify context menu appears**

1. Run the dev server: `npm run dev`
2. Run the client: `dotnet run --project src/Brmble.Client`
3. Connect to a server
4. Right-click the mute button
5. Verify the context menu appears with:
   - "Push to Talk" checkbox
   - "Input Volume" slider
   - "Voice Settings" item with cog icon

- [ ] **Step 3: Test checkbox interaction**

1. Check the "Push to Talk" checkbox
2. Open Settings → Audio tab
3. Verify transmission mode is set to "Push to Talk"

- [ ] **Step 4: Test slider interaction**

1. Adjust the Input Volume slider
2. Open Settings → Audio tab
3. Verify input volume matches the slider value

- [ ] **Step 5: Test Voice Settings navigation**

1. Click "Voice Settings" in the context menu
2. Verify Settings modal opens on the Audio tab

---

## Self-Review Checklist

- [ ] All ContextMenu item types implemented (checkbox, slider)
- [ ] Checkbox: entire row clickable with hover highlight
- [ ] Slider: no hover highlight on container, only thumb shows hover
- [ ] Settings persist via localStorage + bridge
- [ ] Voice Settings opens Audio tab in Settings modal
- [ ] No TypeScript errors
- [ ] Build succeeds
