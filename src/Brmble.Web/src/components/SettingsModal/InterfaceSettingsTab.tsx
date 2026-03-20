import { useState, useEffect } from 'react';
import { Select } from '../Select';
import './InterfaceSettingsTab.css';
import type { OverlaySettings, AppearanceSettings, BrmblegotchiSettings } from './InterfaceSettingsTypes';
import { themes } from '../../themes/theme-registry';

interface InterfaceSettingsTabProps {
  appearanceSettings: AppearanceSettings;
  overlaySettings: OverlaySettings;
  brmblegotchiSettings: BrmblegotchiSettings;
  onAppearanceChange: (settings: AppearanceSettings) => void;
  onOverlayChange: (settings: OverlaySettings) => void;
  onBrmblegotchiChange: (settings: BrmblegotchiSettings) => void;
}

export function InterfaceSettingsTab({ 
  appearanceSettings, 
  overlaySettings,
  brmblegotchiSettings,
  onAppearanceChange, 
  onOverlayChange,
  onBrmblegotchiChange
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

  const handleBrmblegotchiToggle = () => {
    onBrmblegotchiChange({ enabled: !brmblegotchiSettings.enabled });
  };

  return (
    <div className="interface-settings-tab">
      
      {/* Theme Section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Theme</h3>
        <div className="settings-item">
          <label>Aesthetic</label>
          <Select
            value={localAppearance.theme}
            onChange={handleThemeChange}
            options={themes.map(t => ({ value: t.id, label: t.name }))}
          />
        </div>
      </div>

      {/* Overlay Section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">In-Game Overlay</h3>
        <div className="settings-item settings-toggle">
          <label>Enable Overlay</label>
          <label className="brmble-toggle">
            <input
              type="checkbox"
              checked={overlaySettings.overlayEnabled}
              onChange={handleOverlayToggle}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
        <p className="settings-hint">
          Overlay feature coming soon. This will allow you to see status information over other applications.
        </p>
      </div>

      {/* Brmblegotchi Section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Brmblegotchi</h3>
        <div className="settings-item settings-toggle">
          <label htmlFor="brmblegotchi-enabled">Enable Pet</label>
          <label className="brmble-toggle">
            <input
              id="brmblegotchi-enabled"
              type="checkbox"
              checked={brmblegotchiSettings.enabled}
              onChange={handleBrmblegotchiToggle}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
        <p className="settings-hint">
          Show the Brmblegotchi virtual pet companion.
        </p>
      </div>

    </div>
  );
}
