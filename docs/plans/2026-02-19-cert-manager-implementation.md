# Certificate Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement X.509 client certificate lifecycle — generation, import, export, and Mumble TLS integration — with a 5-step first-launch wizard in React and an Identity tab in Settings.

**Architecture:** `CertificateService` (new `IService`) handles all cert operations in C# and emits bridge messages. React renders a `CertWizard` (5-step) on first launch and an `IdentitySettingsTab` in Settings. `MumbleAdapter` reads the active cert via constructor injection.

**Tech Stack:** .NET 10 `CertificateRequest` (built-in), `comdlg32.dll` P/Invoke for file dialogs, React + TypeScript, bridge message protocol.

---

## Task 1: CertificateService skeleton + startup status

**Files:**
- Create: `src/Brmble.Client/Services/Certificate/CertificateService.cs`
- Modify: `src/Brmble.Client/Program.cs`

### Step 1: Create the service file

```csharp
// src/Brmble.Client/Services/Certificate/CertificateService.cs
using System.Security.Cryptography.X509Certificates;
using Brmble.Client.Bridge;

namespace Brmble.Client.Services.Certificate;

internal sealed class CertificateService : IService
{
    public string ServiceName => "cert";

    public X509Certificate2? ActiveCertificate { get; private set; }

    private readonly NativeBridge _bridge;

    private static string CertPath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Brmble",
            "identity.pfx");

    public CertificateService(NativeBridge bridge)
    {
        _bridge = bridge;
    }

    public void Initialize(NativeBridge bridge) { }

    public void RegisterHandlers(NativeBridge bridge)
    {
        bridge.RegisterHandler("cert.requestStatus", _ =>
        {
            SendStatus();
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("cert.generate", data =>
        {
            var subject = data.TryGetProperty("subject", out var s) ? s.GetString() ?? "Brmble User" : "Brmble User";
            Task.Run(() => GenerateCertificate(subject));
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("cert.import", _ =>
        {
            Task.Run(ImportCertificate);
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("cert.export", _ =>
        {
            Task.Run(ExportCertificate);
            return Task.CompletedTask;
        });
    }

    private void SendStatus()
    {
        if (File.Exists(CertPath))
        {
            try
            {
                ActiveCertificate = new X509Certificate2(CertPath);
                _bridge.Send("cert.status", new
                {
                    exists = true,
                    fingerprint = ActiveCertificate.Thumbprint,
                    subject = ActiveCertificate.Subject
                });
                return;
            }
            catch { /* fall through to exists=false */ }
        }

        _bridge.Send("cert.status", new { exists = false });
    }

    private void GenerateCertificate(string subject) { }   // Task 2
    private void ImportCertificate() { }                   // Task 4
    private void ExportCertificate() { }                   // Task 5
}
```

### Step 2: Register in Program.cs

In `Program.cs`, add the field and wire it up in `InitWebView2Async`. Add these changes:

```csharp
// Add field after _mumbleClient field:
private static CertificateService? _certService;

// Add using at top:
using Brmble.Client.Services.Certificate;
```

In `InitWebView2Async`, after `_bridge = new NativeBridge(...)` and **before** navigation:

```csharp
_certService = new CertificateService(_bridge);
_certService.RegisterHandlers(_bridge);
```

### Step 3: Build and verify

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded, 0 errors.

### Step 4: Commit

```bash
git add src/Brmble.Client/Services/Certificate/CertificateService.cs src/Brmble.Client/Program.cs
git commit -m "feat: scaffold CertificateService with status handler"
```

---

## Task 2: Certificate generation

**Files:**
- Modify: `src/Brmble.Client/Services/Certificate/CertificateService.cs`

### Step 1: Implement GenerateCertificate

Replace the `private void GenerateCertificate(string subject) { }` stub:

```csharp
private void GenerateCertificate(string subject)
{
    try
    {
        Directory.CreateDirectory(Path.GetDirectoryName(CertPath)!);

        using var ecdsa = System.Security.Cryptography.ECDsa.Create(
            System.Security.Cryptography.ECCurve.NamedCurves.nistP256);

        var req = new System.Security.Cryptography.X509Certificates.CertificateRequest(
            $"CN={subject}",
            ecdsa,
            System.Security.Cryptography.HashAlgorithmName.SHA256);

        var now = DateTimeOffset.UtcNow;
        using var cert = req.CreateSelfSigned(now, now.AddYears(100));

        // Export WITH private key (PFX = PKCS#12)
        var pfxBytes = cert.Export(X509ContentType.Pfx);
        File.WriteAllBytes(CertPath, pfxBytes);

        // Reload from file to get a clean X509Certificate2
        ActiveCertificate = new X509Certificate2(CertPath);

        _bridge.Send("cert.generated", new
        {
            fingerprint = ActiveCertificate.Thumbprint,
            subject = ActiveCertificate.Subject
        });
    }
    catch (Exception ex)
    {
        _bridge.Send("cert.error", new { message = $"Failed to generate certificate: {ex.Message}" });
    }
}
```

### Step 2: Build and verify

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded.

### Step 3: Commit

```bash
git add src/Brmble.Client/Services/Certificate/CertificateService.cs
git commit -m "feat: implement certificate generation (ECDSA P-256, 100yr, PFX)"
```

---

## Task 3: Win32 file dialog helper

**Files:**
- Create: `src/Brmble.Client/Services/Certificate/Win32FileDialog.cs`

The app is raw Win32 (no WinForms/WPF). This helper P/Invokes `comdlg32.dll` on a dedicated STA thread.

### Step 1: Create the helper

```csharp
// src/Brmble.Client/Services/Certificate/Win32FileDialog.cs
using System.Runtime.InteropServices;

namespace Brmble.Client.Services.Certificate;

internal static class Win32FileDialog
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct OPENFILENAME
    {
        public uint lStructSize;
        public IntPtr hwndOwner;
        public IntPtr hInstance;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpstrFilter;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpstrCustomFilter;
        public uint nMaxCustFilter;
        public uint nFilterIndex;
        public IntPtr lpstrFile;
        public uint nMaxFile;
        public IntPtr lpstrFileTitle;
        public uint nMaxFileTitle;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpstrInitialDir;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpstrTitle;
        public uint Flags;
        public short nFileOffset;
        public short nFileExtension;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpstrDefExt;
        public IntPtr lCustData;
        public IntPtr lpfnHook;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpTemplateName;
        public IntPtr pvReserved;
        public uint dwReserved;
        public uint FlagsEx;
    }

    [DllImport("comdlg32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetOpenFileName(ref OPENFILENAME ofn);

    [DllImport("comdlg32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetSaveFileName(ref OPENFILENAME ofn);

    private const uint OFN_FILEMUSTEXIST  = 0x1000;
    private const uint OFN_PATHMUSTEXIST  = 0x0800;
    private const uint OFN_OVERWRITEPROMPT = 0x0002;
    private const int  MAX_PATH           = 32768;

    /// <summary>
    /// Opens a Win32 file-open dialog. Returns the selected path, or null if cancelled.
    /// Filter format: "Display Name\0*.ext\0\0" (null-separated pairs, double-null terminated).
    /// </summary>
    public static string? OpenFile(string title, string filter, string defaultExt)
    {
        string? result = null;
        var thread = new Thread(() =>
        {
            IntPtr buf = Marshal.AllocHGlobal(MAX_PATH * sizeof(char));
            try
            {
                // Zero the buffer
                for (int i = 0; i < MAX_PATH * sizeof(char); i++)
                    Marshal.WriteByte(buf, i, 0);

                var ofn = new OPENFILENAME
                {
                    lStructSize    = (uint)Marshal.SizeOf<OPENFILENAME>(),
                    hwndOwner      = IntPtr.Zero,
                    lpstrFilter    = filter,
                    lpstrTitle     = title,
                    lpstrFile      = buf,
                    nMaxFile       = MAX_PATH,
                    lpstrDefExt    = defaultExt,
                    Flags          = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST,
                };
                if (GetOpenFileName(ref ofn))
                    result = Marshal.PtrToStringUni(buf);
            }
            finally
            {
                Marshal.FreeHGlobal(buf);
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        return result;
    }

    /// <summary>
    /// Opens a Win32 file-save dialog. Returns the chosen path, or null if cancelled.
    /// </summary>
    public static string? SaveFile(string title, string filter, string defaultExt, string? suggestedName = null)
    {
        string? result = null;
        var thread = new Thread(() =>
        {
            IntPtr buf = Marshal.AllocHGlobal(MAX_PATH * sizeof(char));
            try
            {
                // Zero, then write suggested name if provided
                for (int i = 0; i < MAX_PATH * sizeof(char); i++)
                    Marshal.WriteByte(buf, i, 0);

                if (suggestedName != null)
                {
                    var encoded = System.Text.Encoding.Unicode.GetBytes(suggestedName + '\0');
                    Marshal.Copy(encoded, 0, buf, Math.Min(encoded.Length, MAX_PATH * sizeof(char) - 2));
                }

                var ofn = new OPENFILENAME
                {
                    lStructSize  = (uint)Marshal.SizeOf<OPENFILENAME>(),
                    hwndOwner    = IntPtr.Zero,
                    lpstrFilter  = filter,
                    lpstrTitle   = title,
                    lpstrFile    = buf,
                    nMaxFile     = MAX_PATH,
                    lpstrDefExt  = defaultExt,
                    Flags        = OFN_OVERWRITEPROMPT,
                };
                if (GetSaveFileName(ref ofn))
                    result = Marshal.PtrToStringUni(buf);
            }
            finally
            {
                Marshal.FreeHGlobal(buf);
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        return result;
    }
}
```

