# Settings Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance the Brmble settings screen with Mumble-style options including audio volume controls, shortcuts for push-to-talk, message notification settings, and overlay placeholder.

**Architecture:** Use a tabbed UI within the SettingsModal. Settings persist to localStorage. Each settings section is a separate React component.

**Tech Stack:** React + TypeScript + CSS (frontend), localStorage (persistence)

---

### Task 1: Add tab navigation to SettingsModal

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.css`

**Step 1: Add tab state and structure**

```tsx
// Add state for active tab
const [activeTab, setActiveTab] = useState<'audio' | 'shortcuts' | 'messages' | 'overlay'>('audio');

// Add tabs navigation in the modal
<div className="settings-tabs">
  <button 
    className={`settings-tab ${activeTab === 'audio' ? 'active' : ''}`}
    onClick={() => setActiveTab('audio')}
  >
    Audio
  </button>
  <button 
    className={`settings-tab ${activeTab === 'shortcuts' ? 'active' : ''}`}
    onClick={() => setActiveTab('shortcuts')}
  >
    Shortcuts
  </button>
  <button 
    className={`settings-tab ${activeTab === 'messages' ? 'active' : ''}`}
    onClick={() => setActiveTab('messages')}
  >
    Messages
  </button>
  <button 
    className={`settings-tab ${activeTab === 'overlay' ? 'active' : ''}`}
    onClick={() => setActiveTab('overlay')}
  >
    Overlay
  </button>
</div>
```

**Step 2: Add tab content conditional rendering**

```tsx
<div className="settings-content">
  {activeTab === 'audio' && <AudioSettingsTab />}
  {activeTab === 'shortcuts' && <ShortcutsSettingsTab />}
  {activeTab === 'messages' && <MessagesSettingsTab />}
  {activeTab === 'overlay' && <OverlaySettingsTab />}
</div>
```

**Step 3: Add CSS for tabs**

```css
.settings-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  border-bottom: 1px solid #3a3a3a;
}

.settings-tab {
  padding: 10px 16px;
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 14px;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.settings-tab:hover {
  color: #ccc;
}

.settings-tab.active {
  color: #fff;
  border-bottom-color: #4a9eff;
}
```

**Step 4: Test and verify tabs work**

Run: `cd src/Brmble.Web && npm run dev`
Verify: Settings modal shows 4 tabs, clicking switches content

---

### Task 2: Create AudioSettingsTab component

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`
- Create: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx` (import and render)

**Step 1: Create AudioSettingsTab with volume controls**

```tsx
import { useState, useEffect } from 'react';
import './AudioSettingsTab.css';

interface AudioSettingsTabProps {
  settings: AudioSettings;
  onChange: (settings: AudioSettings) => void;
}

export interface AudioSettings {
  inputDevice: string;
  outputDevice: string;
  inputVolume: number;
  outputVolume: number;
  pushToTalk: boolean;
}

const DEFAULT_SETTINGS: AudioSettings = {
  inputDevice: 'default',
  outputDevice: 'default',
  inputVolume: 100,
  outputVolume: 100,
  pushToTalk: false,
};

export function AudioSettingsTab({ settings, onChange }: AudioSettingsTabProps) {
  const [localSettings, setLocalSettings] = useState<AudioSettings>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleChange = (key: keyof AudioSettings, value: string | number | boolean) => {
    const newSettings = { ...localSettings, [key]: value };
    setLocalSettings(newSettings);
    onChange(newSettings);
  };

  return (
    <div className="audio-settings-tab">
      <div className="settings-item">
        <label>Input Device</label>
        <select
          className="settings-select"
          value={localSettings.inputDevice}
          onChange={(e) => handleChange('inputDevice', e.target.value)}
        >
          <option value="default">Default</option>
        </select>
      </div>

      <div className="settings-item">
        <label>Output Device</label>
        <select
          className="settings-select"
          value={localSettings.outputDevice}
          onChange={(e) => handleChange('outputDevice', e.target.value)}
        >
          <option value="default">Default</option>
        </select>
      </div>

      <div className="settings-item settings-slider">
        <label>Input Volume: {localSettings.inputVolume}%</label>
        <input
          type="range"
          min="0"
          max="150"
          value={localSettings.inputVolume}
          onChange={(e) => handleChange('inputVolume', parseInt(e.target.value))}
        />
      </div>

      <div className="settings-item settings-slider">
        <label>Output Volume: {localSettings.outputVolume}%</label>
        <input
          type="range"
          min="0"
          max="150"
          value={localSettings.outputVolume}
          onChange={(e) => handleChange('outputVolume', parseInt(e.target.value))}
        />
      </div>

      <div className="settings-item settings-toggle">
        <label>Push to Talk</label>
        <input
          type="checkbox"
          className="toggle-input"
          checked={localSettings.pushToTalk}
          onChange={(e) => handleChange('pushToTalk', e.target.checked)}
        />
      </div>
    </div>
  );
}

export { DEFAULT_SETTINGS };
```

**Step 2: Add slider CSS**

```css
.settings-slider {
  flex-direction: column;
  align-items: flex-start;
}

.settings-slider label {
  margin-bottom: 8px;
}

.settings-slider input[type="range"] {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  background: #3a3a3a;
  border-radius: 3px;
  outline: none;
}

.settings-slider input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  background: #4a9eff;
  border-radius: 50%;
  cursor: pointer;
}

