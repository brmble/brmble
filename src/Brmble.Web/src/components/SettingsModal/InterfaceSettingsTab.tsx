import { useState, useEffect } from 'react';
import './InterfaceSettingsTab.css';
import type { OverlaySettings, AppearanceSettings } from './InterfaceSettingsTypes';
import { themes } from '../../themes/theme-registry';

interface InterfaceSettingsTabProps {
  appearanceSettings: AppearanceSettings;
  overlaySettings: OverlaySettings;
  onAppearanceChange: (settings: AppearanceSettings) => void;
  onOverlayChange: (settings: OverlaySettings) => void;
}

export function InterfaceSettingsTab({ 
  appearanceSettings, 
  overlaySettings, 
  onAppearanceChange, 
  onOverlayChange 
}: InterfaceSettingsTabProps) {
  
  const [localAppearance, setLocalAppearance] = useState<AppearanceSettings>(appearanceSettings);

  useEffect(() => {
    setLocalAppearance(appearanceSettings);
  }, [appearanceSettings]);

  const handleThemeChange = (theme: string) => {
    const newSettings = { ...localAppearance, theme };
    setLocalAppearance(newSettings);
    onAppearanceChange(newSettings);
  };

  const handleOverlayToggle = () => {
    onOverlayChange({ ...overlaySettings, overlayEnabled: !overlaySettings.overlayEnabled });
  };

  return (
    <div className="interface-settings-tab">
      
      {/* Theme Section */}
      <div className="settings-section">
        <h3 className="settings-section-title">Theme</h3>
        <div className="settings-item">
          <label>Aesthetic</label>
          <select
            className="brmble-input"
            value={localAppearance.theme}
            onChange={(e) => handleThemeChange(e.target.value)}
          >
            {themes.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Overlay Section */}
      <div className="settings-section">
        <h3 className="settings-section-title">In-Game Overlay</h3>
        <div className="settings-item settings-toggle">
          <label>Enable Overlay</label>
          <input
            type="checkbox"
            className="toggle-input"
            checked={overlaySettings.overlayEnabled}
            onChange={handleOverlayToggle}
          />
        </div>
        <p className="settings-hint">
          Overlay feature coming soon. This will allow you to see status information over other applications.
        </p>
      </div>

    </div>
  );
}
