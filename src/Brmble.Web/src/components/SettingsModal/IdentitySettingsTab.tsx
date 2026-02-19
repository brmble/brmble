import { useEffect, useRef } from 'react';
import bridge from '../../bridge';

interface IdentitySettingsTabProps {
  fingerprint: string;
  connectedUsername: string;
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

export function IdentitySettingsTab({ fingerprint, connectedUsername }: IdentitySettingsTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pfx,.p12"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div className="settings-section">
        <p className="settings-section-title">Certificate</p>
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
            {fingerprint || '—'}
          </span>
        </div>
        <div className="settings-item">
          <label>Current server username</label>
          <span className="settings-value">{connectedUsername || 'Not connected'}</span>
        </div>
      </div>

      <div className="settings-section">
        <p className="settings-section-title">Manage</p>
        <div className="settings-item">
          <div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Export Certificate</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Save a backup of your identity to a file</div>
          </div>
          <button className="settings-btn primary" onClick={handleExport}>Export</button>
        </div>
        <div className="settings-item">
          <div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Import Different Certificate</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Takes effect on next launch</div>
          </div>
          <button className="settings-btn secondary" onClick={handleImportClick}>Import</button>
        </div>
      </div>
    </div>
  );
}
