import { useState, useEffect } from 'react';
import { useServerlist } from '../../hooks/useServerlist';
import type { ServerEntry } from '../../hooks/useServerlist';
import { confirm } from '../../hooks/usePrompt';
import { Tooltip } from '../Tooltip/Tooltip';
import { Icon } from '../Icon/Icon';
import { BrmbleLogo } from '../Header/BrmbleLogo';
import { useProfiles } from '../../hooks/useProfiles';
import { Select } from '../Select/Select';
import './ServerList.css';

interface ServerListProps {
  onConnect: (server: ServerEntry) => void;
  connectionError?: string | null;
  onClearError?: () => void;
  activeProfileName?: string;
}

export function ServerList({ onConnect, connectionError, onClearError, activeProfileName }: ServerListProps) {
  const { servers, loading, addServer, updateServer, removeServer } = useServerlist();
  const { profiles } = useProfiles();
  const [editing, setEditing] = useState<ServerEntry | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState({ label: '', host: '', port: '64738', password: '', defaultProfileId: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [toggleFocused, setToggleFocused] = useState(false);

  const getInitial = (label: string) => (label?.charAt(0) || '?').toUpperCase();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const server = { ...form, port: parseInt(form.port), defaultProfileId: form.defaultProfileId || undefined };
    if (editing) {
      updateServer({ ...server, id: editing.id, registered: editing.registered, registeredName: editing.registeredName });
      setEditing(null);
    } else {
      addServer(server);
      setIsAdding(false);
    }
    setForm({ label: '', host: '', port: '64738', password: '', defaultProfileId: '' });
    setShowPassword(false);
    setToggleFocused(false);
  };

  const handleEdit = (server: ServerEntry) => {
    setEditing(server);
    setForm({
      label: server.label,
      host: server.host,
      port: String(server.port),
      password: server.password || '',
      defaultProfileId: server.defaultProfileId || ''
    });
    setIsAdding(false);
    setShowPassword(false);
    setToggleFocused(false);
  };

  const handleCancel = () => {
    setEditing(null);
    setIsAdding(false);
    setForm({ label: '', host: '', port: '64738', password: '', defaultProfileId: '' });
    setShowPassword(false);
    setToggleFocused(false);
  };

  const handleDelete = async (server: ServerEntry) => {
    const confirmed = await confirm({
      title: 'Delete server',
      message: `Remove "${server.label}" from your server list?`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    });
    if (confirmed) removeServer(server.id);
  };

  // Cancel add/edit form on Escape key
  useEffect(() => {
    if (!isAdding && !editing) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditing(null);
        setIsAdding(false);
        setForm({ label: '', host: '', port: '64738', password: '', defaultProfileId: '' });
        setShowPassword(false);
        setToggleFocused(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isAdding, editing]);

  // Sync editing state when servers update (e.g. profile switch swaps registration data)
  useEffect(() => {
    if (!editing) return;
    const fresh = servers.find(s => s.id === editing.id);
    if (fresh) {
      setEditing(fresh);
    }
  }, [servers]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="server-list-overlay">
        <div className="server-list-loading">
          <span className="loading-dots">Loading servers</span>
        </div>
      </div>
    );
  }

  return (
    <div className="server-list-overlay">
      <div className="server-list-container glass-panel">
        <div className="server-list-logo">
          <BrmbleLogo size={192} heartbeat />
        </div>
        <div className="server-list-header">
          <h2 className="heading-title server-list-title">Choose a Server{activeProfileName && profiles.length < 2 ? `, ${activeProfileName}!` : ''}</h2>
          <p className="server-list-subtitle">Select a server to start talking and chatting</p>
        </div>

        {connectionError && (
          <div className="server-list-error" role="alert">
            <span>{connectionError}</span>
            {onClearError && (
              <button className="server-list-error-dismiss" onClick={onClearError} aria-label="Dismiss error">
                ✕
              </button>
            )}
          </div>
        )}

        <div className="server-list-content">
          {servers.length > 0 ? (
            <div className="server-list-items">
              {servers.map((server, index) => (
                <div 
                  key={server.id || `server-${index}`} 
                  className="server-list-item"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="server-list-icon">
                    {getInitial(server.label)}
                  </div>
                  <div className="server-list-info">
                    <span className="server-list-name">{server.label}</span>
                    <span className="server-list-address">{server.host}:{server.port}</span>
                  </div>
                  {profiles.length >= 2 && server.defaultProfileId && (() => {
                    const profile = profiles.find(p => p.id === server.defaultProfileId);
                    return profile ? (
                      <span className="server-list-profile-badge">{profile.name}</span>
                    ) : null;
                  })()}
                    <div className="server-list-actions">
                      <Tooltip content="Delete server">
                      <button
                        className="btn btn-ghost server-list-delete-btn"
                        onClick={() => handleDelete(server)}
                      >
                        ✕
                      </button>
                      </Tooltip>
                      <button 
                        className="btn btn-secondary server-list-edit-btn"
                        onClick={() => handleEdit(server)}
                      >
                        Edit
                      </button>
                      <button 
                        className="btn btn-primary server-list-connect-btn"
                        onClick={() => onConnect(server)}
                      >
                        Connect
                      </button>
                    </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="server-list-empty">
              <div className="server-list-empty-icon">
                <Icon name="server" size={48} strokeWidth={1.5} />
              </div>
              <p>No servers saved yet</p>
              <p className="server-list-empty-hint">Add a server to get started</p>
            </div>
          )}

          {(isAdding || editing) && (
            <form className="server-list-form" onSubmit={handleSubmit}>
              <h3 className="heading-section server-list-form-title">
                {editing ? 'Edit Server' : 'Add New Server'}
              </h3>
              <div className="server-list-form-fields">
                <input
                  className="brmble-input server-list-input"
                  placeholder="Server Name"
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  autoFocus
                />
                <div className="server-list-form-row">
                  <input
                    className="brmble-input server-list-input server-list-input-host"
                    placeholder="Server Address"
                    value={form.host}
                    onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                  />
                  <input
                    className="brmble-input server-list-input server-list-input-port"
                    placeholder="Port"
                    type="number"
                    value={form.port}
                    onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
                  />
                </div>
                <div className={`server-list-password-wrapper${passwordFocused || toggleFocused ? ' focused' : ''}`}>
                  <input
                    className="brmble-input server-list-input server-list-password-input"
                    placeholder="Server Password (optional)"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    onFocus={() => setPasswordFocused(true)}
                    onBlur={() => { setPasswordFocused(false); if (!toggleFocused) setShowPassword(false); }}
                  />
                  {(passwordFocused || toggleFocused) && (
                    <button
                      type="button"
                      className="server-list-password-toggle"
                      onMouseDown={e => { e.preventDefault(); setShowPassword(v => !v); }}
                      onFocus={() => setToggleFocused(true)}
                      onBlur={() => { setToggleFocused(false); setShowPassword(false); }}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? (
                        <Icon name="eye-off" size={18} />
                      ) : (
                        <Icon name="eye" size={18} />
                      )}
                    </button>
                  )}
                </div>
                {editing?.registered && !form.defaultProfileId && (
                <Tooltip content={`Registered as "${editing.registeredName}" on this server`}>
                <div className="server-list-username-wrapper" tabIndex={0}>
                  <input
                    className="brmble-input server-list-input server-list-input-registered"
                    placeholder="Username"
                    value={editing.registeredName ?? ''}
                    disabled
                  />
                  <Icon name="check" size={16} className="server-list-registered-icon" />
                </div>
                </Tooltip>
                )}
                {profiles.length >= 2 && (
                  <div className="server-list-profile-select">
                    <label className="server-list-profile-label">Profile</label>
                    <Select
                      value={form.defaultProfileId}
                      onChange={(val) => setForm(f => ({ ...f, defaultProfileId: val }))}
                      options={[
                        { value: '', label: 'Use active profile' },
                        ...profiles.map(p => ({ value: p.id, label: p.name }))
                      ]}
                    />
                  </div>
                )}
              </div>
              <div className="server-list-form-actions">
                <button type="button" className="btn btn-secondary server-list-cancel-btn" onClick={handleCancel}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary server-list-submit-btn">
                  Save
                </button>
              </div>
            </form>
          )}
        </div>

        {!isAdding && !editing && (
          <button className="btn btn-ghost server-list-add-btn" onClick={() => setIsAdding(true)}>
            <span className="server-list-add-icon">+</span>
            Add Server
          </button>
        )}
      </div>
    </div>
  );
}
