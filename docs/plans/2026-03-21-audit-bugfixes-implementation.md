# Audit Bugfixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix data loss bugs (H1-H3), robustness/UX issues (M1-M5), and one CSS inconsistency (L3) found during the multi-profile branch audit.

**Architecture:** All fixes are isolated — no cross-task dependencies. Frontend fixes are in React (App.tsx, useGameState, Brmblegotchi, ProfileSettingsTab, CertWizard). Backend fixes are in C# (CertificateService, AppConfigService). Each task is independently buildable and testable.

**Tech Stack:** React, TypeScript, C# (.NET 10), WebView2 bridge

---

### Task 1: H1 — Fix Migration Timing (Data Loss on First Profile)

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:35,141-146,921-953`

**Step 1: Move migration into bridge event handlers**

In `App.tsx`, find the four handlers that set `certFingerprint` and call `migrateLocalStorage` synchronously before `setCertFingerprint`:

```tsx
    const onCertStatus = (data: unknown) => {
      const d = data as { exists: boolean; fingerprint?: string } | undefined;
      if (d?.exists) {
        setCertExists(true);
        const fp = d.fingerprint ?? '';
        if (fp) migrateLocalStorage(fp);
        setCertFingerprint(fp);
      } else {
        setCertExists(false);
      }
    };
    const onCertGenerated = (data: unknown) => {
      const d = data as { fingerprint?: string } | undefined;
      setCertExists(true);
      const fp = d?.fingerprint ?? '';
      if (fp) migrateLocalStorage(fp);
      setCertFingerprint(fp);
    };
    const onCertImported = (data: unknown) => {
      const d = data as { fingerprint?: string } | undefined;
      setCertExists(true);
      const fp = d?.fingerprint ?? '';
      if (fp) migrateLocalStorage(fp);
      setCertFingerprint(fp);
    };

    const onProfilesActiveChanged = (data: unknown) => {
      const d = data as { id: string | null; name: string | null; fingerprint: string | null };
      resetMarkersCache();
      if (d.id) {
        setCertExists(true);
        const fp = d.fingerprint ?? '';
        if (fp) migrateLocalStorage(fp);
        setCertFingerprint(fp);
        setActiveProfileName(d.name ?? '');
      } else {
        setCertExists(false);
        setCertFingerprint('');
        setActiveProfileName('');
        setShowSettings(false);
      }
    };
```

**Step 2: Remove the useEffect migration**

Delete lines 141-146:
```tsx
  // Migrate global localStorage keys to per-profile scoped keys
  useEffect(() => {
    if (certFingerprint) {
      migrateLocalStorage(certFingerprint);
    }
  }, [certFingerprint]);
```

**Step 3: Build to verify**

Run: `npm run build` (in `src/Brmble.Web`)
Expected: Success, no type errors

**Step 4: Commit**

```
git add src/Brmble.Web/src/App.tsx
git commit -m "fix: run localStorage migration synchronously before setting fingerprint to prevent data loss"
```

---

### Task 2: H2 — Fix Stale State Cross-Write During Profile Switch

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts:111-127`
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx:261-295`

**Step 1: Change useGameState fingerprint reload to useLayoutEffect**

In `useGameState.ts`, add `useLayoutEffect` to the import from React (it already imports `useEffect`, `useState`, `useRef`, `useMemo`, `useCallback`). Then change the fingerprint reload effect from `useEffect` to `useLayoutEffect`:

```ts
  // Reload state when profile fingerprint changes
  const fingerprintRef = useRef(fingerprint);
  useLayoutEffect(() => {
    if (fingerprint && fingerprint !== fingerprintRef.current) {
      fingerprintRef.current = fingerprint;
      const key = `${STORAGE_KEY}_${fingerprint}`;
      const saved = localStorage.getItem(key);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (hasInfrastructure(parsed) && hasServices(parsed)) {
            setState(parsed);
            return;
          }
        } catch { /* ignore */ }
      }
      setState(INITIAL_STATE);
    }
  }, [fingerprint]);
