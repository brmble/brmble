# Multi-Profile System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multi-profile support so users can manage multiple certificates, each with a profile name that serves as the default server username.

**Architecture:** Profiles are stored in `config.json` alongside the existing server list. Each profile has an ID, name, and a cert file at `%APPDATA%/Brmble/certs/{id}.pfx`. The backend exposes `profiles.*` bridge messages. The frontend adds a Profiles tab in Settings, mirroring the ServerList layout.

**Tech Stack:** C# (AppConfigService, CertificateService), React + TypeScript (Settings UI, CertWizard), MSTest (backend tests)

---

### Task 1: Add Profile Data Model to AppConfigService

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppConfigService.cs`
- Modify: `src/Brmble.Client/Services/AppConfig/IAppConfigService.cs`
- Test: `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`

**Step 1: Write the failing tests**

Add these tests to `AppConfigServiceTests.cs`:

```csharp
[TestMethod]
public void LoadsEmptyProfiles_WhenNoFileExists()
{
    var svc = new AppConfigService(_tempDir);
    Assert.AreEqual(0, svc.GetProfiles().Count);
    Assert.IsNull(svc.GetActiveProfileId());
}

[TestMethod]
public void SavesAndReloads_Profiles()
{
    var svc = new AppConfigService(_tempDir);
    var profile = new ProfileEntry("p1", "Roan");
    svc.AddProfile(profile);
    svc.SetActiveProfileId("p1");

    var svc2 = new AppConfigService(_tempDir);
    Assert.AreEqual(1, svc2.GetProfiles().Count);
    Assert.AreEqual("Roan", svc2.GetProfiles()[0].Name);
    Assert.AreEqual("p1", svc2.GetActiveProfileId());
}

[TestMethod]
public void RemoveProfile_RemovesFromConfig_ButNotCertFile()
{
    var svc = new AppConfigService(_tempDir);
    var certsDir = Path.Combine(_tempDir, "certs");
    Directory.CreateDirectory(certsDir);
    File.WriteAllBytes(Path.Combine(certsDir, "p1.pfx"), new byte[] { 1, 2, 3 });

    svc.AddProfile(new ProfileEntry("p1", "Test"));
    svc.RemoveProfile("p1");

    Assert.AreEqual(0, svc.GetProfiles().Count);
    Assert.IsTrue(File.Exists(Path.Combine(certsDir, "p1.pfx")), "Cert file should NOT be deleted");
}

[TestMethod]
public void RemoveActiveProfile_ClearsActiveId_WhenLastProfile()
{
    var svc = new AppConfigService(_tempDir);
    svc.AddProfile(new ProfileEntry("p1", "Only"));
    svc.SetActiveProfileId("p1");

    svc.RemoveProfile("p1");

    Assert.IsNull(svc.GetActiveProfileId());
}

[TestMethod]
public void RemoveActiveProfile_SwitchesToAnother_WhenOthersExist()
{
    var svc = new AppConfigService(_tempDir);
    svc.AddProfile(new ProfileEntry("p1", "First"));
    svc.AddProfile(new ProfileEntry("p2", "Second"));
    svc.SetActiveProfileId("p1");

    svc.RemoveProfile("p1");

    Assert.AreEqual("p2", svc.GetActiveProfileId());
}

[TestMethod]
public void RenameProfile_UpdatesName()
{
    var svc = new AppConfigService(_tempDir);
    svc.AddProfile(new ProfileEntry("p1", "Old Name"));

    svc.RenameProfile("p1", "New Name");
    var svc2 = new AppConfigService(_tempDir);

    Assert.AreEqual("New Name", svc2.GetProfiles()[0].Name);
}

[TestMethod]
public void MigratesIdentityPfx_ToProfileOnLoad()
{
    // Create a legacy identity.pfx
    File.WriteAllBytes(Path.Combine(_tempDir, "identity.pfx"), new byte[] { 1, 2, 3 });

    var svc = new AppConfigService(_tempDir);

    Assert.AreEqual(1, svc.GetProfiles().Count);
    Assert.IsNotNull(svc.GetActiveProfileId());
    var profile = svc.GetProfiles()[0];
    Assert.AreEqual("Default", profile.Name);
    Assert.IsTrue(File.Exists(Path.Combine(_tempDir, "certs", profile.Id + ".pfx")));
    Assert.IsFalse(File.Exists(Path.Combine(_tempDir, "identity.pfx")), "Old file should be moved");
}
```

**Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "ClassName~AppConfigServiceTests" -v n`
Expected: FAIL — `ProfileEntry` type doesn't exist, methods don't exist.

