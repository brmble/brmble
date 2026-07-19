import { useState, useEffect } from 'react';
import { Select } from '../Select';
import type { ScreenShareSettings } from './SettingsModal';
import { SettingsHelp } from './SettingsHelp';
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
  { value: 'new-window', label: 'Full window' },
];

const PREFERRED_CAPTURE_SOURCE_OPTIONS = [
  { value: 'window', label: 'Application Window' },
  { value: 'screen', label: 'Full Screen' },
  { value: 'browser', label: 'Browser Tab' },
  { value: 'auto', label: 'Auto' },
];

const CONTENT_TYPE_OPTIONS = [
  { value: 'motion', label: 'Motion (games & video)' },
  { value: 'detail', label: 'Detail (text & code)' },
];

export function ScreenShareSettingsTab({ settings, onChange }: ScreenShareSettingsTabProps) {
  const [localSettings, setLocalSettings] = useState<ScreenShareSettings>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleChange = <K extends keyof ScreenShareSettings>(key: K, value: ScreenShareSettings[K]) => {
    const newSettings = {
      ...localSettings,
      [key]: value,
      ...(key === 'captureAudio' && value === false ? { systemAudio: false } : {}),
    };
    setLocalSettings(newSettings);
    onChange(newSettings);
  };

  return (
    <div className="screen-share-settings-tab">
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Screen Capture</h3>
        
        <div className="settings-item">
          <div className="settings-label-group">
            <span className="settings-label">Preferred Capture Source</span>
            <SettingsHelp content="Choose Window for game sharing. Your system picker still asks which window to share." label="More information about preferred capture source" />
          </div>
          <Select
            value={localSettings.preferredCaptureSource}
            onChange={(value) => handleChange('preferredCaptureSource', value as ScreenShareSettings['preferredCaptureSource'])}
            options={PREFERRED_CAPTURE_SOURCE_OPTIONS}
          />
        </div>

        <div className="settings-item">
          <div className="settings-label-group">
            <span className="settings-label">Resolution</span>
            <SettingsHelp content="Higher resolution uses more bandwidth" label="More information about resolution" />
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
            <SettingsHelp content="Higher frame rate uses more bandwidth" label="More information about frame rate" />
          </div>
          <Select
            value={String(localSettings.fps)}
            onChange={(value) => handleChange('fps', Number(value) as ScreenShareSettings['fps'])}
            options={FPS_OPTIONS}
          />
        </div>

        <div className="settings-item">
          <div className="settings-label-group">
            <span className="settings-label">Content Type</span>
            <SettingsHelp content="Motion keeps video and games smooth by favouring frame rate under load. Detail keeps text and code sharp by favouring resolution." label="More information about content type" />
          </div>
          <Select
            value={localSettings.contentType}
            onChange={(value) => handleChange('contentType', value as ScreenShareSettings['contentType'])}
            options={CONTENT_TYPE_OPTIONS}
          />
        </div>

        <div className="settings-item settings-toggle">
          <div className="settings-label-group">
            <span className="settings-label">Capture Audio</span>
            <SettingsHelp content="Shares audio together with your screen. Works when sharing a whole screen or a browser tab; capturing a single application window's audio is not supported by the system. You must also enable audio in the screen picker. Voice chat uses Brmble separately." label="More information about capture audio" />
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

        <div className="settings-item settings-toggle">
          <div className="settings-label-group">
            <span className="settings-label">System Audio</span>
            <SettingsHelp content="Shares your computer's system audio when sharing a whole screen. Only available when capture audio is enabled and offered by the screen picker." label="More information about system audio" />
          </div>
          <label className="brmble-toggle">
            <input
              type="checkbox"
              checked={localSettings.captureAudio && localSettings.systemAudio}
              disabled={!localSettings.captureAudio}
              onChange={(e) => handleChange('systemAudio', e.target.checked)}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>

        <div className="settings-item">
          <div className="settings-label-group">
            <span className="settings-label">Viewer Location</span>
            <SettingsHelp content="Where to show screen share when viewing others" label="More information about viewer location" />
          </div>
          <Select
            value={localSettings.viewerMode}
            onChange={(value) => handleChange('viewerMode', value as ScreenShareSettings['viewerMode'])}
            options={VIEWER_MODE_OPTIONS}
          />
        </div>
      </div>

    </div>
  );
}
