# Onboarding Wizard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `CertWizard` with a full 6-step onboarding wizard that auto-detects Mumble/Brmble certificates, always prompts for backup export, and surfaces Interface/Audio/Connection preferences before first use.

**Architecture:** A new `OnboardingWizard` component replaces `CertWizard` in-place — same render location in `App.tsx`, same `onComplete` callback signature. The C# backend gets one new bridge message (`mumble.detectCerts` / `mumble.detectedCerts`) implemented in `CertificateService.cs`. Settings controls in preference steps are used directly (not extracted) via a thin wrapper component for the key-capture widget.

**Tech Stack:** React + TypeScript (frontend), C# / .NET (backend bridge), WebView2 message transport, Windows Registry API, System.Text.Json

---

## File Map

### New files
- `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx` — main wizard component (replaces CertWizard)
- `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.css` — wizard styles (based on CertWizard.css patterns)
- `src/Brmble.Web/src/components/OnboardingWizard/PttKeyCapture.tsx` — thin wrapper around the PTT key-binding button, self-contained (handles suspend/resume hotkeys, mousedown, keydown)

### Modified files
- `src/Brmble.Client/Services/Certificate/CertificateService.cs` — add `HandleMumbleDetectCerts` method and register `mumble.detectCerts` handler
- `src/Brmble.Web/src/App.tsx` — swap `CertWizard` import/render for `OnboardingWizard`; add "Reopen setup wizard" trigger in settings area

### Deleted / replaced
- `src/Brmble.Web/src/components/CertWizard/CertWizard.tsx` — replaced by OnboardingWizard (delete after Task 9)
- `src/Brmble.Web/src/components/CertWizard/CertWizard.css` — replaced (delete after Task 9)

---

## Task 1: C# — `mumble.detectCerts` bridge handler

**Files:**
- Modify: `src/Brmble.Client/Services/Certificate/CertificateService.cs`

Add the handler that scans for a Mumble certificate in three locations and responds with `mumble.detectedCerts`.

- [ ] **Step 1: Add usings at top of CertificateService.cs**

Open `src/Brmble.Client/Services/Certificate/CertificateService.cs`. After the existing `using` block at the top, add:

```csharp
using Microsoft.Win32;
using System.Text.Json;
using System.Security.Cryptography;
```

- [ ] **Step 2: Add the `HandleMumbleDetectCerts` method to `CertificateService`**

Add this method inside the `CertificateService` class, after the last existing handler method (before the closing `}`):

```csharp
private void HandleMumbleDetectCerts(JsonElement _)
{
    var certs = new List<object>();

    try
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

        // Priority 1: Mumble 1.5.x — %LOCALAPPDATA%\Mumble\Mumble\mumble_settings.json
        // Priority 2: Mumble 1.5.x pre-migration — %APPDATA%\Mumble\mumble_settings.json
        var jsonPaths = new[]
        {
            Path.Combine(localAppData, "Mumble", "Mumble", "mumble_settings.json"),
            Path.Combine(appData, "Mumble", "mumble_settings.json"),
        };

        byte[]? certBytes = null;

        foreach (var jsonPath in jsonPaths)
        {
            if (!File.Exists(jsonPath)) continue;
            try
            {
                var json = File.ReadAllText(jsonPath);
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("certificate", out var certEl))
                {
                    var b64 = certEl.GetString();
                    if (!string.IsNullOrEmpty(b64))
                    {
                        certBytes = Convert.FromBase64String(b64);
                        break;
                    }
                }
            }
            catch { /* malformed JSON or missing field — skip */ }
        }

        // Priority 3: Mumble 1.4.x — registry HKCU\Software\Mumble\Mumble, value "net/certificate"
        if (certBytes == null)
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\Mumble\Mumble");
                if (key?.GetValue("net/certificate") is byte[] rawBytes && rawBytes.Length > 0)
                    certBytes = rawBytes;
            }
            catch { /* registry access denied or key missing — skip */ }
        }

        if (certBytes != null)
        {
            try
            {
                using var cert = X509CertificateLoader.LoadPkcs12(certBytes, password: null,
                    X509KeyStorageFlags.EphemeralKeySet);

                // Extract CN from Subject (e.g. "CN=Alice" → "Alice")
                var subject = cert.Subject ?? "";
                var cn = subject;
                var cnPrefix = "CN=";
                var cnIndex = subject.IndexOf(cnPrefix, StringComparison.OrdinalIgnoreCase);
                if (cnIndex >= 0)
                {
                    cn = subject[(cnIndex + cnPrefix.Length)..];
                    var commaIdx = cn.IndexOf(',');
                    if (commaIdx >= 0) cn = cn[..commaIdx];
                    cn = cn.Trim();
                }

                // Compute SHA-256 fingerprint, colon-separated
                var hashBytes = cert.GetCertHash(HashAlgorithmName.SHA256);
                var fingerprint = string.Join(":", hashBytes.Select(b => b.ToString("X2")));

                certs.Add(new
                {
                    source = "mumble",
                    name = cn,
                    fingerprint,
                    data = Convert.ToBase64String(certBytes),
                });
            }
            catch { /* corrupt cert bytes — skip */ }
        }
    }
    catch { /* outer catch: send empty list, wizard continues without Mumble option */ }

    _bridge.SendToRenderer("mumble.detectedCerts", new { certs });
}
```

