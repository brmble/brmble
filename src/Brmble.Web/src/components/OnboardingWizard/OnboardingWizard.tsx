import { useState, useEffect, useRef, useCallback } from 'react';
import bridge from '../../bridge';
import { validateProfileName } from '../../utils/profileValidation';
import { Select } from '../Select/Select';
import { PttKeyCapture } from './PttKeyCapture';
import { themes } from '../../themes/theme-registry';
import { applyTheme } from '../../themes/theme-loader';
import './OnboardingWizard.css';

// ── Types ─────────────────────────────────────────────────────────

type WizardStep = 'welcome' | 'identity' | 'backup' | 'interface' | 'audio' | 'connection' | 'servers';

const STEPS: WizardStep[] = ['welcome', 'identity', 'backup', 'interface', 'audio', 'connection', 'servers'];

interface DetectedCert {
  source: 'mumble';
  name: string;
  fingerprint: string;
  data: string; // base64 PKCS#12
}

interface BrmbleProfile {
  id: string;
  name: string;
  fingerprint?: string;
  certValid?: boolean;
}

interface OnboardingWizardProps {
  onComplete: (fingerprint: string) => void;
  startAtPreferences?: boolean;
}

// ── Settings types (local copies to avoid SettingsModal coupling) ──

type TransmissionMode = 'pushToTalk' | 'voiceActivity' | 'continuous';

interface WizardSettings {
  // Interface
  theme: string;
  brmblegotchiEnabled: boolean;
  // Audio
  inputDevice: string;
  outputDevice: string;
  transmissionMode: TransmissionMode;
  pushToTalkKey: string | null;
  speechDenoiseMode: 'rnnoise' | 'disabled';
  // Connection
  reconnectEnabled: boolean;
  rememberLastChannel: boolean;
  autoConnectEnabled: boolean;
}

const SETTINGS_STORAGE_KEY = 'brmble-settings';

function loadInitialSettings(): WizardSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        theme: parsed.appearance?.theme ?? 'classic',
        brmblegotchiEnabled: parsed.brmblegotchi?.enabled ?? true,
        inputDevice: parsed.audio?.inputDevice ?? 'default',
        outputDevice: parsed.audio?.outputDevice ?? 'default',
        transmissionMode: parsed.audio?.transmissionMode ?? 'pushToTalk',
        pushToTalkKey: parsed.audio?.pushToTalkKey ?? null,
        speechDenoiseMode: parsed.speechDenoise?.mode ?? 'rnnoise',
        reconnectEnabled: parsed.reconnectEnabled ?? true,
        rememberLastChannel: parsed.rememberLastChannel ?? true,
        autoConnectEnabled: parsed.autoConnectEnabled ?? false,
      };
    }
  } catch { /* ignore */ }
  return {
    theme: 'classic',
    brmblegotchiEnabled: true,
    inputDevice: 'default',
    outputDevice: 'default',
    transmissionMode: 'pushToTalk',
    pushToTalkKey: null,
    speechDenoiseMode: 'rnnoise',
    reconnectEnabled: true,
    rememberLastChannel: true,
    autoConnectEnabled: false,
  };
}

// ── Helpers ───────────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────