```

**Step 2: Change Brmblegotchi fingerprint reload to useLayoutEffect**

In `Brmblegotchi.tsx`, add `useLayoutEffect` to the React import. Then change the fingerprint reload effect from `useEffect` to `useLayoutEffect`:

```tsx
  // Reload state when profile fingerprint changes
  const fingerprintRef = useRef(fingerprint);
  useLayoutEffect(() => {
    if (fingerprint && fingerprint !== fingerprintRef.current) {
      fingerprintRef.current = fingerprint;
      // Reload pet state
      try {
        const stored = localStorage.getItem(`${STATE_KEY}_${fingerprint}`);
        if (stored) {
          const saved = JSON.parse(stored) as PetState;
          const elapsed = (Date.now() - saved.lastUpdate) / 1000;
          setPetState({
            hunger: Math.max(0, saved.hunger - elapsed * 0.0069),
            happiness: Math.max(0, saved.happiness - elapsed * 0.0139),
            cleanliness: Math.max(0, saved.cleanliness - elapsed * 0.0278),
            lastUpdate: Date.now(),
            lastActionTime: saved.lastActionTime ?? 0,
          });
        } else {
          setPetState({ hunger: 80, happiness: 75, cleanliness: 85, lastUpdate: Date.now(), lastActionTime: 0 });
        }
      } catch {
        setPetState({ hunger: 80, happiness: 75, cleanliness: 85, lastUpdate: Date.now(), lastActionTime: 0 });
      }
      // Reload position
      try {
        const stored = localStorage.getItem(`${POSITION_KEY}_${fingerprint}`);
        if (stored) {
          setPosition(JSON.parse(stored));
        } else {
          setPosition({ bottom: 150, right: 24 });
        }
      } catch {
        setPosition({ bottom: 150, right: 24 });
      }
    }
  }, [fingerprint]);
```

**Step 3: Build to verify**

Run: `npm run build` (in `src/Brmble.Web`)
Expected: Success

**Step 4: Commit**

```
git add src/Brmble.Web/src/components/Game/useGameState.ts src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx
git commit -m "fix: use useLayoutEffect for profile switch state reload to prevent cross-profile data corruption"
```

---

### Task 3: H3 — Guard `profiles.setActive` Against No-Op

**Files:**
- Modify: `src/Brmble.Client/Services/Certificate/CertificateService.cs:532-551`

**Step 1: Add guard after SetActiveProfileId**

Replace the `profiles.setActive` handler body with a guard that verifies the switch succeeded:

```csharp
        bridge.RegisterHandler("profiles.setActive", data =>
        {
            var id = data.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
            if (id == null) return Task.CompletedTask;

            var oldProfileId = _config.GetActiveProfileId();

            _config.SetActiveProfileId(id);

            // Verify the switch actually happened (SetActiveProfileId is a no-op for non-existent IDs)
            if (_config.GetActiveProfileId() != id) return Task.CompletedTask;

            lock (_certLock) { LoadActiveCertificate(); }

            // Swap registration data — save old profile's, load new profile's cached registrations
            _config.SwapProfileRegistrations(oldProfileId, id);

            var profile = _config.GetProfiles().FirstOrDefault(p => p.Id == id);
            bridge.Send("profiles.activeChanged", new { id, name = profile?.Name, fingerprint = GetCertHash() });
            bridge.Send("cert.status", new { exists = ActiveCertificate != null, fingerprint = GetCertHash(), subject = ActiveCertificate?.Subject });
            // Re-send server list so frontend picks up swapped registration fields
            bridge.Send("servers.list", new { servers = _config.GetServers() });
            return Task.CompletedTask;
        });
