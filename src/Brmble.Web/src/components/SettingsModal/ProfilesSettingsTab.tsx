import { useState, useEffect, useRef } from 'react';
import { useProfiles } from '../../hooks/useProfiles';
import { confirm } from '../../hooks/usePrompt';
import { Tooltip } from '../Tooltip/Tooltip';
import './ProfilesSettingsTab.css';

interface ProfilesSettingsTabProps {
  connected: boolean;
}

export function ProfilesSettingsTab({ connected }: ProfilesSettingsTabProps) {
  const { profiles, activeProfileId, loading, addProfile, importProfile, removeProfile, renameProfile, setActive, exportCert } = useProfiles();

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addName, setAddName] = useState('');
  const [editName, setEditName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getInitial = (name: string) => (name?.charAt(0) || '?').toUpperCase();

  const truncateFingerprint = (fp: string | null) => {
    if (!fp) return 'No certificate';
    if (fp.length <= 20) return fp;
    return fp.slice(0, 8) + '...' + fp.slice(-8);
  };

  // Cancel forms on Escape
  useEffect(() => {
    if (!isAdding && !editingId) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAdding(false);
        setEditingId(null);
        setAddName('');
        setEditName('');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isAdding, editingId]);

  const handleAddGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    const name = addName.trim();
    if (!name) return;
    addProfile(name);
    setAddName('');
    setIsAdding(false);
  };

  const handleAddImport = () => {
    const name = addName.trim();
    if (!name) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = addName.trim();
    if (!name) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      const bytes = new Uint8Array(buffer);
      let binary = '';
      bytes.forEach(b => (binary += String.fromCharCode(b)));
      importProfile(name, btoa(binary));
      setAddName('');
      setIsAdding(false);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    const name = editName.trim();
    if (!name) return;
    renameProfile(editingId, name);
    setEditingId(null);
    setEditName('');
  };

  const handleEditStart = (profile: { id: string; name: string }) => {
    setEditingId(profile.id);
    setEditName(profile.name);
    setIsAdding(false);
  };

  const handleDelete = async (profile: { id: string; name: string }) => {
    const confirmed = await confirm({
      title: 'Delete profile',
      message: `Remove "${profile.name}"? The certificate file will be kept on disk.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    });
    if (confirmed) removeProfile(profile.id);
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setAddName('');
    setEditName('');
  };

  if (loading) {
    return (
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Profiles</h3>
        <div className="profiles-empty">
          <p>Loading profiles...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <h3 className="heading-section settings-section-title">Profiles</h3>

      {profiles.length > 0 ? (
        <div className="profiles-items">
          {profiles.map((profile, index) => {
            const isActive = profile.id === activeProfileId;

            if (editingId === profile.id) {
              return (
                <form key={profile.id} className="profiles-form" onSubmit={handleEditSubmit}>
                  <h3 className="heading-section profiles-form-title">Rename Profile</h3>
                  <div className="profiles-form-fields">
                    <input
                      className="brmble-input profiles-input"
                      placeholder="Profile Name"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="profiles-form-actions">
                    <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={!editName.trim()}>
                      Save
                    </button>
                  </div>
                </form>
              );
            }

            return (
              <div
                key={profile.id}
                className={`profiles-item${isActive ? ' profiles-item-active' : ''}`}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="profiles-icon">
                  {getInitial(profile.name)}
                </div>
                <div className="profiles-info">
                  <span className="profiles-name">{profile.name}</span>
                  <span className="profiles-fingerprint">{truncateFingerprint(profile.fingerprint)}</span>
                  {isActive && <span className="profiles-active-badge">Active</span>}
                </div>
                <div className="profiles-actions">
                  <Tooltip content={connected ? 'Disconnect to switch profiles' : isActive ? 'Already active' : 'Set as active profile'}>
                    <button
                      className="btn btn-primary profiles-action-btn"
                      onClick={() => setActive(profile.id)}
                      disabled={connected || isActive}
                    >
                      Activate
                    </button>
                  </Tooltip>
                  <Tooltip content="Rename profile">
                    <button
                      className="btn btn-secondary profiles-action-btn"
                      onClick={() => handleEditStart(profile)}
                    >
                      Edit
                    </button>
                  </Tooltip>
                  {isActive && (
                    <Tooltip content="Export certificate">
                      <button
                        className="btn btn-secondary profiles-action-btn"
                        onClick={() => exportCert()}
                      >
                        Export
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip content="Delete profile">
                    <button
                      className="btn btn-ghost profiles-delete-btn"
                      onClick={() => handleDelete(profile)}
                    >
                      ✕
                    </button>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="profiles-empty">
          <div className="profiles-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <p>No profiles yet</p>
          <p className="profiles-empty-hint">Create a profile to manage multiple identities</p>
        </div>
      )}

      {/* Hidden file input for certificate import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pfx,.p12"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {isAdding && (
        <form className="profiles-form" onSubmit={handleAddGenerate}>
          <h3 className="heading-section profiles-form-title">Add New Profile</h3>
          <div className="profiles-form-fields">
            <input
              className="brmble-input profiles-input"
              placeholder="Profile Name"
              value={addName}
              onChange={e => setAddName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="profiles-form-actions">
            <button type="button" className="btn btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleAddImport} disabled={!addName.trim()}>
              Import Certificate
            </button>
            <button type="submit" className="btn btn-primary" disabled={!addName.trim()}>
              Generate New Certificate
            </button>
          </div>
        </form>
      )}

      {!isAdding && !editingId && (
        <button className="btn btn-ghost profiles-add-btn" onClick={() => setIsAdding(true)}>
          <span className="profiles-add-icon">+</span>
          Add Profile
        </button>
      )}
    </div>
  );
}