**Step 3: Add ProfileEntry record and IAppConfigService interface changes**

In `IAppConfigService.cs`, add at the bottom of the interface:

```csharp
IReadOnlyList<ProfileEntry> GetProfiles();
void AddProfile(ProfileEntry profile);
void RemoveProfile(string id);
void RenameProfile(string id, string newName);
string? GetActiveProfileId();
void SetActiveProfileId(string? id);
string GetCertsDir();
```

Add above the interface (same file, same namespace):

```csharp
public record ProfileEntry(string Id, string Name);
```

**Step 4: Implement profile methods in AppConfigService**

Add fields alongside existing ones (after line 24):

```csharp
private List<ProfileEntry> _profiles = new();
private string? _activeProfileId;
```

Add a `_dir` field set from the constructor's `dir` parameter (store it so we can compute certs path):

```csharp
private readonly string _dir;
```

Set `_dir = dir;` in the constructor (line 35).

Add `GetCertsDir()`:

```csharp
public string GetCertsDir()
{
    var certsDir = Path.Combine(_dir, "certs");
    Directory.CreateDirectory(certsDir);
    return certsDir;
}
```

Add profile methods:

```csharp
public IReadOnlyList<ProfileEntry> GetProfiles() { lock (_lock) return _profiles.ToList(); }

public void AddProfile(ProfileEntry profile)
{
    lock (_lock)
    {
        _profiles.Add(profile);
        Save();
    }
}

public void RemoveProfile(string id)
{
    lock (_lock)
    {
        _profiles.RemoveAll(p => p.Id == id);
        if (_activeProfileId == id)
            _activeProfileId = _profiles.FirstOrDefault()?.Id;
        Save();
    }
}

public void RenameProfile(string id, string newName)
{
    lock (_lock)
    {
        var idx = _profiles.FindIndex(p => p.Id == id);
        if (idx >= 0)
        {
            _profiles[idx] = _profiles[idx] with { Name = newName };
            Save();
        }
    }
}

public string? GetActiveProfileId() { lock (_lock) return _activeProfileId; }

public void SetActiveProfileId(string? id)
{
    lock (_lock)
    {
        _activeProfileId = id;
        Save();
    }
}
```

Update `ConfigData` record to include profiles:

```csharp
private record ConfigData
{
    public List<ServerEntry> Servers { get; init; } = [];
    public AppSettings Settings { get; init; } = AppSettings.Default;
    public WindowState? Window { get; init; } = null;
    public string? ClosePreference { get; init; } = null;
    public string? LastConnectedServerId { get; init; } = null;
    public double? ZoomFactor { get; init; } = null;
    public List<ProfileEntry> Profiles { get; init; } = [];
    public string? ActiveProfileId { get; init; } = null;
}
```

Update `Load()` to read profiles:

```csharp
_profiles = data?.Profiles ?? new List<ProfileEntry>();
_activeProfileId = data?.ActiveProfileId;
```

Update `Save()` to include profiles:

```csharp
var data = new ConfigData {
    Servers = _servers, Settings = _settings, Window = _windowState,
    ClosePreference = _closePreference, LastConnectedServerId = _lastConnectedServerId,
    ZoomFactor = _zoomFactor, Profiles = _profiles, ActiveProfileId = _activeProfileId
};
```

Add migration in `Load()` — after loading config (or after legacy migration), before the method returns, add:

```csharp
MigrateIdentityPfx();
```

Add the migration method:

```csharp
private void MigrateIdentityPfx()
{
    if (_profiles.Count > 0) return;

    var oldCertPath = Path.Combine(_dir, "identity.pfx");
    if (!File.Exists(oldCertPath)) return;

    var id = Guid.NewGuid().ToString();
    var certsDir = Path.Combine(_dir, "certs");
    Directory.CreateDirectory(certsDir);
    File.Move(oldCertPath, Path.Combine(certsDir, id + ".pfx"));

    _profiles.Add(new ProfileEntry(id, "Default"));
    _activeProfileId = id;
    Save();
}
```

**Step 5: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "ClassName~AppConfigServiceTests" -v n`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/ tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs
git commit -m "feat: add profile data model to AppConfigService with migration"
```

---

### Task 2: Update CertificateService to Support Profiles

