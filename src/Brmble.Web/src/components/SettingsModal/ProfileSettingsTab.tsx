import { useState, useEffect, useRef } from 'react';
import Avatar from '../Avatar/Avatar';
import AvatarUpload from '../AvatarUpload/AvatarUpload';
import bridge from '../../bridge';
import './ProfileSettingsTab.css';

interface ProfileSettingsTabProps {
  currentUser: {
    name: string;
    matrixUserId?: string;
    avatarUrl?: string;
  };
  onUploadAvatar: (blob: Blob, contentType: string) => void;
  onRemoveAvatar: () => void;
  fingerprint: string;
  connectedUsername: string;
  connected: boolean;
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

export function ProfileSettingsTab({ currentUser, onUploadAvatar, onRemoveAvatar, fingerprint, connectedUsername, connected }: ProfileSettingsTabProps) {
  const [showUpload, setShowUpload] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleExport = () => bridge.send('cert.export');
  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      const bytes = new Uint8Array(buffer);
      let binary = '';
      bytes.forEach(b => binary += String.fromCharCode(b));
      bridge.send('cert.import', { data: btoa(binary) });
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
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
            {connected ? (
              <div className="profile-avatar-actions">
                <button className="btn btn-primary" onClick={() => setShowUpload(true)}>Upload</button>
                {currentUser.avatarUrl && (
                  <button className="btn btn-secondary" onClick={onRemoveAvatar}>Remove</button>
                )}
              </div>
            ) : (
              <span className="profile-avatar-hint" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Connect to a server to change your avatar</span>
            )}
          </div>
        </div>
      </div>

      {/* Certificate section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Certificate</h3>
        <div className="settings-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
          <label>Fingerprint</label>
          <span style={{
            fontFamily: 'monospace',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            wordBreak: 'break-all',
            background: 'var(--bg-glass)',
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            width: '100%',
            boxSizing: 'border-box',
          }}>
            {fingerprint || '\u2014'}
          </span>
        </div>
        <div className="settings-item">
          <label>Current server username</label>
          <span className="settings-value">{connectedUsername || 'Not connected'}</span>
        </div>
      </div>

      {/* Manage section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Manage</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pfx,.p12"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <div className="settings-item">
          <div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Export Certificate</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Save a backup of your identity to a file</div>
          </div>
          <button className="btn btn-primary" onClick={handleExport}>Export</button>
        </div>
        <div className="settings-item">
          <div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Import Different Certificate</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Takes effect on next launch</div>
          </div>
          <button className="btn btn-secondary" onClick={handleImportClick}>Import</button>
        </div>
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