- [ ] **Step 3: Register the handler in the `Register` method**

Find the `Register` method (or equivalent `HandleMessage` switch/dictionary) in `CertificateService.cs` where other `cert.*` and `profiles.*` messages are registered. Add:

```csharp
case "mumble.detectCerts":
    HandleMumbleDetectCerts(data);
    break;
```

If the service uses a dictionary of action strings → delegates, add:

```csharp
{ "mumble.detectCerts", HandleMumbleDetectCerts },
```

- [ ] **Step 4: Build the C# project to verify no compile errors**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded with 0 errors. Warnings about existing issues in `MumbleAdapter.cs` are pre-existing and acceptable.

- [ ] **Step 5: Commit**

```bash
git checkout -b feature/onboarding-wizard-redesign
git add src/Brmble.Client/Services/Certificate/CertificateService.cs
git commit -m "feat: add mumble.detectCerts bridge handler for Mumble cert auto-detection"
```

---

## Task 2: Frontend — `PttKeyCapture` component

**Files:**
- Create: `src/Brmble.Web/src/components/OnboardingWizard/PttKeyCapture.tsx`

A self-contained PTT key-capture button. Handles suspend/resume hotkeys and accepts a key string as value. Reused in the Audio step of the wizard.

- [ ] **Step 1: Create the component**

Create `src/Brmble.Web/src/components/OnboardingWizard/PttKeyCapture.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import bridge from '../../bridge';

interface PttKeyCaptureProps {
  value: string | null;
  onChange: (key: string | null) => void;
}

export function PttKeyCapture({ value, onChange }: PttKeyCaptureProps) {
  const [recording, setRecording] = useState(false);

  const handleInput = useCallback((key: string) => {
    onChange(key);
    setRecording(false);
  }, [onChange]);

  useEffect(() => {
    if (!recording) return;

    bridge.send('voice.suspendHotkeys');

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      handleInput(e.code);
    };
    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      const map: Record<number, string> = {
        0: 'MouseLeft', 1: 'MouseMiddle', 2: 'MouseRight',
        3: 'XButton1', 4: 'XButton2',
      };
      const key = map[e.button];
      if (key) handleInput(key);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onMouseDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onMouseDown);
      bridge.send('voice.resumeHotkeys');
    };
  }, [recording, handleInput]);

  return (
    <button
      type="button"
      className={`btn btn-secondary key-binding-btn${recording ? ' recording' : ''}`}
      onClick={() => setRecording(r => !r)}
    >
      {recording ? 'Press any key…' : (value ?? 'Not bound')}
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/OnboardingWizard/PttKeyCapture.tsx
git commit -m "feat: add PttKeyCapture component for onboarding wizard audio step"
```

---

## Task 3: Frontend — `OnboardingWizard.css`

**Files:**
- Create: `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.css`

Base CSS for the wizard. Extends the patterns from `CertWizard.css` and adds new selectors for the identity card list and preference steps.

- [ ] **Step 1: Create the stylesheet**

Create `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.css`:

