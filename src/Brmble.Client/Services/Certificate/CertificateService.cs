using System.Security.Cryptography.X509Certificates;
using Brmble.Client.Bridge;

namespace Brmble.Client.Services.Certificate;

internal sealed class CertificateService : IService
{
    public string ServiceName => "cert";

    public X509Certificate2? ActiveCertificate { get; private set; }

    public string? GetCertHash() =>
        ActiveCertificate?.Thumbprint?.ToLowerInvariant();

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
        ActiveCertificate is not null && File.Exists(CertPath)
            ? X509CertificateLoader.LoadPkcs12FromFile(CertPath, password: null, keyStorageFlags: X509KeyStorageFlags.Exportable)
            : null;

    private void SendStatus()
    {
        if (File.Exists(CertPath))
        {
            try
            {
                ActiveCertificate = X509CertificateLoader.LoadPkcs12FromFile(CertPath, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);
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

    private void GenerateCertificate()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(CertPath)!);

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
            File.WriteAllBytes(CertPath, pfxBytes);

            // Reload from file to get a clean X509Certificate2 (DefaultKeySet — exportable not needed for status display)
            ActiveCertificate = X509CertificateLoader.LoadPkcs12FromFile(CertPath, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);

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
            var bytes = Convert.FromBase64String(base64Data);

            // Validate it loads before overwriting (DefaultKeySet — no need for exportable during import validation)
            var testCert = X509CertificateLoader.LoadPkcs12(bytes, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);

            Directory.CreateDirectory(Path.GetDirectoryName(CertPath)!);
            File.WriteAllBytes(CertPath, bytes);
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
    private void ExportCertificate()
    {
        try
        {
            if (!File.Exists(CertPath))
            {
                _bridge.Send("cert.error", new { message = "No certificate to export." });
                return;
            }

            var bytes = File.ReadAllBytes(CertPath);
            var base64 = Convert.ToBase64String(bytes);
            _bridge.Send("cert.exportData", new { data = base64, filename = "brmble-identity.pfx" });
        }
        catch (Exception ex)
        {
            _bridge.Send("cert.error", new { message = $"Failed to export certificate: {ex.Message}" });
        }
    }
}