### Step 2: Build

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded.

### Step 3: Commit

```bash
git add src/Brmble.Client/Services/Certificate/Win32FileDialog.cs
git commit -m "feat: add Win32 file dialog helper (comdlg32 P/Invoke, STA thread)"
```

---

## Task 4: Certificate import

**Files:**
- Modify: `src/Brmble.Client/Services/Certificate/CertificateService.cs`

### Step 1: Implement ImportCertificate

Replace `private void ImportCertificate() { }`:

```csharp
private void ImportCertificate()
{
    try
    {
        var path = Win32FileDialog.OpenFile(
            title: "Select Your Certificate",
            filter: "Certificate Files\0*.pfx;*.p12\0All Files\0*.*\0\0",
            defaultExt: "pfx");

        if (path == null) return; // user cancelled

        // Validate it loads before overwriting
        var testCert = new X509Certificate2(path);

        Directory.CreateDirectory(Path.GetDirectoryName(CertPath)!);
        File.Copy(path, CertPath, overwrite: true);
        ActiveCertificate = testCert;

        _bridge.Send("cert.imported", new
        {
            fingerprint = ActiveCertificate.Thumbprint,
            subject = ActiveCertificate.Subject
        });
    }
    catch (Exception ex)
    {
        _bridge.Send("cert.error", new { message = $"Failed to import certificate: {ex.Message}" });
    }
}
```

### Step 2: Build

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded.

### Step 3: Commit

```bash
git add src/Brmble.Client/Services/Certificate/CertificateService.cs
git commit -m "feat: implement certificate import with Win32 file dialog"
```

---

## Task 5: Certificate export

**Files:**
- Modify: `src/Brmble.Client/Services/Certificate/CertificateService.cs`

### Step 1: Implement ExportCertificate

Replace `private void ExportCertificate() { }`:

```csharp
private void ExportCertificate()
{
    try
    {
        if (!File.Exists(CertPath))
        {
            _bridge.Send("cert.error", new { message = "No certificate to export." });
            return;
        }

        var path = Win32FileDialog.SaveFile(
            title: "Export Your Certificate",
            filter: "Certificate Files\0*.pfx\0All Files\0*.*\0\0",
            defaultExt: "pfx",
            suggestedName: "brmble-identity.pfx");

        if (path == null) return; // user cancelled

        File.Copy(CertPath, path, overwrite: true);
        _bridge.Send("cert.exported", new { path });
    }
    catch (Exception ex)
    {
        _bridge.Send("cert.error", new { message = $"Failed to export certificate: {ex.Message}" });
    }
}
```