```css
/* ── Overlay & panel ─────────────────────────────────────────────── */
.onboarding-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  overflow-y: auto;
  padding: var(--space-xl) 0;
}

.onboarding-panel {
  width: 100%;
  max-width: 520px;
  padding: var(--space-xl);
  animation: slideUp var(--animation-normal) ease backwards;
}

/* ── Progress dots ───────────────────────────────────────────────── */
.onboarding-dots {
  display: flex;
  gap: var(--space-2xs);
  margin-bottom: var(--space-xl);
}

.onboarding-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--border-subtle);
  transition: background var(--transition-normal);
}

.onboarding-dot.active {
  background: var(--accent-primary);
}

/* ── Common step elements ────────────────────────────────────────── */
.onboarding-icon {
  font-size: var(--text-4xl);
  margin-bottom: var(--space-md);
}

.onboarding-title {
  margin: 0 0 var(--space-sm);
}

.onboarding-body {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 var(--space-xl);
}

.onboarding-actions {
  display: flex;
  gap: var(--space-sm);
  justify-content: flex-end;
  align-items: center;
  margin-top: var(--space-xl);
}

.onboarding-skip-link {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  margin-right: auto;
}

.onboarding-skip-link:hover {
  color: var(--text-secondary);
}

/* ── Step 2: Identity cards ──────────────────────────────────────── */
.onboarding-identity-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-bottom: var(--space-xl);
}

.onboarding-identity-group-label {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: var(--space-sm) 0 var(--space-xs);
}

.onboarding-identity-card {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg);
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  transition: all var(--transition-fast);
  color: var(--text-primary);
  width: 100%;
}

.onboarding-identity-card:hover:not(:disabled) {
  border-color: var(--accent-primary);
  background: var(--bg-hover);
}

.onboarding-identity-card.selected {
  border-color: var(--accent-primary);
  background: var(--bg-hover);
}

.onboarding-identity-card-icon {
  font-size: var(--text-2xl);
  flex-shrink: 0;
}

.onboarding-identity-card-body {
  flex: 1;
  min-width: 0;
}

.onboarding-identity-card-name {
  font-size: var(--text-sm);
  font-weight: 500;
  margin-bottom: 2px;
}

.onboarding-identity-card-meta {
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.onboarding-identity-card-desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: 2px;
}

.onboarding-identity-badge {
  font-size: var(--text-xs);
  font-weight: 600;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.onboarding-identity-badge.brmble {
  background: var(--accent-primary-subtle);
  color: var(--accent-primary-text);
}

.onboarding-identity-badge.mumble {
  background: var(--accent-success-subtle);
  color: var(--accent-success-text);
}

/* ── New identity inline form ────────────────────────────────────── */
.onboarding-new-identity-form {
  padding: var(--space-md) var(--space-lg);
  background: var(--bg-glass);
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-md);
}

.onboarding-new-identity-form label {
  display: block;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--space-xs);
}

.onboarding-new-identity-error {
  font-size: var(--text-xs);
  color: var(--accent-danger-text);
  margin-top: var(--space-xs);
}

/* ── Inline warning (new identity) ──────────────────────────────── */
.onboarding-inline-warning {
  background: var(--accent-danger-subtle);
  border: 1px solid var(--accent-danger-border);
  border-radius: var(--radius-md);
  padding: var(--space-lg);
  color: var(--accent-danger-text);
  font-size: var(--text-sm);
  line-height: 1.7;
  margin-bottom: var(--space-lg);
}

.onboarding-inline-warning strong {
  display: block;
  font-size: var(--text-base);
  margin-bottom: var(--space-xs);
  color: var(--accent-danger-strong);
}

.onboarding-ack {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
  cursor: pointer;
}

.onboarding-ack input[type="checkbox"] {
  margin-top: 2px;
  width: 16px;
  height: 16px;
  accent-color: var(--accent-primary);
  cursor: pointer;
  flex-shrink: 0;
}

.onboarding-ack span {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}

/* ── Step 3: Backup ──────────────────────────────────────────────── */
.onboarding-fingerprint {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
  word-break: break-all;
  background: var(--bg-glass);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  margin-bottom: var(--space-md);
}

.onboarding-backup-locations {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin: 0 0 var(--space-lg);
  padding-left: var(--space-lg);
  line-height: 1.8;
}

/* ── Steps 4–6: Preference sections ─────────────────────────────── */
.onboarding-pref-section {
  margin-bottom: var(--space-xl);
}

.onboarding-pref-section-title {
  margin: 0 0 var(--space-md);
}

.onboarding-pref-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) 0;
  border-bottom: 1px solid var(--border-subtle);
}

.onboarding-pref-item:last-child {
  border-bottom: none;
}

.onboarding-pref-item label {
  font-size: var(--text-sm);
  color: var(--text-primary);
  flex: 1;
}

.onboarding-pref-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: var(--space-sm);
  line-height: 1.5;
}

/* ── Transmission mode radio cards ──────────────────────────────── */
.onboarding-tx-cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin-top: var(--space-sm);
}

.onboarding-tx-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  transition: all var(--transition-fast);
  color: var(--text-primary);
  width: 100%;
}

.onboarding-tx-card.selected {
  border-color: var(--accent-primary);
  background: var(--bg-hover);
}

.onboarding-tx-card:hover:not(.selected) {
  border-color: var(--border-default);
}

.onboarding-tx-card-label {
  font-size: var(--text-sm);
  font-weight: 500;
}

.onboarding-tx-card-desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: 2px;
}

/* ── Spinner (used while waiting for detectedCerts) ──────────────── */
.onboarding-detecting {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--text-muted);
  font-size: var(--text-sm);
  margin-bottom: var(--space-xl);
}

.onboarding-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-subtle);
  border-top-color: var(--accent-primary);
  border-radius: var(--radius-full);
  animation: spin var(--animation-spin) linear infinite;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.css
git commit -m "feat: add OnboardingWizard stylesheet"
```