```

Note: This uses `_certLock` and `GetCertHash()` which will be added in Task 6 (M2). If implementing sequentially, add the `_certLock` field first (Task 6) or use `LoadActiveCertificate()` without the lock temporarily and add it in Task 6.

**Step 2: Build to verify**

Run: `dotnet build`
Expected: Success

**Step 3: Commit**

```
git add src/Brmble.Client/Services/Certificate/CertificateService.cs
git commit -m "fix: guard profiles.setActive against no-op when profile ID doesn't exist"
```

---

### Task 4: M1 — Add Duplicate Name Guard in C# Backend

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/IAppConfigService.cs:25-27`
- Modify: `src/Brmble.Client/Services/AppConfig/AppConfigService.cs:262-294`
- Modify: `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`

**Step 1: Change return types in interface**

In `IAppConfigService.cs`, change:
```csharp
    bool AddProfile(ProfileEntry profile);
    void RemoveProfile(string id);
    bool RenameProfile(string id, string newName);
```

**Step 2: Update AddProfile with duplicate guard**

In `AppConfigService.cs`:
```csharp
    public bool AddProfile(ProfileEntry profile)
    {
        lock (_lock)
        {
            if (_profiles.Any(p => p.Id == profile.Id)) return false;
            if (_profiles.Any(p => p.Name.Equals(profile.Name, StringComparison.OrdinalIgnoreCase))) return false;
            _profiles.Add(profile);
            Save();
            return true;
        }
    }
```

**Step 3: Update RenameProfile with duplicate guard**

In `AppConfigService.cs`:
```csharp
    public bool RenameProfile(string id, string newName)
    {
        lock (_lock)
        {
            if (_profiles.Any(p => p.Id != id && p.Name.Equals(newName, StringComparison.OrdinalIgnoreCase))) return false;
            var idx = _profiles.FindIndex(p => p.Id == id);
            if (idx >= 0)
            {
                _profiles[idx] = _profiles[idx] with { Name = newName };
                Save();
                return true;
            }
            return false;
        }
    }
```

**Step 4: Add tests**

Add these test methods to `AppConfigServiceTests.cs`:

```csharp
    [TestMethod]
    public void AddProfile_RejectsDuplicateName()
    {
        var svc = CreateService();
        svc.AddProfile(new ProfileEntry("id1", "MyProfile"));
        var result = svc.AddProfile(new ProfileEntry("id2", "myprofile"));
        Assert.IsFalse(result);
        Assert.AreEqual(1, svc.GetProfiles().Count);
    }

    [TestMethod]
    public void RenameProfile_RejectsDuplicateName()
    {
        var svc = CreateService();
        svc.AddProfile(new ProfileEntry("id1", "Alpha"));
        svc.AddProfile(new ProfileEntry("id2", "Beta"));
        var result = svc.RenameProfile("id2", "alpha");
        Assert.IsFalse(result);
        Assert.AreEqual("Beta", svc.GetProfiles().First(p => p.Id == "id2").Name);
    }

    [TestMethod]
    public void RenameProfile_AllowsSameNameForSameProfile()
    {
        var svc = CreateService();
        svc.AddProfile(new ProfileEntry("id1", "Alpha"));
        var result = svc.RenameProfile("id1", "Alpha");
        Assert.IsTrue(result);
    }
```

**Step 5: Fix any compilation errors from return type change**