### Step 2: Build

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded.

### Step 3: Commit

```bash
git add src/Brmble.Client/Services/Certificate/CertificateService.cs
git commit -m "feat: implement certificate export with Win32 save dialog"
```

---

## Task 6: MumbleAdapter certificate integration

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `src/Brmble.Client/Program.cs`

`MumbleSharp`'s `BasicMumbleProtocol` has a virtual `SelectCertificate` method called during TLS handshake (see `TcpSocket.cs`). Override it in `MumbleAdapter`.

### Step 1: Add CertificateService field to MumbleAdapter

At the top of `MumbleAdapter`, add the field and update the constructor:

```csharp
// Add field after _lastWelcomeText:
private readonly CertificateService? _certService;

// Replace constructor:
public MumbleAdapter(NativeBridge bridge, IntPtr hwnd, CertificateService? certService = null)
{
    _bridge = bridge;
    _hwnd = hwnd;
    _certService = certService;
}
```

Add the using at the top of MumbleAdapter.cs:

```csharp
using Brmble.Client.Services.Certificate;
using System.Security.Cryptography.X509Certificates;
```

### Step 2: Override SelectCertificate

Add this method to `MumbleAdapter` (after `RegisterHandlers`):

```csharp
public override System.Security.Cryptography.X509Certificates.X509Certificate SelectCertificate(
    object sender,
    string targetHost,
    System.Security.Cryptography.X509Certificates.X509CertificateCollection localCertificates,
    System.Security.Cryptography.X509Certificates.X509Certificate remoteCertificate,
    string[] acceptableIssuers)
{
    return _certService?.ActiveCertificate ?? base.SelectCertificate(sender, targetHost, localCertificates, remoteCertificate, acceptableIssuers);
}
```

### Step 3: Pass certService in Program.cs

In `InitWebView2Async`, update the `MumbleAdapter` construction line:

```csharp
// Before:
_mumbleClient = new MumbleAdapter(_bridge, _hwnd);

// After:
_mumbleClient = new MumbleAdapter(_bridge, _hwnd, _certService);
```

Note: `_certService` must be initialized before `_mumbleClient`. Verify the order in `InitWebView2Async`.

### Step 4: Build

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeded.

### Step 5: Commit

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs src/Brmble.Client/Program.cs
git commit -m "feat: inject CertificateService into MumbleAdapter for TLS client cert"
```

---

## Task 7: CertWizard React component

**Files:**
- Create: `src/Brmble.Web/src/components/CertWizard/CertWizard.tsx`
- Create: `src/Brmble.Web/src/components/CertWizard/CertWizard.css`

### Step 1: Create CertWizard.css

```css
/* src/Brmble.Web/src/components/CertWizard/CertWizard.css */
.cert-wizard-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.cert-wizard {
  background: var(--bg-primary);
  border: var(--glass-border);
  border-radius: 16px;
  width: 100%;
  max-width: 480px;
  padding: 2.5rem;
  animation: slideUp 300ms ease;
}

.cert-wizard-step-indicator {
  display: flex;
  gap: 6px;
  margin-bottom: 2rem;
}

.cert-wizard-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border-subtle);
  transition: background 0.3s;
}

.cert-wizard-dot.active {
  background: var(--accent-mint);
}

.cert-wizard-icon {
  font-size: 2.5rem;
  margin-bottom: 1rem;
}

.cert-wizard-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 0.75rem;
}

.cert-wizard-body {
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 2rem;
}

.cert-wizard-warning {
  background: rgba(220, 53, 69, 0.12);
  border: 1px solid rgba(220, 53, 69, 0.4);
  border-radius: 10px;
  padding: 1.25rem;
  color: #ff6b7a;
  font-size: 0.875rem;
  line-height: 1.7;
  margin-bottom: 1.5rem;
}

.cert-wizard-warning strong {
  display: block;
  font-size: 1rem;
  margin-bottom: 0.5rem;
  color: #ff4f5e;
}

.cert-wizard-ack {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 2rem;
  cursor: pointer;
}