**Files:**
- Modify: `src/Brmble.Client/Services/Certificate/CertificateService.cs`
- Modify: `src/Brmble.Client/Program.cs`

**Step 1: Refactor CertificateService to accept a dynamic cert path**

Replace the static `CertPath` property with a method that takes a profile ID:

```csharp
private readonly IAppConfigService _config;

private string GetCertPath(string profileId) =>
    Path.Combine(_config.GetCertsDir(), profileId + ".pfx");

private string? ActiveCertPath =>
    _config.GetActiveProfileId() is string id ? GetCertPath(id) : null;
```

Update the constructor to accept `IAppConfigService`:

```csharp
public CertificateService(NativeBridge bridge, IAppConfigService config)
{
    _bridge = bridge;
    _config = config;
}
```

**Step 2: Update all methods that reference `CertPath`**

- `SendStatus()`: Replace `File.Exists(CertPath)` with `ActiveCertPath is string path && File.Exists(path)`, use `path` throughout.
- `GenerateCertificate()`: This is now called only via `profiles.add` (Task 3). For now, add a `GenerateCertificate(string certPath)` overload that takes an explicit path. Keep the old `GenerateCertificate()` using `ActiveCertPath`.
- `ImportCertificate(string base64Data)`: Same pattern — add `ImportCertificate(string base64Data, string certPath)` overload.
- `ExportCertificate()`: Use `ActiveCertPath`.
- `GetExportableCertificate()`: Use `ActiveCertPath`.

Add public methods for profile-specific cert operations:

```csharp
internal void GenerateCertificateForProfile(string certPath)
{
    // Same as GenerateCertificate but writes to certPath instead of CertPath
}

internal void ImportCertificateForProfile(string base64Data, string certPath)
{
    // Same as ImportCertificate but writes to certPath instead of CertPath
}
```

**Step 3: Update Program.cs**

Change line 236:

```csharp
_certService = new CertificateService(_bridge, _appConfigService);
```

**Step 4: Run build to verify no compilation errors**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 5: Run existing tests to verify no regressions**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj -v n`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Certificate/CertificateService.cs src/Brmble.Client/Program.cs
git commit -m "refactor: make CertificateService profile-aware with dynamic cert paths"
```

---

### Task 3: Add Profile Bridge Handlers

**Files:**
- Modify: `src/Brmble.Client/Services/Certificate/CertificateService.cs` (add `profiles.*` handlers)

**Step 1: Add profiles bridge handlers in RegisterHandlers**

Add these handlers alongside the existing `cert.*` handlers:

```csharp
bridge.RegisterHandler("profiles.list", _ =>
{
    var profiles = _config.GetProfiles().Select(p =>
    {
        var certPath = GetCertPath(p.Id);
        string? fingerprint = null;
        bool certValid = false;
        if (File.Exists(certPath))
        {
            try
            {
                using var cert = X509CertificateLoader.LoadPkcs12FromFile(certPath, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);
                fingerprint = cert.Thumbprint;
                certValid = true;
            }
            catch { }
        }
        return new { id = p.Id, name = p.Name, fingerprint, certValid };
    }).ToList();
    bridge.Send("profiles.list", new { profiles, activeProfileId = _config.GetActiveProfileId() });
    return Task.CompletedTask;
});

bridge.RegisterHandler("profiles.add", data =>
{
    var name = data.TryGetProperty("name", out var n) ? n.GetString() ?? "Unnamed" : "Unnamed";
    Task.Run(() =>
    {
        try
        {
            var id = Guid.NewGuid().ToString();
            var certPath = GetCertPath(id);
            Directory.CreateDirectory(Path.GetDirectoryName(certPath)!);

            using var ecdsa = System.Security.Cryptography.ECDsa.Create(
                System.Security.Cryptography.ECCurve.NamedCurves.nistP256);
            var req = new System.Security.Cryptography.X509Certificates.CertificateRequest(
                "CN=Brmble User", ecdsa, System.Security.Cryptography.HashAlgorithmName.SHA256);
            var now = DateTimeOffset.UtcNow;
            using var cert = req.CreateSelfSigned(now, now.AddYears(100));
            File.WriteAllBytes(certPath, cert.Export(X509ContentType.Pfx));

            var profile = new ProfileEntry(id, name);
            _config.AddProfile(profile);

            // If this is the first profile, make it active
            if (_config.GetActiveProfileId() == null)
            {
                _config.SetActiveProfileId(id);
                LoadActiveCertificate();
                bridge.Send("profiles.activeChanged", new { id, name, fingerprint = ActiveCertificate?.Thumbprint });
            }

            bridge.Send("profiles.added", new { id, name, fingerprint = cert.Thumbprint, certValid = true });
        }
        catch (Exception ex)
        {
            bridge.Send("profiles.error", new { message = $"Failed to create profile: {ex.Message}" });
        }
    });
    return Task.CompletedTask;
});

bridge.RegisterHandler("profiles.import", data =>
{
    var name = data.TryGetProperty("name", out var n) ? n.GetString() ?? "Unnamed" : "Unnamed";
    var base64 = data.TryGetProperty("data", out var d) ? d.GetString() : null;
    if (base64 == null)
    {
        bridge.Send("profiles.error", new { message = "No certificate data provided." });
        return Task.CompletedTask;
    }
    Task.Run(() =>
    {
        try
        {
            var bytes = Convert.FromBase64String(base64);
            var testCert = X509CertificateLoader.LoadPkcs12(bytes, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);

            var id = Guid.NewGuid().ToString();
            var certPath = GetCertPath(id);
            Directory.CreateDirectory(Path.GetDirectoryName(certPath)!);
            File.WriteAllBytes(certPath, bytes);

            var profile = new ProfileEntry(id, name);
            _config.AddProfile(profile);

            if (_config.GetActiveProfileId() == null)
            {
                _config.SetActiveProfileId(id);
                LoadActiveCertificate();
                bridge.Send("profiles.activeChanged", new { id, name, fingerprint = testCert.Thumbprint });
            }

            bridge.Send("profiles.added", new { id, name, fingerprint = testCert.Thumbprint, certValid = true });
        }
        catch (Exception ex)
        {
            bridge.Send("profiles.error", new { message = $"Failed to import profile: {ex.Message}" });
        }
    });
    return Task.CompletedTask;
});

bridge.RegisterHandler("profiles.remove", data =>
{
    var id = data.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
    if (id == null) return Task.CompletedTask;

    var wasActive = _config.GetActiveProfileId() == id;
    _config.RemoveProfile(id);
    bridge.Send("profiles.removed", new { id });

    if (wasActive)
    {
        var newActiveId = _config.GetActiveProfileId();
        if (newActiveId != null)
        {
            var newProfile = _config.GetProfiles().FirstOrDefault(p => p.Id == newActiveId);
            LoadActiveCertificate();
            bridge.Send("profiles.activeChanged", new { id = newActiveId, name = newProfile?.Name, fingerprint = ActiveCertificate?.Thumbprint });
        }
        else
        {
            ActiveCertificate = null;
            bridge.Send("profiles.activeChanged", new { id = (string?)null, name = (string?)null, fingerprint = (string?)null });
            bridge.Send("cert.status", new { exists = false });
        }
    }
    return Task.CompletedTask;
});

bridge.RegisterHandler("profiles.rename", data =>
{
    var id = data.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
    var name = data.TryGetProperty("name", out var n) ? n.GetString() : null;
    if (id == null || name == null) return Task.CompletedTask;

    _config.RenameProfile(id, name);
    bridge.Send("profiles.renamed", new { id, name });

    if (_config.GetActiveProfileId() == id)
        bridge.Send("profiles.activeChanged", new { id, name, fingerprint = ActiveCertificate?.Thumbprint });

    return Task.CompletedTask;
});

bridge.RegisterHandler("profiles.setActive", data =>
{
    var id = data.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
    if (id == null) return Task.CompletedTask;

    // TODO: Check connection status — for now, trust the frontend to disable this when connected
    _config.SetActiveProfileId(id);
    LoadActiveCertificate();

    var profile = _config.GetProfiles().FirstOrDefault(p => p.Id == id);
    bridge.Send("profiles.activeChanged", new { id, name = profile?.Name, fingerprint = ActiveCertificate?.Thumbprint });
    bridge.Send("cert.status", new { exists = ActiveCertificate != null, fingerprint = ActiveCertificate?.Thumbprint, subject = ActiveCertificate?.Subject });
    return Task.CompletedTask;
});
```

**Step 2: Add LoadActiveCertificate helper**

```csharp
private void LoadActiveCertificate()
{
    ActiveCertificate = null;
    if (ActiveCertPath is string path && File.Exists(path))
    {
        try
        {
            ActiveCertificate = X509CertificateLoader.LoadPkcs12FromFile(path, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);
        }
        catch { }
    }
}
```

