import { useState, useEffect } from 'react';
import { useServerlist } from '../../hooks/useServerlist';
import type { ServerEntry } from '../../hooks/useServerlist';
import './ServerList.css';

interface ServerListProps {
  onConnect: (server: ServerEntry) => void;
}

export function ServerList({ onConnect }: ServerListProps) {
  const { servers, loading, addServer, updateServer, removeServer } = useServerlist();
  const [editing, setEditing] = useState<ServerEntry | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState({ label: '', host: '', port: '64738', username: '' });

  const getInitial = (label: string) => (label?.charAt(0) || '?').toUpperCase();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const server = { ...form, port: parseInt(form.port) };
    if (editing) {
      updateServer({ ...server, id: editing.id });
      setEditing(null);
    } else {
      addServer(server);
      setIsAdding(false);
    }
    setForm({ label: '', host: '', port: '64738', username: '' });
  };

  const handleEdit = (server: ServerEntry) => {
    setEditing(server);
    setForm({
      label: server.label,
      host: server.host,
      port: String(server.port),
      username: server.username
    });
    setIsAdding(false);
  };

  const handleCancel = () => {
    setEditing(null);
    setIsAdding(false);
    setForm({ label: '', host: '', port: '64738', username: '' });
  };

  // Cancel add/edit form on Escape key
  useEffect(() => {
    if (!isAdding && !editing) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditing(null);
        setIsAdding(false);
        setForm({ label: '', host: '', port: '64738', username: '' });
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
        <div className="server-list-header">
          <h2 className="heading-title server-list-title">Choose a Server</h2>
          <p className="server-list-subtitle">Select a server to connect to voice chat</p>
        </div>

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
                      <button 
                        className="btn btn-primary server-list-connect-btn"
                        onClick={() => onConnect(server)}
                      >
                        Connect
                      </button>
                      <button 
                        className="btn btn-secondary server-list-edit-btn"
                        onClick={() => handleEdit(server)}
                      >
                        Edit
                      </button>
                      <button 
                        className="btn btn-ghost server-list-delete-btn"
                        onClick={() => removeServer(server.id)}
                      >
                        ×
                      </button>
                    </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="server-list-empty">
              <div className="server-list-empty-icon">🎙</div>
              <p>No servers saved yet</p>
              <p className="server-list-empty-hint">Add a server to get started</p>
            </div>
          )}

          {(isAdding || editing) && (
            <form className="server-list-form" onSubmit={handleSubmit}>
              <div className="server-list-form-title">
                {editing ? 'Edit Server' : 'Add New Server'}
              </div>
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
                    placeholder="Host"
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
                <input
                  className="brmble-input server-list-input"
                  placeholder="Username"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                />
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
