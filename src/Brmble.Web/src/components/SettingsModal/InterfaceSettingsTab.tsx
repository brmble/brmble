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
  brmblegotchiEnabled?: boolean;
  setBrmblegotchiEnabled?: (enabled: boolean) => void;
}

export function InterfaceSettingsTab({ 
  appearanceSettings, 
  overlaySettings,
  brmblegotchiSettings,
  onAppearanceChange, 
  onOverlayChange,
  onBrmblegotchiChange,
  brmblegotchiEnabled,
  setBrmblegotchiEnabled
}: InterfaceSettingsTabProps) {
  
  const [localAppearance, setLocalAppearance] = useState<AppearanceSettings>(appearanceSettings);
  const [localBrmblegotchi, setLocalBrmblegotchi] = useState<BrmblegotchiSettings>(brmblegotchiSettings ?? { enabled: true, theme: 'original' });
  const effectiveEnabled = typeof brmblegotchiEnabled === 'boolean' ? brmblegotchiEnabled : localBrmblegotchi.enabled;


  useEffect(() => {
    setLocalAppearance(appearanceSettings);
  }, [appearanceSettings]);

  useEffect(() => {
    setLocalBrmblegotchi(brmblegotchiSettings ?? { enabled: true, theme: 'original' });
  }, [brmblegotchiSettings]);

  const handleThemeChange = (theme: string) => {
    const newSettings = { ...localAppearance, theme };
    setLocalAppearance(newSettings);
    onAppearanceChange(newSettings);
  };

  const handleOverlayToggle = () => {
    onOverlayChange({ ...overlaySettings, overlayEnabled: !overlaySettings.overlayEnabled });
  };

  const handleBrmblegotchiToggle = () => {
    const newEnabled = !effectiveEnabled;
    const newSettings = { ...localBrmblegotchi, enabled: newEnabled };
    setLocalBrmblegotchi(newSettings);
    onBrmblegotchiChange(newSettings);
    if (setBrmblegotchiEnabled) setBrmblegotchiEnabled(newEnabled);
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
              checked={effectiveEnabled}
              onChange={handleBrmblegotchiToggle}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
        {localBrmblegotchi.enabled && (
          <div className="settings-item">
            <label>Pet Theme</label>
            <Select
              value={localBrmblegotchi.theme || 'original'}
              onChange={(theme) => {
                const newSettings = { ...localBrmblegotchi, theme: (theme || 'original') as 'original' | 'dino' | 'cat' };
                setLocalBrmblegotchi(newSettings);
                onBrmblegotchiChange(newSettings);
              }}
              options={[
                { value: 'original', label: 'Original' },
                { value: 'dino', label: 'Dino' },
                { value: 'cat', label: 'Cat (Passive)' },
              ]}
            />
          </div>
        )}
        <p className="settings-hint">
          Show the Brmblegotchi virtual pet companion.
        </p>
      </div>

    </div>
  );
}
