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

  const handleServerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    onChange({ ...settings, autoConnectServerId: value === '' ? null : value });
  };

  const tooltipText = "Choose 'Last connected server' to reconnect where you left off, or pick a specific server to always connect to that one.";

  return (
    <div className="connection-settings-tab">
      <div className="settings-item settings-toggle">
        <label>Automatically reconnect when disconnected</label>
        <input
          type="checkbox"
          className="toggle-input"
          checked={settings.reconnectEnabled}
          onChange={handleReconnectToggle}
        />
      </div>

      <div className="settings-item settings-toggle">
        <label>Auto-connect on startup</label>
        <input
          type="checkbox"
          className="toggle-input"
          checked={settings.autoConnectEnabled}
          onChange={handleAutoConnectToggle}
        />
      </div>

      <div className="server-dropdown-row">
        <label>
          Connect to
          <span className="tooltip-icon" data-tooltip={tooltipText}>?</span>
        </label>
        <select
          className="brmble-input"
          value={settings.autoConnectServerId ?? ''}
          onChange={handleServerChange}
          disabled={!settings.autoConnectEnabled}
        >
          <option value="">Last connected server</option>
          {servers.map(s => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {servers.length === 0 && (
        <p className="settings-hint">
          You can also choose a specific server once you've added one.
        </p>
      )}
    </div>
  );
}
