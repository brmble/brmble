using System.Security.Cryptography.X509Certificates;
using System.Text.RegularExpressions;
using Brmble.Client.Bridge;
using Brmble.Client.Services.AppConfig;

namespace Brmble.Client.Services.Certificate;

internal sealed class CertificateService : IService
{
    public string ServiceName => "cert";

    public X509Certificate2? ActiveCertificate { get; private set; }
    private readonly object _certLock = new();

    public string? GetCertHash()
    {
        lock (_certLock) return ActiveCertificate?.Thumbprint?.ToLowerInvariant();
    }

    private readonly NativeBridge _bridge;
    private readonly IAppConfigService _config;

    /// <summary>Builds the canonical cert filename: {sanitizedName}_{id}.pfx</summary>
    private string GetCertPath(string profileId, string profileName) =>
        Path.Combine(_config.GetCertsDir(), $"{SanitizeFileName(profileName)}_{profileId}.pfx");

    /// <summary>Legacy cert path using only the profile ID.</summary>
    private string GetLegacyCertPath(string profileId) =>
        Path.Combine(_config.GetCertsDir(), profileId + ".pfx");

    /// <summary>
    /// Returns the cert path, preferring the new {name}_{id}.pfx format.
    /// Falls back to the legacy {id}.pfx if the new file doesn't exist.
    /// </summary>
    private string FindCertPath(string profileId, string profileName)
    {
        var preferred = GetCertPath(profileId, profileName);
        if (File.Exists(preferred)) return preferred;
        var legacy = GetLegacyCertPath(profileId);
        if (File.Exists(legacy)) return legacy;
        return preferred; // default to new format even if neither exists
    }

    private string? ActiveCertPath
    {
        get
        {
            var id = _config.GetActiveProfileId();
            if (id == null) return null;
            var profile = _config.GetProfiles().FirstOrDefault(p => p.Id == id);
            return profile != null ? FindCertPath(id, profile.Name) : FindCertPath(id, "");
        }
    }

    /// <summary>
    /// Sanitizes a profile name for use in a filename.
    /// Replaces invalid chars with '_', collapses runs, trims, and caps length.
    /// </summary>
    private static string SanitizeFileName(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "profile";
        var invalid = new HashSet<char>(Path.GetInvalidFileNameChars());
        var sb = new System.Text.StringBuilder(name.Length);
        bool lastWasUnderscore = false;
        foreach (var c in name)
        {
            if (invalid.Contains(c) || c == ' ')
            {
                if (!lastWasUnderscore) { sb.Append('_'); lastWasUnderscore = true; }
            }
            else
            {
                sb.Append(c);
                lastWasUnderscore = false;
            }
        }
        var result = sb.ToString().Trim('_');
        if (result.Length > 50) result = result[..50].TrimEnd('_');
        return result.Length == 0 ? "profile" : result;
    }

    /// <summary>
    /// Regex for valid profile names: Mumble's default allowed charset minus Windows-invalid
    /// filename chars (only '|' is removed). Allows: word chars (\w), -, =, [], {}, (), @, .
    /// No spaces (Mumble disallows them). Trimmed at edges, max 128 chars.
    /// </summary>
    private static readonly Regex ValidProfileNameRegex = new(@"^[-=\w\[\]\{\}\(\)\@\.]+$", RegexOptions.Compiled);

