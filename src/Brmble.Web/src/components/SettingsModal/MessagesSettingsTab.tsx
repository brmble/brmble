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

export const DEFAULT_MESSAGES: MessagesSettings = {
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
