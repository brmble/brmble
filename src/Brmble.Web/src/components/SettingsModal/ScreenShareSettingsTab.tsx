import { useState, useEffect } from 'react';
import { Select } from '../Select';
import type { ScreenShareSettings } from './SettingsModal';
import './ScreenShareSettingsTab.css';

interface ScreenShareSettingsTabProps {
  settings: ScreenShareSettings;
  onChange: (settings: ScreenShareSettings) => void;
}

const RESOLUTION_OPTIONS = [
  { value: '720p', label: '720p (HD)' },
  { value: '1080p', label: '1080p (Full HD)' },
  { value: '1440p', label: '1440p (QHD)' },
  { value: '4k', label: '4K (Ultra HD)' },
];

export function ScreenShareSettingsTab({ settings, onChange }: ScreenShareSettingsTabProps) {
  const [localSettings, setLocalSettings] = useState<ScreenShareSettings>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleChange = <K extends keyof ScreenShareSettings>(key: K, value: ScreenShareSettings[K]) => {
    const newSettings = { ...localSettings, [key]: value };
    setLocalSettings(newSettings);
    onChange(newSettings);
  };

  return (
    <div className="screen-share-settings-tab">
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Screen Capture</h3>
        
        <div className="settings-item settings-toggle">
          <label>Capture Audio</label>
          <button
            className={`toggle-switch ${localSettings.captureAudio ? 'active' : ''}`}
            onClick={() => handleChange('captureAudio', !localSettings.captureAudio)}
            role="switch"
            aria-checked={localSettings.captureAudio}
          >
            <span className="toggle-slider" />
          </button>
        </div>

        <div className="settings-item">
          <label>Resolution</label>
          <Select
            value={localSettings.resolution}
            onChange={(value) => handleChange('resolution', value as ScreenShareSettings['resolution'])}
            options={RESOLUTION_OPTIONS}
          />
        </div>

        <div className="settings-item settings-toggle">
          <label>System Audio</label>
          <button
            className={`toggle-switch ${localSettings.systemAudio ? 'active' : ''}`}
            onClick={() => handleChange('systemAudio', !localSettings.systemAudio)}
            role="switch"
            aria-checked={localSettings.systemAudio}
          >
            <span className="toggle-slider" />
          </button>
        </div>
      </div>

      <p className="settings-note">
        System audio is available on Windows and macOS. Audio capture requires browser support.
      </p>
    </div>
  );
}