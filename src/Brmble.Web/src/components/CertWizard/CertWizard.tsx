import { useState, useEffect, useRef } from 'react';
import bridge from '../../bridge';
import './CertWizard.css';

type WizardStep = 'welcome' | 'choose' | 'warning' | 'action' | 'backup';
type WizardMode = 'generate' | 'import';

interface CertWizardProps {
  onComplete: (fingerprint: string) => void;
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

export function CertWizard({ onComplete }: CertWizardProps) {
  const [step, setStep] = useState<WizardStep>('welcome');
  const [mode, setMode] = useState<WizardMode>('generate');
  const [acknowledged, setAcknowledged] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [fingerprint, setFingerprint] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const STEPS: WizardStep[] = ['welcome', 'choose', 'warning', 'action', 'backup'];
  const stepIndex = STEPS.indexOf(step);

  useEffect(() => {
    const onGenerated = (data: unknown) => {
      const d = data as { fingerprint: string } | undefined;
      setGenerating(false);
      if (d?.fingerprint) {
        setFingerprint(d.fingerprint);
        setStep('backup');
      }
    };

    const onImported = (data: unknown) => {
      const d = data as { fingerprint: string } | undefined;
      if (d?.fingerprint) {
        setFingerprint(d.fingerprint);
        setStep('backup');
      }
    };

    const onExportData = (data: unknown) => {
      const d = data as { data: string; filename: string } | undefined;
      if (d?.data) triggerBlobDownload(d.data, d.filename ?? 'brmble-identity.pfx');
    };

    const onError = (data: unknown) => {
      const d = data as { message: string } | undefined;
      setGenerating(false);
      setError(d?.message ?? 'An error occurred.');
    };

    bridge.on('cert.generated', onGenerated);
    bridge.on('cert.imported', onImported);
    bridge.on('cert.exportData', onExportData);
    bridge.on('cert.error', onError);
    return () => {
      bridge.off('cert.generated', onGenerated);
      bridge.off('cert.imported', onImported);
      bridge.off('cert.exportData', onExportData);
      bridge.off('cert.error', onError);
    };
  }, []);

  const handleGenerate = () => {
    setError('');
    setGenerating(true);
    bridge.send('cert.generate');
  };

  const handleImportClick = () => {
    setError('');
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      const bytes = new Uint8Array(buffer);
      let binary = '';
      bytes.forEach(b => binary += String.fromCharCode(b));
      const base64 = btoa(binary);
      bridge.send('cert.import', { data: base64 });
    };
    reader.readAsArrayBuffer(file);
    // Reset so the same file can be re-selected if needed
    e.target.value = '';
  };

  const handleExportNow = () => {
    bridge.send('cert.export');
    onComplete(fingerprint);
  };

