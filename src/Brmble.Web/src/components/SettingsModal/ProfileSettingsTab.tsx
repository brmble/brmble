import { useState, useEffect, useRef } from 'react';
import Avatar from '../Avatar/Avatar';
import AvatarUpload from '../AvatarUpload/AvatarUpload';
import bridge from '../../bridge';
import { useProfiles } from '../../hooks/useProfiles';
import { confirm } from '../../hooks/usePrompt';
import { validateProfileName } from '../../utils/profileValidation';
import { Select } from '../Select/Select';
import { Tooltip } from '../Tooltip/Tooltip';
import './ProfileSettingsTab.css';
import './ProfilesSettingsTab.css';

interface ProfileSettingsTabProps {
  currentUser: {
    name: string;
    matrixUserId?: string;
    avatarUrl?: string;
  };
  onUploadAvatar: (blob: Blob, contentType: string) => void;
  onRemoveAvatar: () => void;
  connected: boolean;
  registeredName?: string;
}

function getAvatarStatusText(user: ProfileSettingsTabProps['currentUser']): string {
  if (!user.avatarUrl) return 'Default';
  if (user.avatarUrl.startsWith('mxc://') || user.avatarUrl.includes('/_matrix/')) {
    return 'Uploaded';
  }
  return 'From Mumble';
}

