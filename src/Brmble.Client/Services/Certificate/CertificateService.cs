using System.Security.Cryptography.X509Certificates;
using Brmble.Client.Bridge;
using Brmble.Client.Services.AppConfig;

namespace Brmble.Client.Services.Certificate;

internal sealed class CertificateService : IService
{
    public string ServiceName => "cert";

    public X509Certificate2? ActiveCertificate { get; private set; }

    public string? GetCertHash() =>
        ActiveCertificate?.Thumbprint?.ToLowerInvariant();

    private readonly NativeBridge _bridge;
    private readonly IAppConfigService _config;

    private string GetCertPath(string profileId) =>
        Path.Combine(_config.GetCertsDir(), profileId + ".pfx");

    private string? ActiveCertPath =>
        _config.GetActiveProfileId() is string id ? GetCertPath(id) : null;

    public CertificateService(NativeBridge bridge, IAppConfigService config)
    {
        _bridge = bridge;
        _config = config;
    }

    public void Initialize(NativeBridge bridge) { }

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

        bridge.RegisterHandler("cert.export", _ =>
        {
            Task.Run(ExportCertificate);
            return Task.CompletedTask;
        });

        // ── Profile handlers ──────────────────────────────────────────

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
                    var old = ActiveCertificate;
                    ActiveCertificate = null;
                    old?.Dispose();
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

            _config.SetActiveProfileId(id);
            LoadActiveCertificate();

            var profile = _config.GetProfiles().FirstOrDefault(p => p.Id == id);
            bridge.Send("profiles.activeChanged", new { id, name = profile?.Name, fingerprint = ActiveCertificate?.Thumbprint });
            bridge.Send("cert.status", new { exists = ActiveCertificate != null, fingerprint = ActiveCertificate?.Thumbprint, subject = ActiveCertificate?.Subject });
            return Task.CompletedTask;
        });
    }

    /// <summary>
    /// Loads the identity PFX with <see cref="X509KeyStorageFlags.Exportable"/> for use in
    /// BouncyCastle TLS, which needs to extract the private key parameters for signing.
    /// Callers are responsible for disposing the returned instance.
    /// Returns null if no certificate exists.
    /// </summary>
    internal X509Certificate2? GetExportableCertificate() =>
        ActiveCertificate is not null && ActiveCertPath is string path && File.Exists(path)
            ? X509CertificateLoader.LoadPkcs12FromFile(path, password: null, keyStorageFlags: X509KeyStorageFlags.Exportable)
            : null;

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
            var oldCert = ActiveCertificate;
            ActiveCertificate = X509CertificateLoader.LoadPkcs12FromFile(certPath, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);
            oldCert?.Dispose();

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
            var oldCert = ActiveCertificate;
            ActiveCertificate = testCert;
            oldCert?.Dispose();

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

    private void ExportCertificate()
    {
        try
        {
            if (ActiveCertPath is not string certPath || !File.Exists(certPath))
            {
                _bridge.Send("cert.error", new { message = "No certificate to export." });
                return;
            }

            var bytes = File.ReadAllBytes(certPath);
            var base64 = Convert.ToBase64String(bytes);
            _bridge.Send("cert.exportData", new { data = base64, filename = "brmble-identity.pfx" });
        }
        catch (Exception ex)
        {
            _bridge.Send("cert.error", new { message = $"Failed to export certificate: {ex.Message}" });
        }
    }
}