  return (
    <div className="cert-wizard-overlay">
      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pfx,.p12"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div className="cert-wizard glass-panel">
        {/* Step dots */}
        <div className="cert-wizard-step-indicator">
          {STEPS.map((s, i) => (
            <div key={s} className={`cert-wizard-dot ${i <= stepIndex ? 'active' : ''}`} />
          ))}
        </div>

        {step === 'welcome' && (
          <>
            <div className="cert-wizard-icon">🔐</div>
            <h2 className="cert-wizard-title">Welcome to Brmble</h2>
            <p className="cert-wizard-body">
              Before you can connect to a server, Brmble needs to create your identity
              certificate.<br /><br />
              Your certificate is your identity across <strong>voice</strong>,{' '}
              <strong>chat history</strong>, and <strong>screen sharing</strong>. It is
              unique to you and lives on this computer.
            </p>
            <div className="cert-wizard-actions">
              <button
                className="btn btn-primary"
                onClick={() => setStep('choose')}
              >
                Get Started
              </button>
            </div>
          </>
        )}

        {step === 'choose' && (
          <>
            <div className="cert-wizard-icon">🪪</div>
            <h2 className="cert-wizard-title">Set Up Your Identity</h2>
            <div className="cert-wizard-choices">
              <button className="cert-wizard-choice" onClick={() => { setMode('generate'); setStep('warning'); }}>
                <span className="cert-wizard-choice-icon">✨</span>
                <div>
                  <div className="cert-wizard-choice-label">Generate a new certificate</div>
                  <div className="cert-wizard-choice-desc">First time on Brmble? Start here.</div>
                </div>
              </button>
              <button className="cert-wizard-choice" onClick={() => { setMode('import'); setStep('warning'); }}>
                <span className="cert-wizard-choice-icon">📂</span>
                <div>
                  <div className="cert-wizard-choice-label">Import an existing certificate</div>
                  <div className="cert-wizard-choice-desc">Already have a .pfx or .p12 file? Import it.</div>
                </div>
              </button>
            </div>
          </>
        )}

        {step === 'warning' && (
          <>
            <div className="cert-wizard-icon">⚠️</div>
            <h2 className="cert-wizard-title">Important: Back Up Your Certificate</h2>
            <div className="cert-wizard-warning">
              <strong>Your certificate cannot be recovered.</strong>
              If you reinstall Windows, replace your computer, or lose this file without a
              backup — you will permanently lose access to your chat history, your registered
              username, and every permission tied to your identity on every Brmble server.
              A new certificate always creates a completely new user. There is no recovery
              process.
            </div>
            <label className="cert-wizard-ack">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={e => setAcknowledged(e.target.checked)}
              />
              <span>
                I understand. If I lose this certificate without a backup, I will start
                over as a brand new user with no history.
              </span>
            </label>
            <div className="cert-wizard-actions">
              <button className="btn btn-ghost" onClick={() => setStep('choose')}>
                Back
              </button>
              <button
                className="btn btn-primary"
                disabled={!acknowledged}
                onClick={() => setStep('action')}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === 'action' && mode === 'generate' && (
          <>
            <div className="cert-wizard-icon">✨</div>
            <h2 className="cert-wizard-title">Generate Your Certificate</h2>
            <p className="cert-wizard-body">
              Brmble will generate a unique identity certificate for you.
            </p>
            {generating && (
              <div className="cert-wizard-generating">
                <div className="cert-wizard-spinner" />
                Generating your certificate...
              </div>
            )}
            {error && <p style={{ color: 'var(--accent-danger-text)', fontSize: '0.85rem', marginBottom: '1rem' }}>{error}</p>}
              <div className="cert-wizard-actions">
                <button className="btn btn-ghost" onClick={() => setStep('warning')}>
                  Back
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  {generating ? 'Generating...' : 'Generate Now'}
                </button>
              </div>
          </>
        )}

        {step === 'action' && mode === 'import' && (
          <>
            <div className="cert-wizard-icon">📂</div>
            <h2 className="cert-wizard-title">Import Your Certificate</h2>
            <p className="cert-wizard-body">
              Select your existing <code>.pfx</code> or <code>.p12</code> certificate file.
            </p>
            {error && <p style={{ color: 'var(--accent-danger-text)', fontSize: '0.85rem', marginBottom: '1rem' }}>{error}</p>}
            <div className="cert-wizard-actions">
              <button className="cert-wizard-btn ghost" onClick={() => setStep('warning')}>
                Back
              </button>
              <button className="cert-wizard-btn primary" onClick={handleImportClick}>
                Choose File…
              </button>
            </div>
          </>
        )}

        {step === 'backup' && (
          <>
            <div className="cert-wizard-icon">✅</div>
            <h2 className="cert-wizard-title">Certificate Ready</h2>
            <p className="cert-wizard-body">
              Your certificate has been set up. Export it now and store it somewhere safe
              — an external drive, cloud storage, or password manager.
            </p>
            <div className="cert-wizard-fingerprint">{fingerprint}</div>
            <div className="cert-wizard-actions">
              <button className="btn btn-ghost" onClick={() => onComplete(fingerprint)}>
                Skip Backup (Not Recommended)
              </button>
              <button className="btn btn-primary" onClick={handleExportNow}>
                Export & Continue
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