**Step 3: Update SendStatus to use LoadActiveCertificate**

```csharp
private void SendStatus()
{
    LoadActiveCertificate();
    if (ActiveCertificate != null)
    {
        _bridge.Send("cert.status", new
        {
            exists = true,
            fingerprint = ActiveCertificate.Thumbprint,
            subject = ActiveCertificate.Subject
        });
    }
    else
    {
        _bridge.Send("cert.status", new { exists = false });
    }
}
```

**Step 4: Run build**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 5: Run all tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj -v n`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Certificate/CertificateService.cs
git commit -m "feat: add profiles.* bridge handlers for multi-profile management"
```

---

### Task 4: Add useProfiles Hook (Frontend)

**Files:**
- Create: `src/Brmble.Web/src/hooks/useProfiles.ts`

**Step 1: Create the hook**

Model after `useServerlist.ts`. The hook manages profile state via bridge messages:

```typescript
import { useState, useEffect } from 'react';
import bridge from '../bridge';

export interface Profile {
  id: string;
  name: string;
  fingerprint: string | null;
  certValid: boolean;
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onList = (data: unknown) => {
      const d = data as { profiles: Profile[]; activeProfileId: string | null };
      setProfiles(d.profiles ?? []);
      setActiveProfileId(d.activeProfileId ?? null);
      setLoading(false);
    };

    const onAdded = (data: unknown) => {
      const d = data as Profile;
      setProfiles(prev => [...prev, d]);
    };

    const onRemoved = (data: unknown) => {
      const d = data as { id: string };
      setProfiles(prev => prev.filter(p => p.id !== d.id));
    };

    const onRenamed = (data: unknown) => {
      const d = data as { id: string; name: string };
      setProfiles(prev => prev.map(p => p.id === d.id ? { ...p, name: d.name } : p));
    };

    const onActiveChanged = (data: unknown) => {
      const d = data as { id: string | null; name: string | null; fingerprint: string | null };
      setActiveProfileId(d.id);
    };

    bridge.on('profiles.list', onList);
    bridge.on('profiles.added', onAdded);
    bridge.on('profiles.removed', onRemoved);
    bridge.on('profiles.renamed', onRenamed);
    bridge.on('profiles.activeChanged', onActiveChanged);
    bridge.send('profiles.list');

    return () => {
      bridge.off('profiles.list', onList);
      bridge.off('profiles.added', onAdded);
      bridge.off('profiles.removed', onRemoved);
      bridge.off('profiles.renamed', onRenamed);
      bridge.off('profiles.activeChanged', onActiveChanged);
    };
  }, []);

  const addProfile = (name: string) => {
    bridge.send('profiles.add', { name });
  };

  const importProfile = (name: string, data: string) => {
    bridge.send('profiles.import', { name, data });
  };

  const removeProfile = (id: string) => {
    bridge.send('profiles.remove', { id });
  };

  const renameProfile = (id: string, name: string) => {
    bridge.send('profiles.rename', { id, name });
  };

  const setActive = (id: string) => {
    bridge.send('profiles.setActive', { id });
  };

  const exportCert = () => {
    bridge.send('cert.export');
  };

  return { profiles, activeProfileId, loading, addProfile, importProfile, removeProfile, renameProfile, setActive, exportCert };
}
```

**Step 2: Build frontend to verify no TS errors**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/hooks/useProfiles.ts
git commit -m "feat: add useProfiles hook for profile management bridge communication"
```

---

### Task 5: Create ProfilesSettingsTab Component

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.tsx`
- Create: `src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.css`

**Step 1: Create the CSS file**

Follow ServerList.css patterns. Use design tokens from UI_GUIDE.md:

