import { useState, useEffect } from 'react';
import { useServerlist } from '../../hooks/useServerlist';
import type { ServerEntry } from '../../hooks/useServerlist';
import { confirm } from '../../hooks/usePrompt';
import { Tooltip } from '../Tooltip/Tooltip';
import { BrmbleLogo } from '../Header/BrmbleLogo';
import './ServerList.css';

interface ServerListProps {
  onConnect: (server: ServerEntry) => void;
  connectionError?: string | null;
  onClearError?: () => void;
}

export function ServerList({ onConnect, connectionError, onClearError }: ServerListProps) {
  const { servers, loading, addServer, updateServer, removeServer } = useServerlist();
  const [editing, setEditing] = useState<ServerEntry | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState({ label: '', host: '', port: '64738', username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [toggleFocused, setToggleFocused] = useState(false);

  const getInitial = (label: string) => (label?.charAt(0) || '?').toUpperCase();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const server = { ...form, port: parseInt(form.port) };
    if (editing) {
      updateServer({ ...server, id: editing.id, registered: editing.registered, registeredName: editing.registeredName });
      setEditing(null);
    } else {
      addServer(server);
      setIsAdding(false);
    }
    setForm({ label: '', host: '', port: '64738', username: '', password: '' });
    setShowPassword(false);
    setToggleFocused(false);
  };

  const handleEdit = (server: ServerEntry) => {
    setEditing(server);
    setForm({
      label: server.label,
      host: server.host,
      port: String(server.port),
      username: server.username,
      password: server.password || ''
    });
    setIsAdding(false);
    setShowPassword(false);
    setToggleFocused(false);
  };

  const handleCancel = () => {
    setEditing(null);
    setIsAdding(false);
    setForm({ label: '', host: '', port: '64738', username: '', password: '' });
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
        setForm({ label: '', host: '', port: '64738', username: '', password: '' });
        setShowPassword(false);
        setToggleFocused(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isAdding, editing]);

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
          <h2 className="heading-title server-list-title">Choose a Server</h2>
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
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
                  <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                  <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                  <line x1="6" y1="6" x2="6.01" y2="6" />
                  <line x1="6" y1="18" x2="6.01" y2="18" />
                </svg>
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
                      onClick={() => setShowPassword(v => !v)}
                      onFocus={() => setToggleFocused(true)}
                      onBlur={() => { setToggleFocused(false); setShowPassword(false); }}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
                <Tooltip content={editing?.registered ? `Registered as "${editing.registeredName}" on this server` : ''}>
                <div className="server-list-username-wrapper">
                  <input
                    className={`brmble-input server-list-input${editing?.registered ? ' server-list-input-registered' : ''}`}
                    placeholder="Username"
                    value={editing?.registered ? (editing.registeredName ?? form.username) : form.username}
                    onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    disabled={editing?.registered === true}
                  />
                  {editing?.registered && (
                    <svg className="server-list-registered-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Registered">
                      <polyline points="3.5 8 6.5 11 12.5 5" />
                    </svg>
                  )}
                </div>
                </Tooltip>
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
