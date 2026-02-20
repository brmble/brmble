import { useState, useEffect, useCallback } from 'react';
import './ShortcutsSettingsTab.css';

interface ShortcutsSettingsTabProps {
  settings: ShortcutsSettings;
  onChange: (settings: ShortcutsSettings) => void;
}

export interface ShortcutsSettings {
  pushToTalkKey: string | null;
  toggleMuteKey: string | null;
  toggleDeafenKey: string | null;
  toggleMuteDeafenKey: string | null;
  continuousTransmissionKey: string | null;
}

export const DEFAULT_SHORTCUTS: ShortcutsSettings = {
  pushToTalkKey: null,
  toggleMuteKey: null,
  toggleDeafenKey: null,
  toggleMuteDeafenKey: null,
  continuousTransmissionKey: null,
};

export function ShortcutsSettingsTab({ settings, onChange }: ShortcutsSettingsTabProps) {
  const [recordingKey, setRecordingKey] = useState<keyof ShortcutsSettings | null>(null);
  const [localSettings, setLocalSettings] = useState<ShortcutsSettings>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!recordingKey) return;
    e.preventDefault();
    
    const key = e.code === 'Space' ? 'Space' : e.key;
    setLocalSettings((prev) => {
      const newSettings = { ...prev, [recordingKey]: key };
      onChange(newSettings);
      return newSettings;
    });
    setRecordingKey(null);
  }, [recordingKey, onChange]);

  useEffect(() => {
    if (recordingKey) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [recordingKey, handleKeyDown]);

  return (
    <div className="shortcuts-settings-tab">
      <div className="settings-item">
        <label>Push to Talk</label>
        <button
          className={`key-binding-btn ${recordingKey === 'pushToTalkKey' ? 'recording' : ''}`}
          onClick={() => setRecordingKey(recordingKey === 'pushToTalkKey' ? null : 'pushToTalkKey')}
        >
          {recordingKey === 'pushToTalkKey' ? 'Press any key...' : (localSettings.pushToTalkKey || 'Not bound')}
        </button>
      </div>

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

      <div className="settings-item">
        <label>Continuous Transmission</label>
        <button
          className={`key-binding-btn ${recordingKey === 'continuousTransmissionKey' ? 'recording' : ''}`}
          onClick={() => setRecordingKey(recordingKey === 'continuousTransmissionKey' ? null : 'continuousTransmissionKey')}
        >
          {recordingKey === 'continuousTransmissionKey' ? 'Press any key...' : (localSettings.continuousTransmissionKey || 'Not bound')}
        </button>
      </div>
      
      <p className="settings-hint">
        Click a button and press a key to set a shortcut.
      </p>
    </div>
  );
}
