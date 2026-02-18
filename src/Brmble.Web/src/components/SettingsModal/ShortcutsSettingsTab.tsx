import { useState, useEffect, useCallback } from 'react';
import './ShortcutsSettingsTab.css';

interface ShortcutsSettingsTabProps {
  settings: ShortcutsSettings;
  onChange: (settings: ShortcutsSettings) => void;
}

export interface ShortcutsSettings {
  pushToTalkKey: string | null;
}

export const DEFAULT_SHORTCUTS: ShortcutsSettings = {
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
