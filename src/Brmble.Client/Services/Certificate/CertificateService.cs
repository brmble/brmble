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
    private void ImportCertificate() { }                   // Task 4
    private void ExportCertificate() { }                   // Task 5
}