.settings-slider input[type="range"]::-webkit-slider-thumb:hover {
  background: #5aafff;
}
```

**Step 3: Test audio tab renders correctly**

Verify: Audio tab shows device dropdowns, volume sliders, and push-to-talk toggle

---

### Task 3: Create ShortcutsSettingsTab component

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx`
- Create: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`

**Step 1: Create ShortcutsSettingsTab with key binding UI**

```tsx
import { useState, useEffect, useCallback } from 'react';
import './ShortcutsSettingsTab.css';

interface ShortcutsSettingsTabProps {
  settings: ShortcutsSettings;
  onChange: (settings: ShortcutsSettings) => void;
}

export interface ShortcutsSettings {
  pushToTalkKey: string | null;
}

const DEFAULT_SHORTCUTS: ShortcutsSettings = {
  pushToTalkKey: null,
};

export function ShortcutsSettingsTab({ settings, onChange }: ShortcutsSettingsTabProps) {
  const [recording, setRecording] = useState(false);
  const [localSettings, setLocalSettings] = useState<ShortcutsSettings>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    
    const key = e.code === 'Space' ? 'Space' : e.key;
    const newSettings = { ...localSettings, pushToTalkKey: key };
    setLocalSettings(newSettings);
    onChange(newSettings);
    setRecording(false);
  }, [recording, localSettings, onChange]);

  useEffect(() => {
    if (recording) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [recording, handleKeyDown]);

  return (
    <div className="shortcuts-settings-tab">
      <div className="settings-item">
        <label>Push to Talk</label>
        <button
          className={`key-binding-btn ${recording ? 'recording' : ''}`}
          onClick={() => setRecording(!recording)}
        >
          {recording ? 'Press any key...' : (localSettings.pushToTalkKey || 'Not bound')}
        </button>
      </div>
      
      <p className="settings-hint">
        Click the button and press a key to set it as your push-to-talk shortcut.
      </p>
    </div>
  );
}

export { DEFAULT_SHORTCUTS };
```

**Step 2: Add key binding CSS**

```css
.key-binding-btn {
  padding: 8px 16px;
  background: #2a2a2a;
  border: 1px solid #4a4a4a;
  border-radius: 4px;
  color: #ccc;
  cursor: pointer;
  font-size: 14px;
  min-width: 120px;
  transition: all 0.2s;
}

.key-binding-btn:hover {
  background: #3a3a3a;
  border-color: #5a5a5a;
}

.key-binding-btn.recording {
  background: #4a2a2a;
  border-color: #ff6b6b;
  color: #ff6b6b;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.settings-hint {
  color: #666;
  font-size: 12px;
  margin-top: 12px;
}
```

**Step 3: Test shortcuts tab**

Verify: Clicking button enters recording mode, pressing a key sets it as shortcut

---

### Task 4: Create MessagesSettingsTab component

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.tsx`
- Create: `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`

**Step 1: Create MessagesSettingsTab**

```tsx
import { useState, useEffect } from 'react';
import './MessagesSettingsTab.css';

interface MessagesSettingsTabProps {
  settings: MessagesSettings;
  onChange: (settings: MessagesSettings) => void;
}

export interface MessagesSettings {
  ttsEnabled: boolean;
  ttsVolume: number;
  notificationsEnabled: boolean;
}

const DEFAULT_MESSAGES: MessagesSettings = {
  ttsEnabled: false,
  ttsVolume: 100,
  notificationsEnabled: true,
};

export function MessagesSettingsTab({ settings, onChange }: MessagesSettingsTabProps) {
  const [localSettings, setLocalSettings] = useState<MessagesSettings>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleChange = (key: keyof MessagesSettings, value: boolean | number) => {
    const newSettings = { ...localSettings, [key]: value };
    setLocalSettings(newSettings);
    onChange(newSettings);
  };

  return (
    <div className="messages-settings-tab">
      <div className="settings-item settings-toggle">
        <label>Text-to-Speech</label>
        <input
          type="checkbox"
          className="toggle-input"
          checked={localSettings.ttsEnabled}
          onChange={(e) => handleChange('ttsEnabled', e.target.checked)}
        />
      </div>

      {localSettings.ttsEnabled && (
        <div className="settings-item settings-slider">
          <label>TTS Volume: {localSettings.ttsVolume}%</label>
          <input
            type="range"
            min="0"
            max="100"
            value={localSettings.ttsVolume}
            onChange={(e) => handleChange('ttsVolume', parseInt(e.target.value))}
          />
        </div>
      )}

      <div className="settings-item settings-toggle">
        <label>Message Notifications</label>
        <input
          type="checkbox"
          className="toggle-input"
          checked={localSettings.notificationsEnabled}
          onChange={(e) => handleChange('notificationsEnabled', e.target.checked)}
        />
      </div>
    </div>
  );
}

export { DEFAULT_MESSAGES };
```

