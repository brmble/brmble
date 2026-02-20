import { useState, useEffect, useCallback } from 'react';
import './ShortcutsSettingsTab.css';

interface ShortcutsSettingsTabProps {
  settings: ShortcutsSettings;
  onChange: (settings: ShortcutsSettings) => void;
}

export interface ShortcutsSettings {
  toggleMuteKey: string | null;
  toggleDeafenKey: string | null;
  toggleMuteDeafenKey: string | null;
}

export const DEFAULT_SHORTCUTS: ShortcutsSettings = {
  toggleMuteKey: null,
  toggleDeafenKey: null,
  toggleMuteDeafenKey: null,
};

export function ShortcutsSettingsTab({ settings, onChange }: ShortcutsSettingsTabProps) {
  const [recordingKey, setRecordingKey] = useState<keyof ShortcutsSettings | null>(null);
  const [localSettings, setLocalSettings] = useState<ShortcutsSettings>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleInput = useCallback((key: string) => {
    if (!recordingKey) return;
    
    setLocalSettings((prev) => {
      const newSettings = { ...prev, [recordingKey]: key };
      onChange(newSettings);
      return newSettings;
    });
    setRecordingKey(null);
  }, [recordingKey, onChange]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    handleInput(e.code);
  }, [handleInput]);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    e.preventDefault();
    const button = e.button;
    const mouseButtonMap: Record<number, string> = {
      0: 'MouseLeft',
      1: 'MouseMiddle', 
      2: 'MouseRight',
      3: 'XButton1',
      4: 'XButton2',
    };
    const key = mouseButtonMap[button];
    if (key) {
      handleInput(key);
    }
  }, [handleInput]);

  useEffect(() => {
    if (recordingKey) {
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('pointerdown', handlePointerDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('pointerdown', handlePointerDown);
      };
    }
  }, [recordingKey, handleKeyDown, handlePointerDown]);

  return (
    <div className="shortcuts-settings-tab">
      <div className="settings-item">
        <label>Toggle Mute Self</label>
        <button
          className={`key-binding-btn ${recordingKey === 'toggleMuteKey' ? 'recording' : ''}`}
          onClick={() => setRecordingKey(recordingKey === 'toggleMuteKey' ? null : 'toggleMuteKey')}
        >
          {recordingKey === 'toggleMuteKey' ? 'Press any key...' : (localSettings.toggleMuteKey || 'Not bound')}
        </button>
      </div>

      <div className="settings-item">
        <label>Toggle Deafen Self</label>
        <button
          className={`key-binding-btn ${recordingKey === 'toggleDeafenKey' ? 'recording' : ''}`}
          onClick={() => setRecordingKey(recordingKey === 'toggleDeafenKey' ? null : 'toggleDeafenKey')}
        >
          {recordingKey === 'toggleDeafenKey' ? 'Press any key...' : (localSettings.toggleDeafenKey || 'Not bound')}
        </button>
      </div>

      <div className="settings-item">
        <label>Toggle Mute/Deafen Self</label>
        <button
          className={`key-binding-btn ${recordingKey === 'toggleMuteDeafenKey' ? 'recording' : ''}`}
          onClick={() => setRecordingKey(recordingKey === 'toggleMuteDeafenKey' ? null : 'toggleMuteDeafenKey')}
        >
          {recordingKey === 'toggleMuteDeafenKey' ? 'Press any key...' : (localSettings.toggleMuteDeafenKey || 'Not bound')}
        </button>
      </div>
      
      <p className="settings-hint">
        Click a button and press a key to set a shortcut.
      </p>
    </div>
  );
}