```css
/* Profile list items */
.profiles-items {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.profiles-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md);
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  transition: all var(--transition-fast);
  animation: profileItemFadeIn 0.3s ease-out both;
}

.profiles-item:hover {
  background: var(--bg-hover);
  border-color: var(--accent-primary);
  transform: translateX(4px);
}

.profiles-item-active {
  border-color: var(--accent-primary);
  box-shadow: inset 0 0 0 1px var(--accent-primary-ghost);
}

/* Profile icon (first letter) */
.profiles-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

/* Profile info */
.profiles-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.profiles-name {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profiles-fingerprint {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profiles-active-badge {
  font-size: var(--text-2xs);
  font-weight: 600;
  color: var(--accent-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.profiles-cert-error {
  font-size: var(--text-2xs);
  color: var(--accent-danger);
}

/* Profile actions */
.profiles-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}

/* Inline form (mirrors server-list-form) */
.profiles-form {
  margin-top: var(--space-lg);
  padding: var(--space-lg);
  background: var(--bg-deep-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  animation: formSlideIn 0.25s ease-out;
}

.profiles-form-title {
  margin-bottom: var(--space-md) !important;
}

.profiles-form-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.profiles-form-actions {
  display: flex;
  gap: var(--space-sm);
  margin-top: var(--space-md);
}

.profiles-form-actions .btn {
  flex: 1;
}

.profiles-form-mode-buttons {
  display: flex;
  gap: var(--space-sm);
}

.profiles-form-mode-buttons .btn {
  flex: 1;
}

/* Add button (mirrors server-list-add-btn) */
.profiles-add-btn {
  width: 100%;
  margin-top: var(--space-md);
  padding: var(--space-md);
  border: 2px dashed var(--border-subtle);
  border-radius: var(--radius-lg);
  background: transparent;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
}

.profiles-add-btn:hover {
  border-color: var(--accent-primary);
  border-style: solid;
  color: var(--accent-primary);
  background: var(--accent-primary-ghost);
}

.profiles-add-icon {
  color: var(--accent-primary);
  font-size: var(--text-lg);
}

/* Empty state */
.profiles-empty {
  text-align: center;
  padding: var(--space-xl) var(--space-md);
  color: var(--text-muted);
}

.profiles-empty-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: var(--space-xs);
}

@keyframes profileItemFadeIn {
  from {
    opacity: 0;
    transform: translateX(-8px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
```

**Step 2: Create the component**

