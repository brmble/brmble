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

export const DEFAULT_SETTINGS: AudioSettings = {
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
