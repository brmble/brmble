import { useState, useEffect } from 'react';
import './AppearanceSettingsTab.css';

export interface AppearanceSettings {
  theme: 'classic' | 'clean';
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'classic',
};

interface AppearanceSettingsTabProps {
  settings: AppearanceSettings;
  onChange: (settings: AppearanceSettings) => void;
}

export function AppearanceSettingsTab({ settings, onChange }: AppearanceSettingsTabProps) {
  const [localSettings, setLocalSettings] = useState<AppearanceSettings>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleChange = (theme: 'classic' | 'clean') => {
    const newSettings = { ...localSettings, theme };
    setLocalSettings(newSettings);
    onChange(newSettings);
  };

  return (
    <div className="appearance-settings-tab">
      <div className="settings-item settings-select-wrapper">
        <label>Theme</label>
        <select
          className="settings-select"
          value={localSettings.theme}
          onChange={(e) => handleChange(e.target.value as 'classic' | 'clean')}
        >
          <option value="classic">Brmble Classic (Vintage Lounge)</option>
          <option value="clean">Brmble Clean</option>
        </select>
      </div>
      <p className="settings-hint">
        Classic features a rich gradient mesh and noise grain overlay. Clean is a simplified dark mode.
      </p>
    </div>
  );
}