```tsx
import { useState, useEffect } from 'react';
import './ProfilesSettingsTab.css';
import { useProfiles } from '../../hooks/useProfiles';
import type { Profile } from '../../hooks/useProfiles';
import { Tooltip } from '../Tooltip/Tooltip';
import { usePrompt } from '../../hooks/usePrompt';

interface ProfilesSettingsTabProps {
  connected: boolean;
}

export function ProfilesSettingsTab({ connected }: ProfilesSettingsTabProps) {
  const { profiles, activeProfileId, loading, addProfile, importProfile, removeProfile, renameProfile, setActive, exportCert } = useProfiles();
  const { confirm } = usePrompt();
  const [isAdding, setIsAdding] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [formName, setFormName] = useState('');
  const [formMode, setFormMode] = useState<'generate' | 'import' | null>(null);
  const [importData, setImportData] = useState<string | null>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAdding(false);
        setEditing(null);
        resetForm();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  const resetForm = () => {
    setFormName('');
    setFormMode(null);
    setImportData(null);
  };

  const handleStartAdd = () => {
    setEditing(null);
    setIsAdding(true);
    resetForm();
  };

  const handleStartEdit = (profile: Profile) => {
    setIsAdding(false);
    setEditing(profile);
    setFormName(profile.name);
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditing(null);
    resetForm();
  };

  const handleSaveNew = () => {
    if (!formName.trim()) return;
    if (formMode === 'import' && importData) {
      importProfile(formName.trim(), importData);
    } else if (formMode === 'generate') {
      addProfile(formName.trim());
    }
    setIsAdding(false);
    resetForm();
  };

  const handleSaveEdit = () => {
    if (!editing || !formName.trim()) return;
    renameProfile(editing.id, formName.trim());
    setEditing(null);
    resetForm();
  };

  const handleDelete = async (profile: Profile) => {
    const confirmed = await confirm(
      `Delete profile "${profile.name}"?`,
      'The certificate file will remain on disk and can be re-imported later.'
    );
    if (confirmed) {
      removeProfile(profile.id);
      if (editing?.id === profile.id) {
        setEditing(null);
        resetForm();
      }
    }
  };

  const handleImportFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pfx,.p12';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setImportData(base64);
        setFormMode('import');
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const truncateFingerprint = (fp: string | null) => {
    if (!fp) return 'No certificate';
    return fp.substring(0, 16).toUpperCase() + '...';
  };

  if (loading) return null;

  return (
    <div className="settings-section">
      <h3 className="heading-section settings-section-title">Profiles</h3>

      {profiles.length > 0 ? (
        <div className="profiles-items">
          {profiles.map((profile, index) => (
            <div
              key={profile.id}
              className={`profiles-item ${profile.id === activeProfileId ? 'profiles-item-active' : ''}`}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="profiles-icon">
                {profile.name.charAt(0).toUpperCase()}
              </div>
              <div className="profiles-info">
                <span className="profiles-name">{profile.name}</span>
                {profile.certValid ? (
                  <span className="profiles-fingerprint">{truncateFingerprint(profile.fingerprint)}</span>
                ) : (
                  <span className="profiles-cert-error">Certificate missing or invalid</span>
                )}
                {profile.id === activeProfileId && (
                  <span className="profiles-active-badge">Active</span>
                )}
              </div>
              <div className="profiles-actions">
                {profile.id !== activeProfileId && (
                  <Tooltip content={connected ? 'Disconnect first' : 'Set as active profile'} position="top">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setActive(profile.id)}
                      disabled={connected || !profile.certValid}
                    >
                      Activate
                    </button>
                  </Tooltip>
                )}
                <Tooltip content="Edit profile name" position="top">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleStartEdit(profile)}
                  >
                    Edit
                  </button>
                </Tooltip>
                {profile.id === activeProfileId && (
                  <Tooltip content="Export certificate" position="top">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => exportCert()}
                    >
                      Export
                    </button>
                  </Tooltip>
                )}
                <Tooltip content="Delete profile" position="top">
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => handleDelete(profile)}
                    style={{ width: 32, height: 32 }}
                  >
                    ×
                  </button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="profiles-empty">
          <p>No profiles yet</p>
          <p className="profiles-empty-hint">Create a profile to get started</p>
        </div>
      )}

      {(isAdding || editing) && (
        <form className="profiles-form" onSubmit={(e) => { e.preventDefault(); isAdding ? handleSaveNew() : handleSaveEdit(); }}>
          <h3 className="heading-section profiles-form-title">
            {isAdding ? 'New Profile' : 'Edit Profile'}
          </h3>
          <div className="profiles-form-fields">
            <label>
              Profile Name
              <input
                className="brmble-input"
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Personal, Work"
                autoFocus
              />
            </label>

            {isAdding && !formMode && (
              <div className="profiles-form-mode-buttons">
                <button type="button" className="btn btn-primary" onClick={() => setFormMode('generate')}>
                  Generate New Certificate
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleImportFile}>
                  Import Certificate
                </button>
              </div>
            )}

            {isAdding && formMode === 'import' && (
              <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>
                Certificate loaded. Click Save to create the profile.
              </p>
            )}
          </div>

          <div className="profiles-form-actions">
            <button type="button" className="btn btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!formName.trim() || (isAdding && !formMode)}
            >
              Save
            </button>
          </div>
        </form>
      )}

      {!isAdding && !editing && (
        <button className="btn btn-ghost profiles-add-btn" onClick={handleStartAdd}>
          <span className="profiles-add-icon">+</span> Add Profile
        </button>
      )}
    </div>
  );
}
```

**Step 3: Build frontend**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.css
git commit -m "feat: add ProfilesSettingsTab component with ServerList-style layout"
```

---

### Task 6: Wire ProfilesSettingsTab into SettingsModal

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`

**Step 1: Add the import**

At the top of the file (after line 11):

```typescript
import { ProfilesSettingsTab } from './ProfilesSettingsTab';
```

**Step 2: Add 'profiles' to the tab type**

Find the `activeTab` useState (line 75) and update the type union to include `'profiles'`:

```typescript
const [activeTab, setActiveTab] = useState<'profile' | 'profiles' | 'audio' | 'shortcuts' | 'messages' | 'appearance' | 'connection'>('profile');
```

**Step 3: Add the Profiles tab button**

After the Profile tab button (after the `</button>` closing tag around line 306), add:

```tsx
<button
  className={`settings-tab ${activeTab === 'profiles' ? 'active' : ''}`}
  onClick={() => setActiveTab('profiles')}
>
  Profiles
</button>
```

**Step 4: Add the Profiles tab content**

In the settings-content div (after the profile tab rendering, around line 350), add:

```tsx
{activeTab === 'profiles' && (
  <ProfilesSettingsTab connected={props.connected ?? false} />
)}
```