.cert-wizard-ack input[type="checkbox"] {
  margin-top: 2px;
  width: 16px;
  height: 16px;
  accent-color: var(--accent-mint);
  cursor: pointer;
  flex-shrink: 0;
}

.cert-wizard-ack span {
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.cert-wizard-choices {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 2rem;
}

.cert-wizard-choice {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.25rem;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s;
  color: var(--text-primary);
}

.cert-wizard-choice:hover {
  border-color: var(--accent-mint);
  background: var(--bg-hover);
}

.cert-wizard-choice-icon {
  font-size: 1.5rem;
}

.cert-wizard-choice-label {
  font-size: 0.9rem;
  font-weight: 500;
  margin-bottom: 2px;
}

.cert-wizard-choice-desc {
  font-size: 0.775rem;
  color: var(--text-muted);
}

.cert-wizard-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}

.cert-wizard-btn {
  padding: 0.625rem 1.25rem;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: none;
}

.cert-wizard-btn.primary {
  background: var(--accent-mint);
  color: var(--bg-deep);
}

.cert-wizard-btn.primary:hover {
  opacity: 0.9;
}

.cert-wizard-btn.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cert-wizard-btn.ghost {
  background: transparent;
  color: var(--text-muted);
}

.cert-wizard-btn.ghost:hover {
  color: var(--text-secondary);
}

.cert-wizard-generating {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--text-muted);
  font-size: 0.875rem;
  margin-bottom: 2rem;
}

.cert-wizard-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-subtle);
  border-top-color: var(--accent-mint);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.cert-wizard-fingerprint {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--text-muted);
  word-break: break-all;
  background: var(--bg-glass);
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  margin-bottom: 1rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

### Step 2: Create CertWizard.tsx

```tsx
// src/Brmble.Web/src/components/CertWizard/CertWizard.tsx
import { useState, useEffect } from 'react';
import bridge from '../../bridge';
import './CertWizard.css';

type WizardStep = 'welcome' | 'choose' | 'warning' | 'action' | 'backup';
type WizardMode = 'generate' | 'import';

interface CertWizardProps {
  onComplete: (fingerprint: string) => void;
}

export function CertWizard({ onComplete }: CertWizardProps) {
  const [step, setStep] = useState<WizardStep>('welcome');
  const [mode, setMode] = useState<WizardMode>('generate');
  const [acknowledged, setAcknowledged] = useState(false);
  const [username, setUsername] = useState('');
  const [generating, setGenerating] = useState(false);
  const [fingerprint, setFingerprint] = useState('');
  const [error, setError] = useState('');

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

    const onError = (data: unknown) => {
      const d = data as { message: string } | undefined;
      setGenerating(false);
      setError(d?.message ?? 'An error occurred.');
    };

    bridge.on('cert.generated', onGenerated);
    bridge.on('cert.imported', onImported);
    bridge.on('cert.error', onError);
    return () => {
      bridge.off('cert.generated', onGenerated);
      bridge.off('cert.imported', onImported);
      bridge.off('cert.error', onError);
    };
  }, []);

  const handleGenerate = () => {
    setError('');
    setGenerating(true);
    bridge.send('cert.generate', { subject: username.trim() || 'Brmble User' });
  };

  const handleImport = () => {
    setError('');
    bridge.send('cert.import');
  };

  const handleExportNow = () => {
    bridge.send('cert.export');
    onComplete(fingerprint);
  };

  return (
    <div className="cert-wizard-overlay">
      <div className="cert-wizard">
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
              <button className="cert-wizard-btn primary" onClick={() => setStep('choose')}>
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
              <button className="cert-wizard-btn ghost" onClick={() => setStep('choose')}>
                Back
              </button>
              <button
                className="cert-wizard-btn primary"
                disabled={!acknowledged}
                onClick={() => setStep('action')}
              >
                I Understand, Continue
              </button>
            </div>
          </>
        )}

        {step === 'action' && mode === 'generate' && (
          <>
            <div className="cert-wizard-icon">✨</div>
            <h2 className="cert-wizard-title">Generate Your Certificate</h2>
            <p className="cert-wizard-body">
              Choose a display name. This will be your username on Mumble servers.
            </p>
            <input
              style={{
                width: '100%',
                padding: '0.625rem 0.875rem',
                background: 'var(--bg-glass)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontSize: '0.875rem',
                marginBottom: '1.5rem',
                boxSizing: 'border-box',
              }}
              placeholder="Your username (e.g. pieterhenk)"
              value={username}
              onChange={e => setUsername(e.target.value)}
              maxLength={50}
              disabled={generating}
            />
            {generating && (
              <div className="cert-wizard-generating">
                <div className="cert-wizard-spinner" />
                Generating your certificate...
              </div>
            )}
            {error && <p style={{ color: '#ff6b7a', fontSize: '0.85rem', marginBottom: '1rem' }}>{error}</p>}
            <div className="cert-wizard-actions">
              <button className="cert-wizard-btn ghost" onClick={() => setStep('warning')} disabled={generating}>
                Back
              </button>
              <button
                className="cert-wizard-btn primary"
                onClick={handleGenerate}
                disabled={generating || !username.trim()}
              >
                Generate
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
              Brmble will open a file picker.
            </p>
            {error && <p style={{ color: '#ff6b7a', fontSize: '0.85rem', marginBottom: '1rem' }}>{error}</p>}
            <div className="cert-wizard-actions">
              <button className="cert-wizard-btn ghost" onClick={() => setStep('warning')}>
                Back
              </button>
              <button className="cert-wizard-btn primary" onClick={handleImport}>
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
              <button className="cert-wizard-btn ghost" onClick={() => onComplete(fingerprint)}>
                Skip for now
              </button>
              <button className="cert-wizard-btn primary" onClick={handleExportNow}>
                Export Now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

### Step 3: Build the frontend

```bash
cd src/Brmble.Web && npm run build
```

Expected: Build succeeded, no TypeScript errors.

### Step 4: Commit

```bash
git add src/Brmble.Web/src/components/CertWizard/
git commit -m "feat: add 5-step CertWizard React component"
```

---

## Task 8: Identity tab in SettingsModal

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/IdentitySettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`

