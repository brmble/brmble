import './OverlaySettingsTab.css';

interface OverlaySettingsTabProps {
  settings: OverlaySettings;
  onChange: (settings: OverlaySettings) => void;
}

export interface OverlaySettings {
  overlayEnabled: boolean;
}

export const DEFAULT_OVERLAY: OverlaySettings = {
  overlayEnabled: false,
};

export function OverlaySettingsTab({ settings, onChange }: OverlaySettingsTabProps) {
  const handleToggle = () => {
    onChange({ ...settings, overlayEnabled: !settings.overlayEnabled });
  };

  return (
    <div className="overlay-settings-tab">
      <div className="settings-item settings-toggle">
        <label>Enable Overlay</label>
        <input
          type="checkbox"
          className="toggle-input"
          checked={settings.overlayEnabled}
          onChange={handleToggle}
        />
      </div>
      <p className="settings-hint">
        Overlay feature coming soon. This will allow you to see status information over other applications.
      </p>
    </div>
  );
}