function triggerBlobDownload(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/x-pkcs12' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ProfileSettingsTab({ currentUser, onUploadAvatar, onRemoveAvatar, connected, registeredName }: ProfileSettingsTabProps) {
  const [showUpload, setShowUpload] = useState(false);
  const { profiles, activeProfileId, loading, addProfile, importProfile, removeProfile, renameProfile, setActive, exportCert, checkExistingCert, addFromExisting, renameSwapCert } = useProfiles();

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addName, setAddName] = useState('');
  const [editName, setEditName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addNameError = addName.trim() ? validateProfileName(addName.trim()) : null;
  const editNameError = editName.trim() ? validateProfileName(editName.trim()) : null;

  const statusText = getAvatarStatusText(currentUser);

  // Certificate export handler
  useEffect(() => {
    const onExportData = (data: unknown) => {
      const d = data as { data: string; filename: string } | undefined;
      if (d?.data) triggerBlobDownload(d.data, d.filename ?? 'brmble-identity.pfx');
    };
    bridge.on('cert.exportData', onExportData);
    return () => bridge.off('cert.exportData', onExportData);
  }, []);

  // Cancel forms on Escape — stop propagation so SettingsModal doesn't also close
  useEffect(() => {
    if (!isAdding && !editingId) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        setIsAdding(false);
        setEditingId(null);
        setAddName('');
        setEditName('');
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [isAdding, editingId]);

  const getInitial = (name: string) => (name?.charAt(0) || '?').toUpperCase();

  const formatFingerprint = (fp: string | null) => {
    if (!fp) return 'No certificate';
    return fp;
  };

  const isDuplicateName = (name: string, excludeId?: string) =>
    profiles.some(p => p.name.toLowerCase() === name.toLowerCase() && p.id !== excludeId);

  const handleAddGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = addName.trim();
    if (!name) return;
    const nameError = validateProfileName(name);
    if (nameError) {
      await confirm({ title: 'Invalid name', message: nameError, confirmLabel: 'OK' });
      return;
    }
    if (isDuplicateName(name)) {
      await confirm({ title: 'Duplicate name', message: `A profile named "${name}" already exists.`, confirmLabel: 'OK' });
      return;
    }
    const existing = await checkExistingCert(name);
    if (existing.exists) {
      const reuse = await confirm({
        title: 'Certificate found',
        message: `A certificate file for "${name}" already exists in Brmble. Would you like to use it instead of generating a new one?`,
        confirmLabel: 'Use existing',
        cancelLabel: 'Generate new',
      });
      if (reuse) {
        addFromExisting(name);
        setAddName('');
        setIsAdding(false);
        return;
      }
    }
    addProfile(name);
    setAddName('');
    setIsAdding(false);
  };

  const handleAddImport = async () => {
    const name = addName.trim();
    if (!name) return;
    const nameError = validateProfileName(name);
    if (nameError) {
      await confirm({ title: 'Invalid name', message: nameError, confirmLabel: 'OK' });
      return;
    }
    if (isDuplicateName(name)) {
      await confirm({ title: 'Duplicate name', message: `A profile named "${name}" already exists.`, confirmLabel: 'OK' });
      return;
    }
    const existing = await checkExistingCert(name);
    if (existing.exists) {
      const reuse = await confirm({
        title: 'Certificate found',
        message: `A certificate file for "${name}" already exists in Brmble. Would you like to use it instead of importing a different one?`,
        confirmLabel: 'Use existing',
        cancelLabel: 'Import different',
      });
      if (reuse) {
        addFromExisting(name);
        setAddName('');
        setIsAdding(false);
        return;
      }
    }
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

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    const name = editName.trim();
    if (!name) return;
    const nameError = validateProfileName(name);
    if (nameError) {
      await confirm({ title: 'Invalid name', message: nameError, confirmLabel: 'OK' });
      return;
    }
    if (isDuplicateName(name, editingId)) {
      await confirm({ title: 'Duplicate name', message: `A profile named "${name}" already exists.`, confirmLabel: 'OK' });
      return;
    }
    const existing = await checkExistingCert(name);
    if (existing.exists) {
      const currentProfile = profiles.find(p => p.id === editingId);
      // Only offer swap if the found cert is different from this profile's cert
      if (!currentProfile || existing.fingerprint !== currentProfile.fingerprint) {
        const swap = await confirm({
          title: 'Certificate found',
          message: `A certificate file for "${name}" already exists in Brmble. Would you like to use that certificate for this profile?`,
          confirmLabel: 'Use existing',
          cancelLabel: 'Keep current',
        });
        if (swap) {
          renameSwapCert(editingId, name);
          setEditingId(null);
          setEditName('');
          return;
        }
      }
    }
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
      message: `Remove "${profile.name}"? The certificate file will remain on disk and can be re-imported later.`,
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

  return (
    <div className="profile-settings-tab">
      {/* Avatar section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Avatar</h3>
        <div className="profile-avatar-section">
          <Avatar user={currentUser} size={80} />
          <div className="profile-avatar-info">
            <span className="profile-display-name">{currentUser.name}</span>
            <span className="profile-display-name-hint">Set by Mumble registration</span>
            <span className="profile-avatar-status">{statusText}</span>
          </div>
          {connected ? (
            <div className="profile-avatar-actions">
              <button className="btn btn-primary" onClick={() => setShowUpload(true)}>Upload</button>
              {currentUser.avatarUrl && (
                <button className="btn btn-secondary" onClick={onRemoveAvatar}>Remove</button>
              )}
            </div>
          ) : (
            <span className="profile-avatar-hint">Connect to a server to change your avatar</span>
          )}
        </div>
      </div>

      {/* Profile dropdown section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Profile</h3>
        <div className="settings-item">
          <label>Active Profile</label>
          <Tooltip content={connected ? 'Disconnect to switch profiles' : 'Select your active profile'}>
            <div className="profile-select-wrapper">
              <Select
                value={activeProfileId ?? ''}
                onChange={(val) => setActive(val)}
                options={profiles.map(p => ({ value: p.id, label: p.name }))}
                disabled={connected || loading || profiles.length === 0}
                placeholder="No profiles"
              />
            </div>
          </Tooltip>
        </div>
        {connected && registeredName && (
          <div className="settings-item">
            <label>Registered name on server</label>
            <span className="profile-registered-name">
              {registeredName}
              <svg className="profile-registered-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="3.5 8 6.5 11 12.5 5" />
              </svg>
            </span>
          </div>
        )}
      </div>

      {/* Manage Profiles section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Manage Profiles</h3>

        {/* Hidden file input for certificate import */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pfx,.p12"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {!loading && profiles.length > 0 ? (
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
                      {editNameError && <span className="profiles-form-error">{editNameError}</span>}
                    </div>
                    <div className="profiles-form-actions">
                      <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary" disabled={!editName.trim() || !!editNameError}>
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
                    <span className="profiles-fingerprint">{formatFingerprint(profile.fingerprint)}</span>

                  </div>
                  <div className="profiles-actions">
                    <Tooltip content={connected && isActive ? 'Disconnect to delete this profile' : 'Delete profile'}>
                      <span>
                        <button
                          className="btn btn-ghost profiles-delete-btn"
                          onClick={() => handleDelete(profile)}
                          disabled={connected && isActive}
                        >
                          ✕
                        </button>
                      </span>
                    </Tooltip>
                    <Tooltip content={connected ? 'Disconnect to rename profiles' : 'Rename profile'}>
                      <span>
                        <button
                          className="btn btn-secondary profiles-action-btn"
                          onClick={() => handleEditStart(profile)}
                          disabled={connected}
                        >
                          Edit
                        </button>
                      </span>
                    </Tooltip>
                    <Tooltip content="Export certificate">
                      <button
                        className="btn btn-primary profiles-action-btn"
                        onClick={() => exportCert(profile.id)}
                      >
                        Export
                      </button>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        ) : !loading ? (
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
        ) : null}

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
              {addNameError && <span className="profiles-form-error">{addNameError}</span>}
            </div>
            <div className="profiles-form-actions">
              <button type="button" className="btn btn-secondary" onClick={handleAddImport} disabled={!addName.trim() || !!addNameError}>
                Import Certificate
              </button>
              <button type="submit" className="btn btn-primary" disabled={!addName.trim() || !!addNameError}>
                Generate New Certificate
              </button>
            </div>
            <div className="profiles-form-actions">
              <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                Cancel
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

      {showUpload && (
        <AvatarUpload
          onUpload={(blob, contentType) => {
            onUploadAvatar(blob, contentType);
            setShowUpload(false);
          }}
          onCancel={() => setShowUpload(false)}
        />
      )}
    </div>
  );
}
