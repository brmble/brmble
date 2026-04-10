import { useState, useEffect } from 'react';
import { Select } from '../Select';
import { Tooltip } from '../Tooltip/Tooltip';
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

const FPS_OPTIONS = [
  { value: '15', label: '15 FPS' },
  { value: '30', label: '30 FPS' },
  { value: '60', label: '60 FPS' },
];

const VIEWER_MODE_OPTIONS = [
  { value: 'in-app', label: 'In app (chat area)' },
  { value: 'new-window', label: 'New window' },
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
          <div className="settings-label-group">
            <span className="settings-label">Capture Audio</span>
            <Tooltip content="Capture microphone audio along with screen share" position="right" align="start">
              <span className="settings-info-btn">?</span>
            </Tooltip>
          </div>
          <label className="brmble-toggle">
            <input
              type="checkbox"
              checked={localSettings.captureAudio}
              onChange={(e) => handleChange('captureAudio', e.target.checked)}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>

        <div className="settings-item">
          <div className="settings-label-group">
            <span className="settings-label">Resolution</span>
            <Tooltip content="Higher resolution uses more bandwidth" position="right" align="start">
              <span className="settings-info-btn">?</span>
            </Tooltip>
          </div>
          <Select
            value={localSettings.resolution}
            onChange={(value) => handleChange('resolution', value as ScreenShareSettings['resolution'])}
            options={RESOLUTION_OPTIONS}
          />
        </div>

        <div className="settings-item">
          <div className="settings-label-group">
            <span className="settings-label">Frame Rate</span>
            <Tooltip content="Higher frame rate uses more bandwidth" position="right" align="start">
              <span className="settings-info-btn">?</span>
            </Tooltip>
          </div>
          <Select
            value={String(localSettings.fps)}
            onChange={(value) => handleChange('fps', Number(value) as ScreenShareSettings['fps'])}
            options={FPS_OPTIONS}
          />
        </div>

        <div className="settings-item settings-toggle">
          <div className="settings-label-group">
            <span className="settings-label">System Audio</span>
            <Tooltip content="Capture system audio (Windows/macOS only)" position="right" align="start">
              <span className="settings-info-btn">?</span>
            </Tooltip>
          </div>
          <label className="brmble-toggle">
            <input
              type="checkbox"
              checked={localSettings.systemAudio}
              onChange={(e) => handleChange('systemAudio', e.target.checked)}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>

        <div className="settings-item">
          <div className="settings-label-group">
            <span className="settings-label">Viewer Location</span>
            <Tooltip content="Where to show screen share when viewing others" position="right" align="start">
              <span className="settings-info-btn">?</span>
            </Tooltip>
          </div>
          <Select
            value={localSettings.viewerMode}
            onChange={(value) => handleChange('viewerMode', value as ScreenShareSettings['viewerMode'])}
            options={VIEWER_MODE_OPTIONS}
          />
        </div>
      </div>

      <p className="settings-note">
        System audio is available on Windows and macOS. Audio capture requires browser support.
      </p>
    </div>
  );
}