The `CertificateService.cs` calls `_config.AddProfile(...)` and `_config.RenameProfile(...)`. Since these previously returned `void`, callers that ignore the return value will still compile fine (C# allows discarding return values). No changes needed there.

**Step 6: Build and test**

Run: `dotnet build && dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`
Expected: All tests pass (including new ones)

**Step 7: Commit**

```
git add src/Brmble.Client/Services/AppConfig/IAppConfigService.cs src/Brmble.Client/Services/AppConfig/AppConfigService.cs tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs
git commit -m "fix: add duplicate name guard to AddProfile and RenameProfile in AppConfigService"
```

---

### Task 5: M5 — Add try/catch to Bridge Handlers

**Files:**
- Modify: `src/Brmble.Client/Services/Certificate/CertificateService.cs:389-455,532-551`

**Step 1: Wrap profiles.remove handler**

```csharp
        bridge.RegisterHandler("profiles.remove", data =>
        {
            try
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
                        lock (_certLock) { LoadActiveCertificate(); }
                        bridge.Send("profiles.activeChanged", new { id = newActiveId, name = newProfile?.Name, fingerprint = GetCertHash() });
                    }
                    else
                    {
                        lock (_certLock)
                        {
                            var old = ActiveCertificate;
                            ActiveCertificate = null;
                            old?.Dispose();
                        }
                        bridge.Send("profiles.activeChanged", new { id = (string?)null, name = (string?)null, fingerprint = (string?)null });
                        bridge.Send("cert.status", new { exists = false });
                    }
                }
            }
            catch (Exception ex)
            {
                bridge.Send("profiles.error", new { message = $"Failed to remove profile: {ex.Message}" });
            }
            return Task.CompletedTask;
        });
```

**Step 2: Wrap profiles.rename handler**

```csharp
        bridge.RegisterHandler("profiles.rename", data =>
        {
            try
            {
                var id = data.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                var name = data.TryGetProperty("name", out var n) ? n.GetString()?.Trim() : null;
                if (id == null || name == null) return Task.CompletedTask;

                var validationError = ValidateProfileName(name);
                if (validationError != null)
                {
                    bridge.Send("profiles.error", new { message = validationError });
                    return Task.CompletedTask;
                }

                // Find the current cert file before renaming the profile
                var oldProfile = _config.GetProfiles().FirstOrDefault(p => p.Id == id);
                var oldCertPath = oldProfile != null ? FindCertPath(id, oldProfile.Name) : null;

                _config.RenameProfile(id, name);

                // Rename the cert file on disk to match the new profile name
                if (oldCertPath != null && File.Exists(oldCertPath))
                {
                    var newCertPath = GetCertPath(id, name);
                    if (!string.Equals(oldCertPath, newCertPath, StringComparison.OrdinalIgnoreCase))
                    {
                        try { File.Move(oldCertPath, newCertPath); }
                        catch { /* best-effort; FindCertPath fallback will still locate it */ }
                    }
                }

                bridge.Send("profiles.renamed", new { id, name });

                if (_config.GetActiveProfileId() == id)
                    bridge.Send("profiles.activeChanged", new { id, name, fingerprint = GetCertHash() });
            }
            catch (Exception ex)
            {
                bridge.Send("profiles.error", new { message = $"Failed to rename profile: {ex.Message}" });
            }
            return Task.CompletedTask;
        });
```

**Step 3: Wrap profiles.setActive handler**

(Already partially done in Task 3. Add the try/catch around the whole body.)

```csharp
        bridge.RegisterHandler("profiles.setActive", data =>
        {
            try
            {
                var id = data.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                if (id == null) return Task.CompletedTask;

                var oldProfileId = _config.GetActiveProfileId();

                _config.SetActiveProfileId(id);

                // Verify the switch actually happened
                if (_config.GetActiveProfileId() != id) return Task.CompletedTask;

                lock (_certLock) { LoadActiveCertificate(); }

                _config.SwapProfileRegistrations(oldProfileId, id);

                var profile = _config.GetProfiles().FirstOrDefault(p => p.Id == id);
                bridge.Send("profiles.activeChanged", new { id, name = profile?.Name, fingerprint = GetCertHash() });
                bridge.Send("cert.status", new { exists = ActiveCertificate != null, fingerprint = GetCertHash(), subject = ActiveCertificate?.Subject });
                bridge.Send("servers.list", new { servers = _config.GetServers() });
            }
            catch (Exception ex)
            {
                bridge.Send("profiles.error", new { message = $"Failed to switch profile: {ex.Message}" });
            }
            return Task.CompletedTask;
        });
```

**Step 4: Build to verify**

Run: `dotnet build`
Expected: Success

**Step 5: Commit**

```
git add src/Brmble.Client/Services/Certificate/CertificateService.cs
git commit -m "fix: add try/catch to profiles.remove, profiles.rename, profiles.setActive handlers"
```

---

### Task 6: M2 — Add Thread Safety to CertificateService

**Files:**
- Modify: `src/Brmble.Client/Services/Certificate/CertificateService.cs:12,17-18,298,353,404,409-411,540,565-578`

**Step 1: Add the lock field**

After line 12 (`public X509Certificate2? ActiveCertificate { get; private set; }`), add:

```csharp
    private readonly object _certLock = new();
```

**Step 2: Wrap all ActiveCertificate reads/writes in lock**

Every location where `ActiveCertificate` is read or written outside of already-locked code needs `lock (_certLock)`. Key locations:

- `LoadActiveCertificate()` (line 565-578) — the method body should be called inside `lock (_certLock)` at every call site (already done in Tasks 3 and 5 above)
- `profiles.remove` handler (line 409-411) — the `ActiveCertificate = null; old?.Dispose()` block (already wrapped in Task 5)
- `profiles.add` handler (inside `Task.Run` at ~line 298) — wrap `LoadActiveCertificate()` call
- `profiles.import` handler (inside `Task.Run` at ~line 353) — wrap `LoadActiveCertificate()` call
- `GetCertHash()` (line 14-15) — wrap the read
- `GetExportableCertificate()` (line 560-563) — wrap the `ActiveCertificate` read
- `SendStatus()` — wrap `ActiveCertificate` reads
- `cert.export` handler — wrap `ActiveCertificate` reads (via `ActiveCertPath` which reads `ActiveCertificate` indirectly)

For `GetCertHash()`:
```csharp
    public string? GetCertHash()
    {
        lock (_certLock) return ActiveCertificate?.Thumbprint?.ToLowerInvariant();
    }
```

For each `Task.Run` call site that calls `LoadActiveCertificate()`:
```csharp
lock (_certLock) { LoadActiveCertificate(); }
```

For `GetExportableCertificate()`:
```csharp
    internal X509Certificate2? GetExportableCertificate()
    {
        lock (_certLock)
        {
            return ActiveCertificate is not null && ActiveCertPath is string path && File.Exists(path)
                ? X509CertificateLoader.LoadPkcs12FromFile(path, password: null, keyStorageFlags: X509KeyStorageFlags.Exportable)
                : null;
        }
    }
```

**Step 3: Build to verify**

Run: `dotnet build`
Expected: Success

**Step 4: Run tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`
Expected: All pass

**Step 5: Commit**

```
git add src/Brmble.Client/Services/Certificate/CertificateService.cs
git commit -m "fix: add _certLock to CertificateService for thread-safe ActiveCertificate access"
```

---

### Task 7: M3 — Fix Tooltips on Disabled Buttons

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx:352-370`

**Step 1: Wrap disabled buttons in span for Tooltip**

Replace the Delete and Edit button sections:

```tsx
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
```

**Step 2: Build to verify**

Run: `npm run build` (in `src/Brmble.Web`)
Expected: Success

**Step 3: Commit**

```
git add src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx
git commit -m "fix: wrap disabled profile buttons in span so Tooltip shows on hover"
```

---

### Task 8: M4 — Fix Export Button to Export Correct Profile

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useProfiles.ts:85-87`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx:374`
- Modify: `src/Brmble.Client/Services/Certificate/CertificateService.cs:676-702`

**Step 1: Pass profile ID in useProfiles.ts**

```ts
  const exportCert = useCallback((profileId?: string) => {
    bridge.send('cert.export', profileId ? { profileId } : {});
  }, []);
```

**Step 2: Pass profile.id in ProfileSettingsTab.tsx**

Change line 374 from:
```tsx
onClick={() => exportCert()}
```
to:
```tsx
onClick={() => exportCert(profile.id)}
```

**Step 3: Update cert.export handler in C#**

In the `ExportCertificate` method (or wherever `cert.export` is handled), accept an optional `profileId`:

Find where `cert.export` is registered. Looking at the handler registration (it should use `bridge.RegisterHandler("cert.export", ...)`). The actual export logic is in `ExportCertificate()` at line 676. Find how it's called:

Update the `cert.export` handler to pass the `profileId` from the message data, and update `ExportCertificate` to accept it:

```csharp
    private void ExportCertificate(string? profileId = null)
    {
        try
        {
            string? certPath;
            string exportName;

            if (profileId != null)
            {
                var profile = _config.GetProfiles().FirstOrDefault(p => p.Id == profileId);
                if (profile == null)
                {
                    _bridge.Send("cert.error", new { message = "Profile not found." });
                    return;
                }
                certPath = FindCertPath(profileId, profile.Name);
                exportName = $"{SanitizeFileName(profile.Name)}.pfx";
            }
            else
            {
                certPath = ActiveCertPath;
                var activeId = _config.GetActiveProfileId();
                var activeProfile = activeId != null ? _config.GetProfiles().FirstOrDefault(p => p.Id == activeId) : null;
                exportName = activeProfile != null ? $"{SanitizeFileName(activeProfile.Name)}.pfx" : "brmble-identity.pfx";
            }

            if (certPath is not string cp || !File.Exists(cp))
            {
                _bridge.Send("cert.error", new { message = "No certificate to export." });
                return;
            }

            var bytes = File.ReadAllBytes(cp);
            var base64 = Convert.ToBase64String(bytes);
            _bridge.Send("cert.exportData", new { data = base64, filename = exportName });
            _bridge.NotifyUiThread();
        }
        catch (Exception ex)
        {
            _bridge.Send("cert.error", new { message = $"Failed to export certificate: {ex.Message}" });
            _bridge.NotifyUiThread();
        }
    }
```

Also update the bridge handler registration to pass the profileId:

```csharp
        bridge.RegisterHandler("cert.export", data =>
        {
            var profileId = data.TryGetProperty("profileId", out var pidEl) ? pidEl.GetString() : null;
            ExportCertificate(profileId);
            return Task.CompletedTask;
        });
```

**Step 4: Build to verify**

Run: `dotnet build && cd src/Brmble.Web && npm run build`
Expected: Success

**Step 5: Commit**

```
git add src/Brmble.Web/src/hooks/useProfiles.ts src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx src/Brmble.Client/Services/Certificate/CertificateService.cs
git commit -m "fix: export correct profile's cert instead of always exporting active profile"
```

---

### Task 9: L3 — Fix CertWizard Button CSS Classes

**Files:**
- Modify: `src/Brmble.Web/src/components/CertWizard/CertWizard.tsx:318,321`

**Step 1: Replace CSS classes**

Change line 318:
```tsx
<button className="cert-wizard-btn ghost" onClick={() => setStep('warning')}>
```
to:
```tsx
<button className="btn btn-ghost" onClick={() => setStep('warning')}>
```

Change line 321:
```tsx
<button className="cert-wizard-btn primary" onClick={handleImportClick}>
```
to:
```tsx
<button className="btn btn-primary" onClick={handleImportClick}>
```

**Step 2: Build to verify**

Run: `npm run build` (in `src/Brmble.Web`)
Expected: Success

**Step 3: Commit**

```
git add src/Brmble.Web/src/components/CertWizard/CertWizard.tsx
git commit -m "fix: use correct btn CSS classes on CertWizard import step buttons"
```

---

### Task 10: Final Build & Test Verification

**Files:**
- None (verification only)

**Step 1: Full frontend build**

Run: `npm run build` (in `src/Brmble.Web`)
Expected: Success

**Step 2: Full dotnet build**

Run: `dotnet build`
Expected: Success (pre-existing CS8604 warning only)

**Step 3: Run all tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj && dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj`
Expected: All pass (55+ client tests including new ones, 68 voice engine tests)