    /// <summary>
    /// Validates a profile name. Returns null if valid, or an error message if invalid.
    /// </summary>
    private static string? ValidateProfileName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
            return "Profile name cannot be empty.";
        var trimmed = name.Trim();
        if (trimmed.Length == 0)
            return "Profile name cannot be empty.";
        if (trimmed.Length > 128)
            return "Profile name must be 128 characters or fewer.";
        if (!ValidProfileNameRegex.IsMatch(trimmed))
            return "Profile name can only contain letters, numbers, and - = _ . [ ] { } ( ) @";
        return null;
    }

    public CertificateService(NativeBridge bridge, IAppConfigService config)
    {
        _bridge = bridge;
        _config = config;
    }

    public void Initialize(NativeBridge bridge)
    {
        // Migrate legacy {id}.pfx cert files to {name}_{id}.pfx
        MigrateCertFileNames();
    }

    /// <summary>
    /// Renames any legacy {id}.pfx cert files to {name}_{id}.pfx format.
    /// Best-effort; failures are silently ignored since FindCertPath falls back to legacy names.
    /// </summary>
    private void MigrateCertFileNames()
    {
        foreach (var profile in _config.GetProfiles())
        {
            var legacyPath = GetLegacyCertPath(profile.Id);
            if (!File.Exists(legacyPath)) continue;

            var newPath = GetCertPath(profile.Id, profile.Name);
            if (string.Equals(legacyPath, newPath, StringComparison.OrdinalIgnoreCase)) continue;
            if (File.Exists(newPath)) continue; // new-style file already exists

            try { File.Move(legacyPath, newPath); }
            catch { /* best-effort */ }
        }
    }

    public void RegisterHandlers(NativeBridge bridge)
    {
        bridge.RegisterHandler("cert.requestStatus", _ =>
        {
            SendStatus();
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("cert.generate", _ =>
        {
            Task.Run(GenerateCertificate);
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("cert.import", data =>
        {
            var base64 = data.TryGetProperty("data", out var d) ? d.GetString() : null;
            if (base64 != null)
                Task.Run(() => ImportCertificate(base64));
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("cert.export", data =>
        {
            var profileId = data.TryGetProperty("profileId", out var pidEl) ? pidEl.GetString() : null;
            Task.Run(() => ExportCertificate(profileId));
            return Task.CompletedTask;
        });

        // ── Profile handlers ──────────────────────────────────────────

        // Check if an existing cert file matches a given profile name
        bridge.RegisterHandler("profiles.checkCert", data =>
        {
            var name = data.TryGetProperty("name", out var n) ? n.GetString() : null;
            if (string.IsNullOrWhiteSpace(name))
            {
                bridge.Send("profiles.checkCertResult", new { exists = false });
                return Task.CompletedTask;
            }
            var sanitized = SanitizeFileName(name!);
            var certsDir = _config.GetCertsDir();
            string? matchedFile = null;
            string? matchedFingerprint = null;
            if (Directory.Exists(certsDir))
            {
                // Look for any .pfx file starting with "{sanitizedName}_"
                var prefix = sanitized + "_";
                foreach (var file in Directory.EnumerateFiles(certsDir, "*.pfx"))
                {
                    var fileName = Path.GetFileName(file);
                    if (fileName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    {
                        // Verify it's a valid cert before offering it
                        try
                        {
                            using var cert = X509CertificateLoader.LoadPkcs12FromFile(file, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);
                            matchedFile = file;
                            matchedFingerprint = cert.Thumbprint;
                        }
                        catch { /* skip invalid files */ }
                        break;
                    }
                }
            }
            bridge.Send("profiles.checkCertResult", new { exists = matchedFile != null, fingerprint = matchedFingerprint });
            return Task.CompletedTask;
        });

        // Create a profile that reuses an existing cert file found by name prefix
        bridge.RegisterHandler("profiles.addFromExisting", data =>
        {
            var name = data.TryGetProperty("name", out var n) ? n.GetString()?.Trim() ?? "" : "";
            var validationError = ValidateProfileName(name);
            if (validationError != null)
            {
                bridge.Send("profiles.error", new { message = validationError });
                return Task.CompletedTask;
            }
            var sanitized = SanitizeFileName(name);
            var certsDir = _config.GetCertsDir();
            var prefix = sanitized + "_";
            string? matchedFile = null;

            if (Directory.Exists(certsDir))
            {
                foreach (var file in Directory.EnumerateFiles(certsDir, "*.pfx"))
                {
                    var fileName = Path.GetFileName(file);
                    if (fileName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    {
                        matchedFile = file;
                        break;
                    }
                }
            }

            if (matchedFile == null)
            {
                bridge.Send("profiles.error", new { message = "No matching certificate found." });
                return Task.CompletedTask;
            }

            try
            {
                // Extract the profile ID from the existing filename: {sanitizedName}_{id}.pfx
                var fileName = Path.GetFileNameWithoutExtension(matchedFile);
                var idPart = fileName.Substring(prefix.Length);

                // Verify the cert loads
                using var cert = X509CertificateLoader.LoadPkcs12FromFile(matchedFile, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);
                var fingerprint = cert.Thumbprint;

                var profile = new ProfileEntry(idPart, name);
                _config.AddProfile(profile);

                if (_config.GetActiveProfileId() == null)
                {
                    _config.SetActiveProfileId(idPart);
                    lock (_certLock) { LoadActiveCertificate(); }
                    bridge.Send("profiles.activeChanged", new { id = idPart, name, fingerprint = GetCertHash() });
                }

                bridge.Send("profiles.added", new { id = idPart, name, fingerprint, certValid = true });
            }
            catch (Exception ex)
            {
                bridge.Send("profiles.error", new { message = $"Failed to reuse certificate: {ex.Message}" });
            }
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("profiles.list", _ =>
        {
            var profiles = _config.GetProfiles().Select(p =>
            {
                var certPath = FindCertPath(p.Id, p.Name);
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
            var name = data.TryGetProperty("name", out var n) ? n.GetString()?.Trim() ?? "" : "";
            var validationError = ValidateProfileName(name);
            if (validationError != null)
            {
                bridge.Send("profiles.error", new { message = validationError });
                return Task.CompletedTask;
            }
            Task.Run(() =>
            {
                try
                {
                    var id = Guid.NewGuid().ToString();
                    var certPath = GetCertPath(id, name);
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
                        lock (_certLock) { LoadActiveCertificate(); }
                        bridge.Send("profiles.activeChanged", new { id, name, fingerprint = GetCertHash() });
                        bridge.NotifyUiThread();
                    }

                    bridge.Send("profiles.added", new { id, name, fingerprint = cert.Thumbprint, certValid = true });
                    bridge.NotifyUiThread();
                }
                catch (Exception ex)
                {
                    bridge.Send("profiles.error", new { message = $"Failed to create profile: {ex.Message}" });
                    bridge.NotifyUiThread();
                }
            });
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("profiles.import", data =>
        {
            var name = data.TryGetProperty("name", out var n) ? n.GetString()?.Trim() ?? "" : "";
            var validationError = ValidateProfileName(name);
            if (validationError != null)
            {
                bridge.Send("profiles.error", new { message = validationError });
                return Task.CompletedTask;
            }
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
                    using var testCert = X509CertificateLoader.LoadPkcs12(bytes, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);
                    var fingerprint = testCert.Thumbprint;

                    var id = Guid.NewGuid().ToString();
                    var certPath = GetCertPath(id, name);
                    Directory.CreateDirectory(Path.GetDirectoryName(certPath)!);
                    File.WriteAllBytes(certPath, bytes);

                    var profile = new ProfileEntry(id, name);
                    _config.AddProfile(profile);

                    if (_config.GetActiveProfileId() == null)
                    {
                        _config.SetActiveProfileId(id);
                        lock (_certLock) { LoadActiveCertificate(); }
                        bridge.Send("profiles.activeChanged", new { id, name, fingerprint });
                        bridge.NotifyUiThread();
                    }

                    bridge.Send("profiles.added", new { id, name, fingerprint, certValid = true });
                    bridge.NotifyUiThread();
                }
                catch (Exception ex)
                {
                    bridge.Send("profiles.error", new { message = $"Failed to import profile: {ex.Message}" });
                    bridge.NotifyUiThread();
                }
            });
            return Task.CompletedTask;
        });

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

        // Rename profile AND swap its cert to an existing cert file matching the new name
        bridge.RegisterHandler("profiles.renameSwapCert", data =>
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

            var sanitized = SanitizeFileName(name);
            var certsDir = _config.GetCertsDir();
            var prefix = sanitized + "_";
            string? matchedFile = null;

            // Find the existing cert file for this name
            if (Directory.Exists(certsDir))
            {
                foreach (var file in Directory.EnumerateFiles(certsDir, "*.pfx"))
                {
                    var fileName = Path.GetFileName(file);
                    if (fileName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    {
                        matchedFile = file;
                        break;
                    }
                }
            }

            if (matchedFile == null)
            {
                bridge.Send("profiles.error", new { message = "No matching certificate found." });
                return Task.CompletedTask;
            }

            try
            {
                // Validate the found cert
                using var cert = X509CertificateLoader.LoadPkcs12FromFile(matchedFile, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);
                var fingerprint = cert.Thumbprint;

                // Find and keep the profile's old cert file path (we won't delete it)
                var oldProfile = _config.GetProfiles().FirstOrDefault(p => p.Id == id);

                // Rename the profile in config
                _config.RenameProfile(id, name);

                // Rename the matched cert file to use this profile's ID: {name}_{id}.pfx
                var targetPath = GetCertPath(id, name);
                if (!string.Equals(matchedFile, targetPath, StringComparison.OrdinalIgnoreCase))
                {
                    try { File.Move(matchedFile, targetPath); }
                    catch { /* best-effort; the file is still valid at its current path */ }
                }

                // Reload active cert if this is the active profile
                if (_config.GetActiveProfileId() == id)
                {
                    lock (_certLock) { LoadActiveCertificate(); }
                    bridge.Send("profiles.activeChanged", new { id, name, fingerprint = GetCertHash() });
                }

                bridge.Send("profiles.renamed", new { id, name, fingerprint, certValid = true });
            }
            catch (Exception ex)
            {
                bridge.Send("profiles.error", new { message = $"Failed to swap certificate: {ex.Message}" });
            }
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("profiles.setActive", data =>
        {
            try
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
                var certHash = GetCertHash();
                bool certExists;
                string? certSubject;
                lock (_certLock)
                {
                    certExists = ActiveCertificate != null;
                    certSubject = ActiveCertificate?.Subject;
                }
                bridge.Send("profiles.activeChanged", new { id, name = profile?.Name, fingerprint = certHash });
                bridge.Send("cert.status", new { exists = certExists, fingerprint = certHash, subject = certSubject });
                // Re-send server list so frontend picks up swapped registration fields
                bridge.Send("servers.list", new { servers = _config.GetServers() });
            }
            catch (Exception ex)
            {
                bridge.Send("profiles.error", new { message = $"Failed to switch profile: {ex.Message}" });
            }
            return Task.CompletedTask;
        });
    }

    /// <summary>
    /// Loads the identity PFX with <see cref="X509KeyStorageFlags.Exportable"/> for use in
    /// BouncyCastle TLS, which needs to extract the private key parameters for signing.
    /// Callers are responsible for disposing the returned instance.
    /// Returns null if no certificate exists.
    /// </summary>
    internal X509Certificate2? GetExportableCertificate()
    {
        lock (_certLock)
        {
            return ActiveCertificate is not null && ActiveCertPath is string path && File.Exists(path)
                ? X509CertificateLoader.LoadPkcs12FromFile(path, password: null, keyStorageFlags: X509KeyStorageFlags.Exportable)
                : null;
        }
    }

    private void LoadActiveCertificate()
    {
        var old = ActiveCertificate;
        ActiveCertificate = null;
        old?.Dispose();
        if (ActiveCertPath is string path && File.Exists(path))
        {
            try
            {
                ActiveCertificate = X509CertificateLoader.LoadPkcs12FromFile(path, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);
            }
            catch { }
        }
    }

    private void SendStatus()
    {
        lock (_certLock) { LoadActiveCertificate(); }
        bool exists;
        string? fingerprint;
        string? subject;
        lock (_certLock)
        {
            exists = ActiveCertificate != null;
            fingerprint = ActiveCertificate?.Thumbprint;
            subject = ActiveCertificate?.Subject;
        }
        if (exists)
        {
            _bridge.Send("cert.status", new
            {
                exists = true,
                fingerprint,
                subject
            });
        }
        else
        {
            _bridge.Send("cert.status", new { exists = false });
        }
    }

    private void GenerateCertificate()
    {
        try
        {
            if (ActiveCertPath is not string certPath)
            {
                _bridge.Send("cert.error", new { message = "No active profile selected." });
                return;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(certPath)!);

            using var ecdsa = System.Security.Cryptography.ECDsa.Create(
                System.Security.Cryptography.ECCurve.NamedCurves.nistP256);

            var req = new System.Security.Cryptography.X509Certificates.CertificateRequest(
                "CN=Brmble User",
                ecdsa,
                System.Security.Cryptography.HashAlgorithmName.SHA256);

            var now = DateTimeOffset.UtcNow;
            using var cert = req.CreateSelfSigned(now, now.AddYears(100));

            // Export WITH private key (PFX = PKCS#12)
            var pfxBytes = cert.Export(X509ContentType.Pfx);
            File.WriteAllBytes(certPath, pfxBytes);

            // Reload from file to get a clean X509Certificate2 (DefaultKeySet — exportable not needed for status display)
            string certFingerprint;
            string certSubject;
            lock (_certLock)
            {
                var oldCert = ActiveCertificate;
                ActiveCertificate = X509CertificateLoader.LoadPkcs12FromFile(certPath, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);
                oldCert?.Dispose();
                certFingerprint = ActiveCertificate.Thumbprint;
                certSubject = ActiveCertificate.Subject;
            }

            _bridge.Send("cert.generated", new
            {
                fingerprint = certFingerprint,
                subject = certSubject
            });
            _bridge.NotifyUiThread();
        }
        catch (Exception ex)
        {
            _bridge.Send("cert.error", new { message = $"Failed to generate certificate: {ex.Message}" });
            _bridge.NotifyUiThread();
        }
    }

    private void ImportCertificate(string base64Data)
    {
        try
        {
            if (ActiveCertPath is not string certPath)
            {
                _bridge.Send("cert.error", new { message = "No active profile selected." });
                return;
            }

            var bytes = Convert.FromBase64String(base64Data);

            // Validate it loads before overwriting (DefaultKeySet — no need for exportable during import validation)
            var testCert = X509CertificateLoader.LoadPkcs12(bytes, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);

            Directory.CreateDirectory(Path.GetDirectoryName(certPath)!);
            File.WriteAllBytes(certPath, bytes);
            string certFingerprint;
            string certSubject;
            lock (_certLock)
            {
                var oldCert = ActiveCertificate;
                ActiveCertificate = testCert;
                oldCert?.Dispose();
                certFingerprint = ActiveCertificate.Thumbprint;
                certSubject = ActiveCertificate.Subject;
            }

            _bridge.Send("cert.imported", new
            {
                fingerprint = certFingerprint,
                subject = certSubject
            });
            _bridge.NotifyUiThread();
        }
        catch (Exception ex)
        {
            _bridge.Send("cert.error", new { message = $"Failed to import certificate: {ex.Message}" });
            _bridge.NotifyUiThread();
        }
    }

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
}
