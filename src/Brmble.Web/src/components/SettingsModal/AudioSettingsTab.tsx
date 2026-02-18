import { useState, useEffect, useCallback } from 'react';
import './AudioSettingsTab.css';

interface AudioSettingsTabProps {
  settings: AudioSettings;
  onChange: (settings: AudioSettings) => void;
}

export type TransmissionMode = 'pushToTalk' | 'voiceActivity' | 'continuous';

export interface AudioSettings {
  inputDevice: string;
  outputDevice: string;
  inputVolume: number;
  outputVolume: number;
  transmissionMode: TransmissionMode;
  pushToTalkKey: string | null;
}

export const DEFAULT_SETTINGS: AudioSettings = {
  inputDevice: 'default',
  outputDevice: 'default',
  inputVolume: 100,
  outputVolume: 100,
  transmissionMode: 'voiceActivity',
  pushToTalkKey: null,
};

export function AudioSettingsTab({ settings, onChange }: AudioSettingsTabProps) {
  const [localSettings, setLocalSettings] = useState<AudioSettings>(settings);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleChange = (key: keyof AudioSettings, value: string | number | TransmissionMode) => {
    const newSettings = { ...localSettings, [key]: value };
    setLocalSettings(newSettings);
    onChange(newSettings);
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    const key = e.code === 'Space' ? 'Space' : e.key;
    handleChange('pushToTalkKey', key);
    setRecording(false);
  }, [recording, handleChange]);

  useEffect(() => {
    if (recording) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [recording, handleKeyDown]);

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

      <div className="settings-item">
        <label>Transmission Mode</label>
        <select
          className="settings-select"
          value={localSettings.transmissionMode}
          onChange={(e) => handleChange('transmissionMode', e.target.value as TransmissionMode)}
        >
          <option value="pushToTalk">Push to Talk</option>
          <option value="voiceActivity">Voice Activity</option>
          <option value="continuous">Continuous</option>
        </select>
      </div>

      {localSettings.transmissionMode === 'pushToTalk' && (
        <div className="settings-item">
          <label>Push to Talk Key</label>
          <button
            className={`key-binding-btn ${recording ? 'recording' : ''}`}
            onClick={() => setRecording(!recording)}
          >
            {recording ? 'Press any key...' : (localSettings.pushToTalkKey || 'Not bound')}
          </button>
        </div>
      )}
    </div>
  );
}
