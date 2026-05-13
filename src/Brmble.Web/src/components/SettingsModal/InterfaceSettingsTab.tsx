import { useState, useEffect } from 'react';
import { Select } from '../Select';
import './InterfaceSettingsTab.css';
import type { OverlaySettings, AppearanceSettings, BrmblegotchiSettings, CompanionOverlayMode, CompanionOverlayPosition, CompanionSelection } from './InterfaceSettingsTypes';
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
  brmblegotchiSettings: _brmblegotchiSettings,
  onAppearanceChange, 
  onOverlayChange,
  onBrmblegotchiChange: _onBrmblegotchiChange,
  brmblegotchiEnabled: _brmblegotchiEnabled,
  setBrmblegotchiEnabled: _setBrmblegotchiEnabled
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

  const handleOverlayModeChange = (mode: string) => {
    const validMode: CompanionOverlayMode = 
      mode === 'full' || mode === 'minimal' ? mode : 'minimal';
    onOverlayChange({ ...overlaySettings, mode: validMode });
  };

  const handleOverlayPositionChange = (position: string) => {
    const validPositions: CompanionOverlayPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    const validPosition: OverlaySettings['position'] = 
      validPositions.includes(position as CompanionOverlayPosition)
        ? (position as CompanionOverlayPosition)
        : 'bottom-right';
    onOverlayChange({
      ...overlaySettings,
      position: validPosition,
    });
  };

  const handleMyCompanionChange = (companion: string) => {
    const validCompanions: CompanionSelection[] = ['bee', 'engineer', 'floppy', 'patch', 'pip', 'retro'];
    const validCompanion: CompanionSelection = validCompanions.includes(companion as CompanionSelection)
      ? companion as CompanionSelection
      : 'bee';
    onOverlayChange({ ...overlaySettings, myCompanion: validCompanion });
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
          <label htmlFor="overlay-enabled">Enable Companion Overlay</label>
          <label className="brmble-toggle">
            <input
              id="overlay-enabled"
              type="checkbox"
              checked={overlaySettings.overlayEnabled}
              onChange={handleOverlayToggle}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
        <div className="settings-item">
          <label>Overlay Mode</label>
          <Select
            value={overlaySettings.mode}
            onChange={handleOverlayModeChange}
            options={[
              { value: 'full', label: 'Full Companion' },
              { value: 'minimal', label: 'Minimal' },
            ]}
          />
        </div>
        {overlaySettings.mode === 'full' && (
          <div className="settings-item">
            <label>My Companion</label>
            <Select
              value={overlaySettings.myCompanion}
              onChange={handleMyCompanionChange}
              options={[
                { value: 'bee', label: 'Bee' },
                { value: 'engineer', label: 'Engineer' },
                { value: 'floppy', label: 'Floppy' },
                { value: 'patch', label: 'Patch' },
                { value: 'pip', label: 'Pip' },
                { value: 'retro', label: 'Retro' },
              ]}
            />
          </div>
        )}
        <div className="settings-item">
          <label>Overlay Position</label>
          <Select
            value={overlaySettings.position}
            onChange={handleOverlayPositionChange}
            options={[
              { value: 'top-left', label: 'Top Left' },
              { value: 'top-right', label: 'Top Right' },
              { value: 'bottom-left', label: 'Bottom Left' },
              { value: 'bottom-right', label: 'Bottom Right' },
            ]}
          />
        </div>
        <div className="settings-item settings-toggle">
          <label htmlFor="overlay-channel-messages">Show Channel Messages</label>
          <label className="brmble-toggle">
            <input
              id="overlay-channel-messages"
              type="checkbox"
              checked={overlaySettings.showChannelMessages}
              onChange={() => onOverlayChange({ ...overlaySettings, showChannelMessages: !overlaySettings.showChannelMessages })}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
        <div className="settings-item settings-toggle">
          <label htmlFor="overlay-direct-messages">Show Direct Messages</label>
          <label className="brmble-toggle">
            <input
              id="overlay-direct-messages"
              type="checkbox"
              checked={overlaySettings.showDirectMessages}
              onChange={() => onOverlayChange({ ...overlaySettings, showDirectMessages: !overlaySettings.showDirectMessages })}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
        <div className="settings-item settings-toggle">
          <label htmlFor="overlay-join-leave">Show Join/Leave Events</label>
          <label className="brmble-toggle">
            <input
              id="overlay-join-leave"
              type="checkbox"
              checked={overlaySettings.showJoinLeaveEvents}
              onChange={() => onOverlayChange({ ...overlaySettings, showJoinLeaveEvents: !overlaySettings.showJoinLeaveEvents })}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
        <div className="settings-item settings-toggle">
          <label htmlFor="overlay-moderation">Show Moderation Events</label>
          <label className="brmble-toggle">
            <input
              id="overlay-moderation"
              type="checkbox"
              checked={overlaySettings.showModerationEvents}
              onChange={() => onOverlayChange({ ...overlaySettings, showModerationEvents: !overlaySettings.showModerationEvents })}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
        <div className="settings-item settings-toggle">
          <label htmlFor="overlay-speakers">Show Active Speakers</label>
          <label className="brmble-toggle">
            <input
              id="overlay-speakers"
              type="checkbox"
              checked={overlaySettings.showActiveSpeakers}
              onChange={() => onOverlayChange({ ...overlaySettings, showActiveSpeakers: !overlaySettings.showActiveSpeakers })}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
        <p className="settings-hint">
          Keep a small Brmblegotchi companion overlay on top of games and desktop apps for current-channel activity, DMs, moderation, and speakers.
        </p>
      </div>

    </div>
  );
}