---

## Task 4: Frontend — `OnboardingWizard.tsx` — skeleton + Step 1 (Welcome)

**Files:**
- Create: `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx`

Build the wizard shell with step routing, progress dots, and the Welcome step.

- [ ] **Step 1: Create the file with type definitions and the Welcome step**

Create `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx`:

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import bridge from '../../bridge';
import { validateProfileName } from '../../utils/profileValidation';
import { Select } from '../Select';
import { PttKeyCapture } from './PttKeyCapture';
import { themes } from '../../themes/theme-registry';
import { applyTheme } from '../../themes/theme-loader';
import './OnboardingWizard.css';

// ── Types ─────────────────────────────────────────────────────────

type WizardStep = 'welcome' | 'identity' | 'backup' | 'interface' | 'audio' | 'connection';

const STEPS: WizardStep[] = ['welcome', 'identity', 'backup', 'interface', 'audio', 'connection'];

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

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<WizardStep>('welcome');
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
  const [nameError, setNameError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [identityError, setIdentityError] = useState('');

  // Backup step state
  const [fingerprint, setFingerprint] = useState('');
  const [exportError, setExportError] = useState('');

  // Preferences state
  const [settings, setSettings] = useState<WizardSettings>(loadInitialSettings);

  // Listen for bridge events
  useEffect(() => {
    const onProfilesList = (data: unknown) => {
      const d = data as { profiles?: BrmbleProfile[] } | undefined;
      setBrmbleProfiles(d?.profiles ?? []);
    };
    const onDetectedCerts = (data: unknown) => {
      const d = data as { certs?: DetectedCert[] } | undefined;
      setMumbleCerts(d?.certs ?? []);
      setDetecting(false);
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
        setStep('backup');
      } else {
        setStep('backup');
      }
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

    bridge.on('profiles.list', onProfilesList);
    bridge.on('mumble.detectedCerts', onDetectedCerts);
    bridge.on('profiles.added', onProfileAdded);
    bridge.on('profiles.activeChanged', onActiveChanged);
    bridge.on('profiles.error', onProfilesError);
    bridge.on('cert.exportData', onExportData);
    bridge.on('cert.error', onCertError);

    // Request current profiles list immediately
    bridge.send('profiles.list');

    return () => {
      bridge.off('profiles.list', onProfilesList);
      bridge.off('mumble.detectedCerts', onDetectedCerts);
      bridge.off('profiles.added', onProfileAdded);
      bridge.off('profiles.activeChanged', onActiveChanged);
      bridge.off('profiles.error', onProfilesError);
      bridge.off('cert.exportData', onExportData);
      bridge.off('cert.error', onCertError);
    };
  }, []);

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
      // Apply theme immediately
      if (patch.theme) applyTheme(patch.theme);
      return next;
    });
  }, [saveSettings]);

  // ── Step handlers ──────────────────────────────────────────────

  const handleGetStarted = () => {
    setDetecting(true);
    bridge.send('mumble.detectCerts');
    // 2-second timeout — advance to identity even if detectedCerts doesn't arrive
    setTimeout(() => {
      setDetecting(false);
      setStep('identity');
    }, 2000);
  };

  // Effect: advance to identity when detection completes (before timeout)
  const detectionDoneRef = useRef(false);
  useEffect(() => {
    if (!detecting) return;
    detectionDoneRef.current = false;
  }, [detecting]);

  useEffect(() => {
    if (step === 'welcome') return;
  }, [step]);

  // When detectedCerts arrives, advance to identity immediately if we're still on welcome
  useEffect(() => {
    if (step === 'welcome' && detecting === false && detectionDoneRef.current === false) {
      // detecting was set to false by the event handler — advance
    }
  }, [detecting, step]);

  // Simpler: use an explicit "readyForIdentity" flag
  const [readyForIdentity, setReadyForIdentity] = useState(false);
  useEffect(() => {
    if (readyForIdentity && step === 'welcome') {
      setStep('identity');
      setReadyForIdentity(false);
    }
  }, [readyForIdentity, step]);

  // Rewrite the detectedCerts listener to trigger navigation
  // This replaces the one set up in the main useEffect — we use a ref approach
  const setMumbleCertsAndAdvance = useCallback((certs: DetectedCert[]) => {
    setMumbleCerts(certs);
    setDetecting(false);
    setReadyForIdentity(true);
  }, []);

  // Override the detectedCerts handler to also advance navigation
  useEffect(() => {
    const handler = (data: unknown) => {
      const d = data as { certs?: DetectedCert[] } | undefined;
      setMumbleCertsAndAdvance(d?.certs ?? []);
    };
    bridge.on('mumble.detectedCerts', handler);
    return () => bridge.off('mumble.detectedCerts', handler);
  }, [setMumbleCertsAndAdvance]);

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
      // 'new' — profiles.add triggers onProfileAdded listener which advances
      bridge.send('profiles.add', { name: newName.trim() });
    }
  };

  // Derived: all known names (for uniqueness check)
  const takenNames = [
    ...brmbleProfiles.map(p => p.name.toLowerCase()),
    ...mumbleCerts.map(c => c.name.toLowerCase()),
  ];

  const newNameValidation = (() => {
    if (!newName.trim()) return null; // no input yet, no error shown
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
              <button className="btn btn-primary" onClick={handleGetStarted}>
                Get Started
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Identity ── (rendered in Task 5) */}
        {/* ── Step 3: Backup ── (rendered in Task 6) */}
        {/* ── Steps 4–6: Preferences ── (rendered in Task 7) */}

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the TypeScript compiles (no build errors)**

```bash
cd src/Brmble.Web && npx tsc --noEmit
```

Expected: 0 errors (warnings acceptable).

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx
git commit -m "feat: add OnboardingWizard skeleton with Welcome step and detection logic"
```

---

## Task 5: Frontend — Identity step (Step 2)

**Files:**
- Modify: `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx`

Add the identity picker rendering inside the `{step === 'identity' && ...}` block.

- [ ] **Step 1: Add the identity step JSX inside the panel div, after the Welcome block**

Find the comment `{/* ── Step 2: Identity ── (rendered in Task 5) */}` and replace it with:

```tsx
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
                  onChange={e => {
                    setNewName(e.target.value);
                    setNameError('');
                  }}
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd src/Brmble.Web && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx
git commit -m "feat: add identity picker step to OnboardingWizard"
```

---

## Task 6: Frontend — Backup step (Step 3)

**Files:**
- Modify: `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx`

- [ ] **Step 1: Replace the backup step comment with the JSX**

Find `{/* ── Step 3: Backup ── (rendered in Task 6) */}` and replace with:

```tsx
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
                  // Advance after triggering export — the download fires via onExportData listener
                  setStep('interface');
                }}
              >
                Export &amp; Continue
              </button>
            </div>
          </>
        )}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd src/Brmble.Web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx
