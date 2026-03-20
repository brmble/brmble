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