**Step 2: Test messages tab**

Verify: TTS toggle, TTS volume (shown when enabled), notifications toggle

---

### Task 5: Create OverlaySettingsTab component (placeholder)

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/OverlaySettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`

**Step 1: Create placeholder OverlaySettingsTab**

```tsx
import './OverlaySettingsTab.css';

interface OverlaySettingsTabProps {
  settings: OverlaySettings;
  onChange: (settings: OverlaySettings) => void;
}

export interface OverlaySettings {
  overlayEnabled: boolean;
}

const DEFAULT_OVERLAY: OverlaySettings = {
  overlayEnabled: false,
};

export function OverlaySettingsTab({ settings, onChange }: OverlaySettingsTabProps) {
  const handleToggle = () => {
    onChange({ ...settings, overlayEnabled: !settings.overlayEnabled });
  };

  return (
    <div className="overlay-settings-tab">
      <div className="settings-item settings-toggle">
        <label>Enable Overlay</label>
        <input
          type="checkbox"
          className="toggle-input"
          checked={settings.overlayEnabled}
          onChange={handleToggle}
        />
      </div>
      <p className="settings-hint">
        Overlay feature coming soon. This will allow you to see status information over other applications.
      </p>
    </div>
  );
}

export { DEFAULT_OVERLAY };
```

**Step 2: Add CSS (same hint style as shortcuts)**

```css
.overlay-settings-tab .settings-hint {
  color: #666;
  font-size: 12px;
  margin-top: 12px;
}
```

---

### Task 6: Wire up settings state and localStorage persistence

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`

**Step 1: Add settings state management**

```tsx
import { useState, useEffect } from 'react';
import { AudioSettingsTab, DEFAULT_SETTINGS as DEFAULT_AUDIO } from './AudioSettingsTab';
import { ShortcutsSettingsTab, DEFAULT_SHORTCUTS } from './ShortcutsSettingsTab';
import { MessagesSettingsTab, DEFAULT_MESSAGES } from './MessagesSettingsTab';
import { OverlaySettingsTab, DEFAULT_OVERLAY } from './OverlaySettingsTab';

interface AppSettings {
  audio: AudioSettings;
  shortcuts: ShortcutsSettings;
  messages: MessagesSettings;
  overlay: OverlaySettings;
}

const STORAGE_KEY = 'brmble-settings';

const DEFAULT_SETTINGS: AppSettings = {
  audio: DEFAULT_AUDIO,
  shortcuts: DEFAULT_SHORTCUTS,
  messages: DEFAULT_MESSAGES,
  overlay: DEFAULT_OVERLAY,
};

function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return DEFAULT_SETTINGS;
}

export function SettingsModal({ isOpen, onClose, username }: SettingsModalProps) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  // ... existing code
```

**Step 2: Add settings change handlers**

```tsx
  const handleAudioChange = (audio: AudioSettings) => {
    const newSettings = { ...settings, audio };
    setSettings(newSettings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
  };

  const handleShortcutsChange = (shortcuts: ShortcutsSettings) => {
    const newSettings = { ...settings, shortcuts };
    setSettings(newSettings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
  };

  const handleMessagesChange = (messages: MessagesSettings) => {
    const newSettings = { ...settings, messages };
    setSettings(newSettings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
  };

  const handleOverlayChange = (overlay: OverlaySettings) => {
    const newSettings = { ...settings, overlay };
    setSettings(newSettings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
  };
```

**Step 3: Pass settings to tabs**

```tsx
{activeTab === 'audio' && <AudioSettingsTab settings={settings.audio} onChange={handleAudioChange} />}
{activeTab === 'shortcuts' && <ShortcutsSettingsTab settings={settings.shortcuts} onChange={handleShortcutsChange} />}
{activeTab === 'messages' && <MessagesSettingsTab settings={settings.messages} onChange={handleMessagesChange} />}
{activeTab === 'overlay' && <OverlaySettingsTab settings={settings.overlay} onChange={handleOverlayChange} />}
```

---

### Task 7: Test end-to-end and commit

**Step 1: Run dev server and verify all tabs work**

```bash
cd src/Brmble.Web && npm run dev
```

**Step 2: Test settings persist across page reload**

- Change a setting
- Refresh page
- Verify setting is preserved

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add enhanced settings with audio, shortcuts, messages, overlay tabs"
```

---

## Verification

After completing all tasks:
1. Settings modal has 4 tabs: Audio, Shortcuts, Messages, Overlay
2. Audio tab: device dropdowns, volume sliders, push-to-talk
3. Shortcuts tab: key binding with recording UI
4. Messages tab: TTS toggle, TTS volume, notifications toggle
5. Overlay tab: toggle (placeholder)
6. Settings persist in localStorage