git commit -m "feat: add backup step to OnboardingWizard"
```

---

## Task 7: Frontend — Preference steps (Steps 4, 5, 6)

**Files:**
- Modify: `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx`

- [ ] **Step 1: Replace the preferences comment with Steps 4, 5, and 6 JSX**

Find `{/* ── Steps 4–6: Preferences ── (rendered in Task 7) */}` and replace with:

```tsx
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
                onClick={() => onComplete(fingerprint)}
              >
                Finish
              </button>
            </div>
          </>
        )}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd src/Brmble.Web && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx
git commit -m "feat: add Interface, Audio, Connection preference steps to OnboardingWizard"
```

---

## Task 8: Wire `OnboardingWizard` into `App.tsx`

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

Swap the `CertWizard` import and render for `OnboardingWizard`. Also add a "Reopen setup wizard" button in the Settings area.

- [ ] **Step 1: Replace the CertWizard import**

In `src/Brmble.Web/src/App.tsx`, find:

```tsx
import { CertWizard } from './components/CertWizard/CertWizard';
```

Replace with:

```tsx
import { OnboardingWizard } from './components/OnboardingWizard/OnboardingWizard';
```

- [ ] **Step 2: Replace the CertWizard render**

Find:

```tsx
{certExists === false && (
  <CertWizard onComplete={(fp) => { setCertExists(true); setCertFingerprint(fp); }} />
)}
```

Replace with:

```tsx
{certExists === false && (
  <OnboardingWizard onComplete={(fp) => { setCertExists(true); setCertFingerprint(fp); }} />
)}
```

- [ ] **Step 3: Add a state variable and trigger for reopening the wizard from settings**

After the existing `const [certExists, setCertExists] = useState<boolean | null>(null);` line, add:

```tsx
const [showPrefsWizard, setShowPrefsWizard] = useState(false);
```

Then find the place where `<SettingsModal>` is rendered and add this overlay immediately after it (or after the `CertWizard` block):

```tsx
{showPrefsWizard && certExists === true && (
  <OnboardingWizard
    startAtPreferences
    onComplete={() => setShowPrefsWizard(false)}
  />
)}
```

- [ ] **Step 4: Add `startAtPreferences` prop to `OnboardingWizard`**

Open `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx`.

Update the `OnboardingWizardProps` interface:

```tsx
interface OnboardingWizardProps {
  onComplete: (fingerprint: string) => void;
  startAtPreferences?: boolean;
}
```

Update the component signature:

```tsx
export function OnboardingWizard({ onComplete, startAtPreferences }: OnboardingWizardProps) {
```

Update the initial `step` state:

```tsx
const [step, setStep] = useState<WizardStep>(startAtPreferences ? 'interface' : 'welcome');
```

- [ ] **Step 5: Pass `setShowPrefsWizard` into SettingsModal or wherever the "Reopen wizard" button will live**

Find the `<SettingsModal>` render in `App.tsx`. Add a prop (or inline footer button) to expose the reopen trigger. The simplest approach is to add a button inside the SettingsModal's profile tab or footer — but since we don't want to modify SettingsModal internals in this task, add a standalone button in the app's sidebar/topbar area. Find the sidebar render area and add:

```tsx
<button
  className="btn btn-ghost"
  style={{ fontSize: 'var(--text-xs)', marginTop: 'auto' }}
  onClick={() => setShowPrefsWizard(true)}
>
  Setup wizard
</button>
```

The exact placement depends on the sidebar structure — place it at the bottom of the sidebar or in an existing settings menu area.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd src/Brmble.Web && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx
git commit -m "feat: wire OnboardingWizard into App.tsx, replace CertWizard, add reopen trigger"
```

---

## Task 9: Delete old CertWizard files

**Files:**
- Delete: `src/Brmble.Web/src/components/CertWizard/CertWizard.tsx`
- Delete: `src/Brmble.Web/src/components/CertWizard/CertWizard.css`

- [ ] **Step 1: Verify nothing still imports CertWizard**

```bash
cd src/Brmble.Web && npx tsc --noEmit
```

Also check:

```bash
grep -r "CertWizard" src/Brmble.Web/src/
```

Expected: 0 matches (the import was replaced in Task 8).

- [ ] **Step 2: Delete the files**

```bash
git rm src/Brmble.Web/src/components/CertWizard/CertWizard.tsx
git rm src/Brmble.Web/src/components/CertWizard/CertWizard.css
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: remove CertWizard — replaced by OnboardingWizard"
```

---

## Task 10: Manual smoke test

No automated tests exist for the wizard UI. The following manual checks cover all spec-required scenarios.

- [ ] **Step 1: Test — fresh install (no Brmble profiles, no Mumble)**

Launch the client with no `config.json` (or delete existing profiles from config). Verify:
- Welcome step renders with correct copy
- "Get Started" triggers detection spinner
- Identity step shows only the "Create new identity" card (no Brmble or Mumble groups)
- Typing an invalid name shows validation error
- Checking the acknowledgment checkbox enables "Continue"
- Continuing calls `profiles.add` and advances to Backup step
- Fingerprint displays on Backup step
- "Export & Continue" downloads a `.pfx` file and advances to Interface
- "Skip (Not Recommended)" advances to Interface without download
- Interface, Audio, Connection steps each render correct settings
- "Finish" closes wizard and main app renders normally

- [ ] **Step 2: Test — existing Brmble profile**

With at least one profile in config, delete the `activeProfileId` so the wizard triggers. Verify:
- Identity step shows the Brmble profile card with name and fingerprint snippet
- Selecting it and clicking Continue calls `profiles.setActive` and advances to Backup
- Backup step displays (always shown)

- [ ] **Step 3: Test — Mumble certificate present**

Copy a valid Mumble `.pfx` into a test `mumble_settings.json` at `%LOCALAPPDATA%\Mumble\Mumble\mumble_settings.json` with a `"certificate"` key. Verify:
- Detection finds the cert and shows a Mumble card with the CN name
- Selecting it and clicking Continue calls `profiles.import` and advances to Backup

- [ ] **Step 4: Test — reopen wizard from settings**

With a profile active, click "Setup wizard" button. Verify:
- Wizard opens at Interface step (step 4)
- Progress dots 1–3 are already active
- Back from Interface has no destination (or goes to Backup — adjust if needed)
- Finish closes the wizard overlay

- [ ] **Step 5: Build frontend for production**

```bash
cd src/Brmble.Web && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit smoke test sign-off note**

```bash
git commit --allow-empty -m "test: onboarding wizard manual smoke test passed"
```

---

---

## Task 11: C# — Mumble server import from `mumble.sqlite`

**Files:**
- Modify: `src/Brmble.Client/Brmble.Client.csproj` — add `Microsoft.Data.Sqlite` package reference
- Modify: `src/Brmble.Client/Services/Serverlist/ServerlistService.cs` — add `mumble.importServers` handler

Reads the Mumble server favourites from `%LOCALAPPDATA%\Mumble\Mumble\mumble.sqlite`, table `servers`, and adds any entries not already in the Brmble server list.

- [ ] **Step 1: Add `Microsoft.Data.Sqlite` NuGet reference**

Open `src/Brmble.Client/Brmble.Client.csproj`. Find the `<ItemGroup>` that contains other `<PackageReference>` entries (or add one if none exists). Add:

```xml
<PackageReference Include="Microsoft.Data.Sqlite" Version="10.0.5" />
```

Then restore:

```bash
dotnet restore src/Brmble.Client/Brmble.Client.csproj
```

- [ ] **Step 2: Add `mumble.detectServers` handler to `ServerlistService.cs`**

Open `src/Brmble.Client/Services/Serverlist/ServerlistService.cs`. Add the following using at the top (after the existing usings):

```csharp
using Microsoft.Data.Sqlite;
```

Then add a new method `HandleMumbleDetectServers` in the class body, after `RemoveServer`:

```csharp
private List<object> DetectMumbleServers()
{
    var result = new List<object>();
    try
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var dbPath = Path.Combine(localAppData, "Mumble", "Mumble", "mumble.sqlite");
        if (!File.Exists(dbPath)) return result;

        var connStr = new SqliteConnectionStringBuilder
        {
            DataSource = dbPath,
            Mode = SqliteOpenMode.ReadOnly,
        }.ToString();

        using var conn = new SqliteConnection(connStr);
        conn.Open();

        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT name, hostname, port, username FROM servers ORDER BY id";

        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            result.Add(new
            {
                label    = reader.IsDBNull(0) ? "" : reader.GetString(0),
                host     = reader.IsDBNull(1) ? "" : reader.GetString(1),
                port     = reader.IsDBNull(2) ? 64738 : reader.GetInt32(2),
                username = reader.IsDBNull(3) ? "" : reader.GetString(3),
            });
        }
    }
    catch { /* db locked, missing, or corrupt — return empty */ }
    return result;
}
```

- [ ] **Step 3: Register a new bridge handler `mumble.detectServers`**

In the `RegisterHandlers` method of `ServerlistService`, after the last existing handler registration, add:

```csharp
bridge.RegisterHandler("mumble.detectServers", async _ =>
{
    var servers = DetectMumbleServers();
    bridge.Send("mumble.detectedServers", new { servers });
    await Task.CompletedTask;
});
```

Also add a handler for bulk-importing the user's chosen servers:

```csharp
bridge.RegisterHandler("mumble.importServers", async data =>
{
    // data.servers: array of { label, host, port, username }
    if (!data.TryGetProperty("servers", out var serversEl)) return;
    var added = new List<ServerEntry>();
    foreach (var s in serversEl.EnumerateArray())
    {
        var label = s.TryGetProperty("label", out var lEl) ? lEl.GetString() ?? "" : "";
        var host  = s.TryGetProperty("host",  out var hEl) ? hEl.GetString() ?? "" : "";
        var port  = s.TryGetProperty("port",  out var pEl) && pEl.ValueKind == JsonValueKind.Number
                    ? (int?)pEl.GetInt32() : null;
        if (string.IsNullOrWhiteSpace(host)) continue;
        var entry = new ServerEntry(
            Guid.NewGuid().ToString(),
            string.IsNullOrEmpty(label) ? host : label,
            null, // no Brmble API URL — it's a plain Mumble server
            host,
            port,
            ""    // password intentionally omitted for security
        );
        AddServer(entry);
        added.Add(entry);
    }
    bridge.Send("mumble.serversImported", new { servers = added });
    await Task.CompletedTask;
});
```

- [ ] **Step 4: Build to verify no compile errors**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded with 0 errors.

- [ ] **Step 5: Add frontend server import step to OnboardingWizard**

This step adds a 7th wizard step **"Import Servers"** inserted between Connection (step 6) and the Finish action. The step only renders if Mumble servers were detected.

**5a — Update `WizardStep` type and `STEPS` array in `OnboardingWizard.tsx`:**

Find:
```tsx
type WizardStep = 'welcome' | 'identity' | 'backup' | 'interface' | 'audio' | 'connection';
const STEPS: WizardStep[] = ['welcome', 'identity', 'backup', 'interface', 'audio', 'connection'];
```

Replace with:
```tsx
type WizardStep = 'welcome' | 'identity' | 'backup' | 'interface' | 'audio' | 'connection' | 'servers';
const STEPS: WizardStep[] = ['welcome', 'identity', 'backup', 'interface', 'audio', 'connection', 'servers'];
```

**5b — Add state for detected/selected servers in `OnboardingWizard`:**

After the existing `const [settings, setSettings] = useState<WizardSettings>(loadInitialSettings);` line, add:

```tsx
// Server import step state
interface MumbleServer { label: string; host: string; port: number; username: string; }
const [mumbleServers, setMumbleServers] = useState<MumbleServer[]>([]);
const [selectedServers, setSelectedServers] = useState<Set<number>>(new Set());
const [serversImportBusy, setServersImportBusy] = useState(false);
```

**5c — Register bridge listeners for `mumble.detectedServers` and `mumble.serversImported`:**

Inside the main `useEffect` listener block (where other `bridge.on` calls are), add:

```tsx
const onDetectedServers = (data: unknown) => {
  const d = data as { servers?: MumbleServer[] } | undefined;
  const svrs = d?.servers ?? [];
  setMumbleServers(svrs);
  // Pre-select all by default
  setSelectedServers(new Set(svrs.map((_, i) => i)));
};
const onServersImported = () => {
  setServersImportBusy(false);
  onComplete(fingerprint);
};