**Step 5: Build frontend**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx
git commit -m "feat: wire ProfilesSettingsTab into SettingsModal as new tab"
```

---

### Task 7: Update App.tsx for Profile-Aware State

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Add activeProfileName state**

Near the existing cert state (around line 135), add:

```typescript
const [activeProfileName, setActiveProfileName] = useState('');
```

**Step 2: Add profiles.activeChanged listener**

In the useEffect where bridge listeners are set up (near the cert handlers around line 901-919), add:

```typescript
const onProfilesActiveChanged = (data: unknown) => {
  const d = data as { id: string | null; name: string | null; fingerprint: string | null };
  if (d.id) {
    setCertExists(true);
    setCertFingerprint(d.fingerprint ?? '');
    setActiveProfileName(d.name ?? '');
  } else {
    setCertExists(false);
    setCertFingerprint('');
    setActiveProfileName('');
  }
};
bridge.on('profiles.activeChanged', onProfilesActiveChanged);
```

And in the cleanup return, add:

```typescript
bridge.off('profiles.activeChanged', onProfilesActiveChanged);
```

**Step 3: Request profiles on mount**

In the cert.requestStatus useEffect (around line 1058-1060), also request profiles:

```typescript
useEffect(() => {
  bridge.send('cert.requestStatus');
  bridge.send('profiles.list');
}, []);
```

Add a listener for the initial profiles.list response to set activeProfileName:

```typescript
const onInitialProfilesList = (data: unknown) => {
  const d = data as { profiles: Array<{ id: string; name: string }>; activeProfileId: string | null };
  if (d.activeProfileId) {
    const active = d.profiles.find(p => p.id === d.activeProfileId);
    if (active) setActiveProfileName(active.name);
  }
};
bridge.on('profiles.list', onInitialProfilesList);
// Clean up after first response — handled by the useProfiles hook in settings
```

**Step 4: Use activeProfileName as fallback username for server connection**

In the `handleServerConnect` function (or `handleConnect`), when building the connection params, if the server's `username` is empty, use `activeProfileName`:

Find the server connect handler and update:

```typescript
const connectUsername = server.username || activeProfileName || 'Brmble User';
```

**Step 5: Build frontend**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: add profile-aware state and activeProfileName fallback for connections"
```

---

### Task 8: Extend CertWizard with Profile Name Field

**Files:**
- Modify: `src/Brmble.Web/src/components/CertWizard/CertWizard.tsx`

**Step 1: Add profileName state**

After the existing state declarations (around line 12-15):

```typescript
const [profileName, setProfileName] = useState('');
```

**Step 2: Add a name input to the 'choose' step**

In the `choose` step rendering (around line 150-171), add a text input before the generate/import buttons:

```tsx
<label>
  Profile Name
  <input
    className="brmble-input"
    type="text"
    value={profileName}
    onChange={(e) => setProfileName(e.target.value)}
    placeholder="e.g. Your Name"
    autoFocus
  />
</label>
```

Disable the generate/import buttons when `profileName` is empty.

**Step 3: Change cert.generate to profiles.add**

Replace the `bridge.send('cert.generate')` call (around line 60-63) with:

```typescript
bridge.send('profiles.add', { name: profileName });
```

And the import path to use:

```typescript
bridge.send('profiles.import', { name: profileName, data: base64Data });
```

**Step 4: Listen for profiles.added instead of cert.generated/cert.imported**

Update the bridge listeners in the useEffect:

```typescript
const onProfileAdded = (data: unknown) => {
  const d = data as { fingerprint?: string };
  setFingerprint(d?.fingerprint ?? '');
  setStep('backup');
  setLoading(false);
};
bridge.on('profiles.added', onProfileAdded);
```

Clean up the old `cert.generated` and `cert.imported` listeners (they are no longer needed for the wizard flow).

**Step 5: Build frontend**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/CertWizard/CertWizard.tsx
git commit -m "feat: extend CertWizard to create profile with name on first launch"
```

---

### Task 9: Build, Verify, and Final Commit

**Files:**
- All modified files

**Step 1: Build backend**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 2: Run all backend tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj -v n`
Expected: ALL PASS

**Step 3: Build frontend**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No errors

**Step 4: Build frontend assets**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeded

**Step 5: Verify no uncommitted changes**

Run: `git status`
Expected: Clean working tree

**Step 6: Done**

All tasks complete. The multi-profile system is implemented with:
- Profile data model in AppConfigService with migration from identity.pfx
- Profile-aware CertificateService with dynamic cert paths
- Full profiles.* bridge protocol
- useProfiles hook for frontend state management
- ProfilesSettingsTab in Settings with ServerList-style layout
- Profile-aware App.tsx with activeProfileName fallback
- CertWizard extended to create first profile with a name