export function OnboardingWizard({ onComplete, startAtPreferences }: OnboardingWizardProps) {
  const [step, setStep] = useState<WizardStep>(startAtPreferences ? 'interface' : 'welcome');
  const stepIndex = STEPS.indexOf(step);

  // Detection state
  const [detecting, setDetecting] = useState(false);
  const [mumbleCerts, setMumbleCerts] = useState<DetectedCert[]>([]);
  const [brmbleProfiles, setBrmbleProfiles] = useState<BrmbleProfile[]>([]);

  // Identity step state
  const [selectedIdentity, setSelectedIdentity] = useState<
    | { kind: 'brmble'; profile: BrmbleProfile }
    | { kind: 'mumble'; cert: DetectedCert }
    | { kind: 'new' }
    | null
  >(null);
  const [newName, setNewName] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [identityError, setIdentityError] = useState('');

  // Backup step state
  const [fingerprint, setFingerprint] = useState('');
  const [exportError, setExportError] = useState('');

  // Preferences state
  const [settings, setSettings] = useState<WizardSettings>(loadInitialSettings);

  // Server import step state
  interface MumbleServer { label: string; host: string; port: number; username: string; alreadySaved: boolean; }
  const [mumbleServers, setMumbleServers] = useState<MumbleServer[]>([]);
  const [selectedServers, setSelectedServers] = useState<Set<number>>(new Set());
  const [serversImportBusy, setServersImportBusy] = useState(false);

  // Listen for bridge events
  useEffect(() => {
    const onProfilesList = (data: unknown) => {
      const d = data as { profiles?: BrmbleProfile[] } | undefined;
      setBrmbleProfiles(d?.profiles ?? []);
    };
    const onProfileAdded = (data: unknown) => {
      const d = data as { fingerprint?: string } | undefined;
      setBusy(false);
      if (d?.fingerprint) {
        setFingerprint(d.fingerprint);
        setStep('backup');
      }
    };
    const onActiveChanged = (data: unknown) => {
      const d = data as { fingerprint?: string } | undefined;
      setBusy(false);
      if (d?.fingerprint) {
        setFingerprint(d.fingerprint);
      }
      setStep('backup');
    };
    const onProfilesError = (data: unknown) => {
      const d = data as { message?: string } | undefined;
      setBusy(false);
      setIdentityError(d?.message ?? 'An error occurred. Please try again.');
    };
    const onExportData = (data: unknown) => {
      const d = data as { data?: string; filename?: string } | undefined;
      if (d?.data) triggerBlobDownload(d.data, d.filename ?? 'brmble-identity.pfx');
    };
    const onCertError = (data: unknown) => {
      const d = data as { message?: string } | undefined;
      setExportError(d?.message ?? 'Export failed. Please try again.');
    };
    const onDetectedServers = (data: unknown) => {
      const d = data as { servers?: MumbleServer[] } | undefined;
      const svrs = d?.servers ?? [];
      setMumbleServers(svrs);
      // Pre-select all servers except those already saved in Brmble
      setSelectedServers(new Set(svrs.reduce<number[]>((acc, srv, i) => {
        if (!srv.alreadySaved) acc.push(i);
        return acc;
      }, [])));
    };
    const onServersImported = () => {
      setServersImportBusy(false);
      onComplete(fingerprint);
    };

    bridge.on('profiles.list', onProfilesList);
    bridge.on('profiles.added', onProfileAdded);
    bridge.on('profiles.activeChanged', onActiveChanged);
    bridge.on('profiles.error', onProfilesError);
    bridge.on('cert.exportData', onExportData);
    bridge.on('cert.error', onCertError);
    bridge.on('mumble.detectedServers', onDetectedServers);
    bridge.on('mumble.serversImported', onServersImported);

    // Request current profiles list immediately
    bridge.send('profiles.list');

    return () => {
      bridge.off('profiles.list', onProfilesList);
      bridge.off('profiles.added', onProfileAdded);
      bridge.off('profiles.activeChanged', onActiveChanged);
      bridge.off('profiles.error', onProfilesError);
      bridge.off('cert.exportData', onExportData);
      bridge.off('cert.error', onCertError);
      bridge.off('mumble.detectedServers', onDetectedServers);
      bridge.off('mumble.serversImported', onServersImported);
    };
  }, [fingerprint, onComplete]);

  // When detectedCerts arrives, advance to identity
  const setMumbleCertsAndAdvance = useCallback((certs: DetectedCert[]) => {
    setMumbleCerts(certs);
    setDetecting(false);
    setStep('identity');
  }, []);

  useEffect(() => {
    const handler = (data: unknown) => {
      const d = data as { certs?: DetectedCert[] } | undefined;
      setMumbleCertsAndAdvance(d?.certs ?? []);
    };
    bridge.on('mumble.detectedCerts', handler);
    return () => bridge.off('mumble.detectedCerts', handler);
  }, [setMumbleCertsAndAdvance]);

  // ── Save settings to localStorage and bridge ───────────────────

  const saveSettings = useCallback((s: WizardSettings) => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : {};
      const merged = {
        ...parsed,
        appearance: { ...(parsed.appearance ?? {}), theme: s.theme },
        brmblegotchi: { ...(parsed.brmblegotchi ?? {}), enabled: s.brmblegotchiEnabled },
        audio: {
          ...(parsed.audio ?? {}),
          inputDevice: s.inputDevice,
          outputDevice: s.outputDevice,
          transmissionMode: s.transmissionMode,
          pushToTalkKey: s.pushToTalkKey,
        },
        speechDenoise: { mode: s.speechDenoiseMode },
        reconnectEnabled: s.reconnectEnabled,
        rememberLastChannel: s.rememberLastChannel,
        autoConnectEnabled: s.autoConnectEnabled,
      };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
      bridge.send('settings.set', merged);
    } catch { /* ignore */ }
  }, []);

  const updateSettings = useCallback((patch: Partial<WizardSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      if (patch.theme) applyTheme(patch.theme);
      return next;
    });
  }, [saveSettings]);

  // ── Step handlers ──────────────────────────────────────────────

  const detectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleGetStartedWithTimer = () => {
    setDetecting(true);
    bridge.send('mumble.detectCerts');
    detectionTimerRef.current = setTimeout(() => {
      setDetecting(false);
      setStep('identity');
    }, 2000);
  };

  const handleIdentityContinue = () => {
    if (!selectedIdentity) return;
    setIdentityError('');
    setBusy(true);

    if (selectedIdentity.kind === 'brmble') {
      bridge.send('profiles.setActive', { id: selectedIdentity.profile.id });
    } else if (selectedIdentity.kind === 'mumble') {
      bridge.send('profiles.import', {
        name: selectedIdentity.cert.name,
        data: selectedIdentity.cert.data,
      });
    } else {
      bridge.send('profiles.add', { name: newName.trim() });
    }
  };

  // Derived: all known names (for uniqueness check)
  const takenNames = [
    ...brmbleProfiles.map(p => p.name.toLowerCase()),
    ...mumbleCerts.map(c => c.name.toLowerCase()),
  ];

  const newNameValidation = (() => {
    if (!newName.trim()) return null;
    const basic = validateProfileName(newName.trim());
    if (basic) return basic;
    if (takenNames.includes(newName.trim().toLowerCase())) {
      return 'This name is already taken by an existing identity.';
    }
    return null;
  })();

  const canCreateNew = selectedIdentity?.kind === 'new'
    && newName.trim().length > 0
    && newNameValidation === null
    && acknowledged;

  const canContinueIdentity = (() => {
    if (!selectedIdentity) return false;
    if (selectedIdentity.kind === 'brmble') return true;
    if (selectedIdentity.kind === 'mumble') return true;
    return canCreateNew;
  })();

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-panel glass-panel">

        {/* Progress dots */}
        <div className="onboarding-dots">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`onboarding-dot${i <= stepIndex ? ' active' : ''}`}
            />
          ))}
        </div>

        {/* ── Step 1: Welcome ── */}
        {step === 'welcome' && (
          <>
            <div className="onboarding-icon">🔐</div>
            <h2 className="heading-title onboarding-title">Welcome to Brmble</h2>
            <p className="onboarding-body">
              Brmble is a self-hosted, privacy-first platform for voice, chat, and screen
              sharing. There is no central account system — you connect directly to servers
              run by your community.
            </p>
            <p className="onboarding-body">
              Your identity is a <strong>certificate file</strong> stored on this computer.
              It is who you are on every server — your voice, your chat history, your
              permissions. There is no email, no password, and no recovery process if the
              file is lost.
            </p>
            <div className="onboarding-actions">
              <button className="btn btn-primary" onClick={handleGetStartedWithTimer}>
                Get Started
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Identity ── */}
        {step === 'identity' && (
          <>
            <div className="onboarding-icon">🪪</div>
            <h2 className="heading-title onboarding-title">Set Up Your Identity</h2>
            <p className="onboarding-body">
              Your profile name is your username on every server you connect to. Select an
              existing identity or create a new one.
            </p>

            {detecting && (
              <div className="onboarding-detecting">
                <div className="onboarding-spinner" />
                Scanning for existing certificates…
              </div>
            )}

            <div className="onboarding-identity-list">

              {/* Group 1: Existing Brmble profiles */}
              {brmbleProfiles.length > 0 && (
                <>
                  <div className="onboarding-identity-group-label">Your Brmble identities</div>
                  {brmbleProfiles.map(profile => (
                    <button
                      key={profile.id}
                      className={`onboarding-identity-card${selectedIdentity?.kind === 'brmble' && selectedIdentity.profile.id === profile.id ? ' selected' : ''}`}
                      onClick={() => setSelectedIdentity({ kind: 'brmble', profile })}
                    >
                      <span className="onboarding-identity-card-icon">🪪</span>
                      <div className="onboarding-identity-card-body">
                        <div className="onboarding-identity-card-name">{profile.name}</div>
                        {profile.fingerprint && (
                          <div className="onboarding-identity-card-meta">
                            {profile.fingerprint.slice(0, 23)}…
                          </div>
                        )}
                      </div>
                      <span className="onboarding-identity-badge brmble">Brmble</span>
                    </button>
                  ))}
                </>
              )}

              {/* Group 2: Mumble certificate */}
              {mumbleCerts.length > 0 && (
                <>
                  <div className="onboarding-identity-group-label">Found on this computer</div>
                  {mumbleCerts.map(cert => (
                    <button
                      key={cert.fingerprint}
                      className={`onboarding-identity-card${selectedIdentity?.kind === 'mumble' && selectedIdentity.cert.fingerprint === cert.fingerprint ? ' selected' : ''}`}
                      onClick={() => setSelectedIdentity({ kind: 'mumble', cert })}
                    >
                      <span className="onboarding-identity-card-icon">🎙️</span>
                      <div className="onboarding-identity-card-body">
                        <div className="onboarding-identity-card-name">{cert.name}</div>
                        <div className="onboarding-identity-card-meta">
                          {cert.fingerprint.slice(0, 23)}…
                        </div>
                        <div className="onboarding-identity-card-desc">
                          Your existing Mumble identity — import it to keep the same
                          username and permissions on servers.
                        </div>
                      </div>
                      <span className="onboarding-identity-badge mumble">Mumble</span>
                    </button>
                  ))}
                </>
              )}

              {/* Group 3: Create new */}
              <div className="onboarding-identity-group-label">Or start fresh</div>
              <button
                className={`onboarding-identity-card${selectedIdentity?.kind === 'new' ? ' selected' : ''}`}
                onClick={() => setSelectedIdentity({ kind: 'new' })}
              >
                <span className="onboarding-identity-card-icon">✨</span>
                <div className="onboarding-identity-card-body">
                  <div className="onboarding-identity-card-name">Create a new identity</div>
                  <div className="onboarding-identity-card-desc">
                    First time on Brmble? Start here.
                  </div>
                </div>
              </button>
            </div>

            {/* Inline new identity form */}
            {selectedIdentity?.kind === 'new' && (
              <div className="onboarding-new-identity-form">
                <label htmlFor="onboarding-new-name">Profile name (your username on servers)</label>
                <input
                  id="onboarding-new-name"
                  className="brmble-input"
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. YourName"
                  autoFocus
                />
                {newName.trim() && newNameValidation && (
                  <div className="onboarding-new-identity-error">{newNameValidation}</div>
                )}
              </div>
            )}

            {/* Inline warning + ack (only for new identity) */}
            {selectedIdentity?.kind === 'new' && (
              <>
                <div className="onboarding-inline-warning">
                  <strong>Starting a new identity?</strong>
                  Generating a new certificate creates a brand-new identity. If you
                  previously used Mumble, import your existing certificate instead so you
                  keep your username and history on all servers.
                </div>
                <label className="onboarding-ack">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={e => setAcknowledged(e.target.checked)}
                  />
                  <span>I understand — I want to create a new identity.</span>
                </label>
              </>
            )}

            {identityError && (
              <p style={{ color: 'var(--accent-danger-text)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-md)' }}>
                {identityError}
              </p>
            )}

            <div className="onboarding-actions">
              <button
                className="btn btn-primary"
                disabled={!canContinueIdentity || busy}
                onClick={handleIdentityContinue}
              >
                {busy ? 'Setting up…' : 'Continue'}
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Backup ── */}
        {step === 'backup' && (
          <>
            <div className="onboarding-icon">💾</div>
            <h2 className="heading-title onboarding-title">Save a copy of your certificate</h2>
            <p className="onboarding-body">
              Your certificate is the only copy of your identity. If you lose this computer
              or reinstall Windows without a backup, there is no way to recover it — you
              would start over as a new user on every server.
            </p>
            <p className="onboarding-body">Suggested places to store your backup:</p>
            <ul className="onboarding-backup-locations">
              <li>OneDrive, Google Drive, Dropbox, or iCloud Drive</li>
              <li>A USB drive kept somewhere safe</li>
              <li>A password manager that supports file attachments</li>
            </ul>
            {fingerprint && (
              <div className="onboarding-fingerprint">{fingerprint}</div>
            )}
            {exportError && (
              <p style={{ color: 'var(--accent-danger-text)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-md)' }}>
                {exportError}
              </p>
            )}
            <div className="onboarding-actions">
              <button
                className="onboarding-skip-link"
                onClick={() => setStep('interface')}
              >
                Skip (Not Recommended)
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setExportError('');
                  bridge.send('cert.export');
                  setStep('interface');
                }}
              >
                Export &amp; Continue
              </button>
            </div>
          </>
        )}

        {/* ── Step 4: Interface ── */}
        {step === 'interface' && (
          <>
            <div className="onboarding-icon">🎨</div>
            <h2 className="heading-title onboarding-title">Interface</h2>
            <p className="onboarding-body">Customise how Brmble looks and feels.</p>

            <div className="onboarding-pref-section">
              <div className="onboarding-pref-item">
                <label htmlFor="onboarding-theme">Theme</label>
                <Select
                  value={settings.theme}
                  onChange={v => updateSettings({ theme: v })}
                  options={themes.map(t => ({ value: t.id, label: t.name }))}
                />
              </div>
              <div className="onboarding-pref-item">
                <label htmlFor="onboarding-gotchi">Show Brmblegotchi</label>
                <label className="brmble-toggle">
                  <input
                    id="onboarding-gotchi"
                    type="checkbox"
                    checked={settings.brmblegotchiEnabled}
                    onChange={e => updateSettings({ brmblegotchiEnabled: e.target.checked })}
                  />
                  <span className="brmble-toggle-slider" />
                </label>
              </div>
              <p className="onboarding-pref-hint">
                Brmblegotchi is a small virtual companion that lives in your sidebar.
              </p>
            </div>

            <div className="onboarding-actions">
              <button className="onboarding-skip-link" onClick={() => setStep('audio')}>
                Skip
              </button>
              <button className="btn btn-ghost" onClick={() => setStep('backup')}>Back</button>
              <button className="btn btn-primary" onClick={() => setStep('audio')}>Next</button>
            </div>
          </>
        )}

        {/* ── Step 5: Audio ── */}
        {step === 'audio' && (
          <>
            <div className="onboarding-icon">🎙️</div>
            <h2 className="heading-title onboarding-title">Audio</h2>
            <p className="onboarding-body">
              Configure your microphone and how your voice is transmitted.
            </p>

            <div className="onboarding-pref-section">
              <div className="onboarding-pref-item">
                <label>Input device</label>
                <Select
                  value={settings.inputDevice}
                  onChange={v => updateSettings({ inputDevice: v })}
                  options={[{ value: 'default', label: 'Default' }]}
                />
              </div>
              <div className="onboarding-pref-item">
                <label>Output device</label>
                <Select
                  value={settings.outputDevice}
                  onChange={v => updateSettings({ outputDevice: v })}
                  options={[{ value: 'default', label: 'Default' }]}
                />
              </div>
            </div>

            <div className="onboarding-pref-section">
              <h3 className="heading-section onboarding-pref-section-title">Transmission mode</h3>
              <div className="onboarding-tx-cards">
                {(
                  [
                    { value: 'pushToTalk', label: 'Push to Talk', desc: 'Hold a key to transmit. Recommended for most users.' },
                    { value: 'voiceActivity', label: 'Voice Activity', desc: 'Transmit automatically when your mic detects speech.' },
                    { value: 'continuous', label: 'Continuous', desc: 'Always transmit. Not recommended unless you have a dedicated mic setup.' },
                  ] as { value: TransmissionMode; label: string; desc: string }[]
                ).map(opt => (
                  <button
                    key={opt.value}
                    className={`onboarding-tx-card${settings.transmissionMode === opt.value ? ' selected' : ''}`}
                    onClick={() => updateSettings({ transmissionMode: opt.value })}
                  >
                    <div>
                      <div className="onboarding-tx-card-label">{opt.label}</div>
                      <div className="onboarding-tx-card-desc">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>

              {settings.transmissionMode === 'pushToTalk' && (
                <div className="onboarding-pref-item" style={{ marginTop: 'var(--space-md)' }}>
                  <label>Push to Talk key</label>
                  <PttKeyCapture
                    value={settings.pushToTalkKey}
                    onChange={v => updateSettings({ pushToTalkKey: v })}
                  />
                </div>
              )}
            </div>

            <div className="onboarding-pref-section">
              <div className="onboarding-pref-item">
                <label>Noise suppression</label>
                <Select
                  value={settings.speechDenoiseMode}
                  onChange={v => updateSettings({ speechDenoiseMode: v as 'rnnoise' | 'disabled' })}
                  options={[
                    { value: 'rnnoise', label: 'RNNoise' },
                    { value: 'disabled', label: 'Disabled' },
                  ]}
                />
              </div>
            </div>

            <div className="onboarding-actions">
              <button className="onboarding-skip-link" onClick={() => setStep('connection')}>
                Skip
              </button>
              <button className="btn btn-ghost" onClick={() => setStep('interface')}>Back</button>
              <button className="btn btn-primary" onClick={() => setStep('connection')}>Next</button>
            </div>
          </>
        )}

        {/* ── Step 6: Connection ── */}
        {step === 'connection' && (
          <>
            <div className="onboarding-icon">🌐</div>
            <h2 className="heading-title onboarding-title">Connection</h2>
            <p className="onboarding-body">
              Configure how Brmble connects and reconnects to servers.
            </p>

            <div className="onboarding-pref-section">
              <div className="onboarding-pref-item">
                <label>Automatically reconnect when disconnected</label>
                <label className="brmble-toggle">
                  <input
                    type="checkbox"
                    checked={settings.reconnectEnabled}
                    onChange={e => updateSettings({ reconnectEnabled: e.target.checked })}
                  />
                  <span className="brmble-toggle-slider" />
                </label>
              </div>
              <div className="onboarding-pref-item">
                <label>Rejoin last voice channel on connect</label>
                <label className="brmble-toggle">
                  <input
                    type="checkbox"
                    checked={settings.rememberLastChannel}
                    onChange={e => updateSettings({ rememberLastChannel: e.target.checked })}
                  />
                  <span className="brmble-toggle-slider" />
                </label>
              </div>
              <div className="onboarding-pref-item">
                <label>Auto-connect on startup</label>
                <label className="brmble-toggle">
                  <input
                    type="checkbox"
                    checked={settings.autoConnectEnabled}
                    onChange={e => updateSettings({ autoConnectEnabled: e.target.checked })}
                  />
                  <span className="brmble-toggle-slider" />
                </label>
              </div>
              {settings.autoConnectEnabled && (
                <p className="onboarding-pref-hint">
                  Once you have added a server, Brmble can connect to it automatically when
                  you launch the app. You can choose which server in Settings → Connection.
                </p>
              )}
            </div>

            <div className="onboarding-actions">
              <button className="btn btn-ghost" onClick={() => setStep('audio')}>Back</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  bridge.send('mumble.detectServers');
                  setStep('servers');
                }}
              >
                Next
              </button>
            </div>
          </>
        )}

        {/* ── Step 7: Import Servers ── */}
        {step === 'servers' && (
          <>
            <div className="onboarding-icon">🖥️</div>
            <h2 className="heading-title onboarding-title">Import Your Servers</h2>

            {mumbleServers.length === 0 ? (
              <>
                <p className="onboarding-body">
                  No Mumble server favourites were found on this computer.
                </p>
                <div className="onboarding-actions">
                  <button className="btn btn-ghost" onClick={() => setStep('connection')}>Back</button>
                  <button className="btn btn-primary" onClick={() => onComplete(fingerprint)}>
                    Finish
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="onboarding-body">
                  We found your Mumble server favourites. Select the ones you want to add to
                  Brmble. Passwords are not imported.
                </p>
                <div className="onboarding-identity-list">
                  {mumbleServers.map((srv, i) => (
                    <button
                      key={i}
                      className={`onboarding-identity-card${selectedServers.has(i) ? ' selected' : ''}`}
                      onClick={() => setSelectedServers(prev => {
                        const next = new Set(prev);
                        next.has(i) ? next.delete(i) : next.add(i);
                        return next;
                      })}
                    >
                      <span className="onboarding-identity-card-icon">🖥️</span>
                      <div className="onboarding-identity-card-body">
                        <div className="onboarding-identity-card-name">
                          {srv.label || srv.host}
                        </div>
                        <div className="onboarding-identity-card-meta">
                          {srv.host}:{srv.port}
                          {srv.username ? ` · ${srv.username}` : ''}
                        </div>
                      </div>
                      {srv.alreadySaved && !selectedServers.has(i)
                        ? <span className="onboarding-identity-badge saved">Already saved</span>
                        : selectedServers.has(i)
                          ? <span className="onboarding-identity-badge brmble">Import</span>
                          : null
                      }
                    </button>
                  ))}
                </div>
                <div className="onboarding-actions">
                  <button className="onboarding-skip-link" onClick={() => onComplete(fingerprint)}>
                    Skip
                  </button>
                  <button className="btn btn-ghost" onClick={() => setStep('connection')}>Back</button>
                  <button
                    className="btn btn-primary"
                    disabled={serversImportBusy}
                    onClick={() => {
                      if (selectedServers.size === 0) { onComplete(fingerprint); return; }
                      setServersImportBusy(true);
                      const toImport = [...selectedServers].map(i => mumbleServers[i]);
                      bridge.send('mumble.importServers', { servers: toImport });
                    }}
                  >
                    {serversImportBusy
                      ? 'Importing…'
                      : selectedServers.size === 0
                        ? 'Finish (skip import)'
                        : `Import ${selectedServers.size} server${selectedServers.size > 1 ? 's' : ''}`}
                  </button>
                </div>
              </>
            )}
          </>
        )}

      </div>
    </div>
  );
}
