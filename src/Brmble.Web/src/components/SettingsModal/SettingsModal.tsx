import './SettingsModal.css';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  username?: string;
}

export function SettingsModal({ isOpen, onClose, username }: SettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        <div className="modal-header">
          <h2 className="modal-title">Settings</h2>
          <p className="modal-subtitle">Configure your preferences</p>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h3 className="settings-section-title">Account</h3>
            <div className="settings-item">
              <label>Username</label>
              <div className="settings-value">{username || 'Not connected'}</div>
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">Audio</h3>
            <div className="settings-item">
              <label>Input Device</label>
              <select className="settings-select">
                <option>Default</option>
              </select>
            </div>
            <div className="settings-item">
              <label>Output Device</label>
              <select className="settings-select">
                <option>Default</option>
              </select>
            </div>
            <div className="settings-item settings-toggle">
              <label>Push to Talk</label>
              <input type="checkbox" className="toggle-input" />
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">Appearance</h3>
            <div className="settings-item settings-toggle">
              <label>Compact Mode</label>
              <input type="checkbox" className="toggle-input" />
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="settings-btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="settings-btn primary">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