bridge.on('mumble.detectedServers', onDetectedServers);
bridge.on('mumble.serversImported', onServersImported);
```

And in the cleanup return, add:
```tsx
bridge.off('mumble.detectedServers', onDetectedServers);
bridge.off('mumble.serversImported', onServersImported);
```

**5d — Trigger `mumble.detectServers` when the connection step completes:**

Find the "Finish" button in the connection step:

```tsx
<button
  className="btn btn-primary"
  onClick={() => onComplete(fingerprint)}
>
  Finish
</button>
```

Replace with:

```tsx
<button
  className="btn btn-primary"
  onClick={() => {
    bridge.send('mumble.detectServers');
    setStep('servers');
  }}
>
  Next
</button>
```

**5e — Add the servers step JSX, after the connection step block:**

```tsx
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
              {selectedServers.has(i) && (
                <span className="onboarding-identity-badge brmble">Import</span>
              )}
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
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd src/Brmble.Web && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Client/Brmble.Client.csproj
git add src/Brmble.Client/Services/Serverlist/ServerlistService.cs
git add src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx
git commit -m "feat: add Mumble server import step to onboarding wizard"
```

---

## Self-review vs Spec

| Spec requirement | Covered by task |
|---|---|
| 6 steps: Welcome, Identity, Backup, Interface, Audio, Connection | Tasks 4–7 |
| Mumble cert detection (3 paths) | Task 1 |
| Brmble existing profiles shown | Task 5 (brmbleProfiles from profiles.list) |
| Detect-first, advance after 2s timeout | Task 4 (handleGetStarted) |
| CN extracted for Mumble card name | Task 1 |
| Inline warning + ack for new identity | Task 5 |
| Backup step always shown | Task 6 |
| Export downloads .pfx | Task 6 (triggerBlobDownload via cert.exportData) |
| Suggested backup locations listed | Task 6 |
| Interface: theme picker + Brmblegotchi toggle | Task 7 |
| Audio: devices, transmission mode cards, PTT key, noise suppression | Task 7 |
| Connection: reconnect, rejoin, auto-connect | Task 7 |
| Settings saved live via settings.set | Task 7 (updateSettings) |
| Reopenable from Settings (starts at Interface) | Task 8 (startAtPreferences prop) |
| Old CertWizard removed | Task 9 |
| Error states shown inline | Tasks 4, 5, 6 |
| Mumble server import from mumble.sqlite | Task 11 |
| Microsoft.Data.Sqlite NuGet dependency | Task 11 |