### Step 1: Create IdentitySettingsTab.tsx

```tsx
// src/Brmble.Web/src/components/SettingsModal/IdentitySettingsTab.tsx
import bridge from '../../bridge';

interface IdentitySettingsTabProps {
  fingerprint: string;
  connectedUsername: string;
}

export function IdentitySettingsTab({ fingerprint, connectedUsername }: IdentitySettingsTabProps) {
  const handleExport = () => bridge.send('cert.export');
  const handleImport = () => {
    // Warn the user: takes effect on next launch (no mid-session identity swap)
    bridge.send('cert.import');
  };

  return (
    <div>
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
          <button className="settings-btn secondary" onClick={handleImport}>Import</button>
        </div>
      </div>
    </div>
  );
}
```

### Step 2: Add Identity tab to SettingsModal.tsx

In `SettingsModal.tsx`, make these changes:

**Add import at top:**
```tsx
import { IdentitySettingsTab } from './IdentitySettingsTab';
```

**Update Props interface:**
```tsx
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  username?: string;
  certFingerprint?: string;
}
```

**Update the tab type:**
```tsx
const [activeTab, setActiveTab] = useState<'audio' | 'shortcuts' | 'messages' | 'overlay' | 'identity'>('audio');
```

**Add the tab button** (inside `.settings-tabs`, after the Overlay button):
```tsx
<button
  className={`settings-tab ${activeTab === 'identity' ? 'active' : ''}`}
  onClick={() => setActiveTab('identity')}
>
  Identity
</button>
```

**Add the tab content** (inside `.settings-content`, after the overlay conditional):
```tsx
{activeTab === 'identity' && (
  <IdentitySettingsTab
    fingerprint={props.certFingerprint ?? ''}
    connectedUsername={props.username ?? ''}
  />
)}
```

Note: The `SettingsModal` function signature must destructure the new prop. Change:
```tsx
export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
```
to:
```tsx
export function SettingsModal(props: SettingsModalProps) {
  const { isOpen, onClose } = props;
```

### Step 3: Build the frontend

```bash
cd src/Brmble.Web && npm run build
```

Expected: No TypeScript errors.

