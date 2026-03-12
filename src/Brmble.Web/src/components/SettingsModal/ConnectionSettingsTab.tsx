import { Tooltip } from '../Tooltip/Tooltip';
import { Select } from '../Select';
import './ConnectionSettingsTab.css';

interface ConnectionSettingsTabProps {
  settings: ConnectionSettings;
  onChange: (settings: ConnectionSettings) => void;
  servers: Array<{ id: string; label: string }>;
}

export interface ConnectionSettings {
  reconnectEnabled: boolean;
  autoConnectEnabled: boolean;
  autoConnectServerId: string | null;
}

export const DEFAULT_CONNECTION: ConnectionSettings = {
  reconnectEnabled: true,
  autoConnectEnabled: false,
  autoConnectServerId: null,
};

export function ConnectionSettingsTab({ settings, onChange, servers }: ConnectionSettingsTabProps) {
  const handleReconnectToggle = () => {
    onChange({ ...settings, reconnectEnabled: !settings.reconnectEnabled });
  };

  const handleAutoConnectToggle = () => {
    onChange({ ...settings, autoConnectEnabled: !settings.autoConnectEnabled });
  };

  const handleServerChange = (value: string) => {
    onChange({ ...settings, autoConnectServerId: value === '' ? null : value });
  };

  const tooltipText = "Choose 'Last connected server' to reconnect where you left off, or pick a specific server to always connect to that one.";

  return (
    <div className="connection-settings-tab">

      {/* Reconnect Section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Reconnect</h3>
        <div className="settings-item settings-toggle">
          <label>Automatically reconnect when disconnected</label>
          <label className="brmble-toggle">
            <input
              type="checkbox"
              checked={settings.reconnectEnabled}
              onChange={handleReconnectToggle}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
      </div>

      {/* Auto-Connect Section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Auto-Connect</h3>
        <div className="settings-item settings-toggle">
          <label>Auto-connect on startup</label>
          <label className="brmble-toggle">
            <input
              type="checkbox"
              checked={settings.autoConnectEnabled}
              onChange={handleAutoConnectToggle}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>

        <div className="server-dropdown-row">
          <label>Connect to</label>
          <Tooltip content={tooltipText}>
            <div>
              <Select
                value={settings.autoConnectServerId ?? ''}
                onChange={handleServerChange}
                disabled={!settings.autoConnectEnabled}
                options={[
                  { value: '', label: 'Last connected server' },
                  ...servers.map(s => ({ value: s.id, label: s.label })),
                ]}
              />
            </div>
          </Tooltip>
        </div>

        {servers.length === 0 && (
          <p className="settings-hint">
            You can also choose a specific server once you've added one.
          </p>
        )}
      </div>

    </div>
  );
}