### Step 4: Commit

```bash
git add src/Brmble.Web/src/components/SettingsModal/
git commit -m "feat: add Identity tab to SettingsModal with fingerprint and cert actions"
```

---

## Task 9: App.tsx integration

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

### Step 1: Add cert state and wizard

In `App.tsx`, make these additions:

**Add import:**
```tsx
import { CertWizard } from './components/CertWizard/CertWizard';
```

**Add state** (near the top of `App()`, alongside the other useState calls):
```tsx
// null = status not yet received, false = no cert, true = cert exists
const [certExists, setCertExists] = useState<boolean | null>(null);
const [certFingerprint, setCertFingerprint] = useState('');
```

**Add bridge effect** — in the existing `useEffect` that runs on mount (the one that registers all bridge handlers), add these handlers inside the bridge registration block and cleanup:

```tsx
// Inside the useEffect — add alongside other handler registrations:
const onCertStatus = (data: unknown) => {
  const d = data as { exists: boolean; fingerprint?: string } | undefined;
  if (d?.exists) {
    setCertExists(true);
    setCertFingerprint(d.fingerprint ?? '');
  } else {
    setCertExists(false);
  }
};
const onCertGenerated = (data: unknown) => {
  const d = data as { fingerprint?: string } | undefined;
  setCertExists(true);
  setCertFingerprint(d?.fingerprint ?? '');
};
const onCertImported = (data: unknown) => {
  const d = data as { fingerprint?: string } | undefined;
  setCertExists(true);
  setCertFingerprint(d?.fingerprint ?? '');
};

bridge.on('cert.status', onCertStatus);
bridge.on('cert.generated', onCertGenerated);
bridge.on('cert.imported', onCertImported);

// Inside the return cleanup:
bridge.off('cert.status', onCertStatus);
bridge.off('cert.generated', onCertGenerated);
bridge.off('cert.imported', onCertImported);
```

**Request cert status on mount** — add a second `useEffect` (separate from the bridge handler one):
```tsx
useEffect(() => {
  bridge.send('cert.requestStatus');
}, []);
```

**Pass certFingerprint to SettingsModal:**
```tsx
<SettingsModal
  isOpen={showSettings}
  onClose={() => setShowSettings(false)}
  username={username}
  certFingerprint={certFingerprint}
/>
```

**Replace the server list conditional.** Find this block:
```tsx
{!connected && (
  <div className="connect-overlay">
    <ServerList onConnect={handleServerConnect} />
  </div>
)}
```

Replace with:
```tsx
{certExists === false && (
  <CertWizard onComplete={(fp) => { setCertExists(true); setCertFingerprint(fp); }} />
)}

{certExists === true && !connected && (
  <div className="connect-overlay">
    <ServerList onConnect={handleServerConnect} />
  </div>
)}
```

### Step 2: Build the frontend

```bash
cd src/Brmble.Web && npm run build
```

Expected: No TypeScript errors.

### Step 3: Build everything

```bash
dotnet build
```

Expected: All projects build successfully.

### Step 4: Commit

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: wire CertWizard into App — blocks server list until cert exists"
```

---

## Task 10: Final verification

### Step 1: Run tests

```bash
dotnet test
```

Expected: All 57 existing tests pass.

### Step 2: Manual smoke test checklist

- [ ] Launch app with no `%AppData%\Brmble\identity.pfx` → CertWizard appears
- [ ] Step through wizard: Welcome → Choose Generate → Warning → enter username → Generate → fingerprint shown on backup step
- [ ] Export from backup step → Win32 save dialog opens → `.pfx` saved to chosen location
- [ ] Skip backup → server list appears
- [ ] Open Settings → Identity tab shows fingerprint and username
- [ ] Export from Identity tab → dialog opens
- [ ] Launch again → wizard does NOT appear (cert exists)
- [ ] Connect to Mumble server → connection succeeds with cert presented

### Step 3: Create branch and PR

```bash
git checkout -b feature/cert-manager
git push -u origin feature/cert-manager
gh pr create --title "feat: certificate manager — generation, import, export, wizard UI" \
  --body "Closes #8"
```
