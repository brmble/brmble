using System.Security.Cryptography.X509Certificates;

namespace Brmble.Server;

/// <summary>
/// Self-signed TLS certificate for the Brmble API server (CN=noscope.it, valid 10 years).
/// Generated with: openssl req -x509 -newkey rsa:2048 -days 3650 -nodes -subj "/CN=noscope.it"
/// </summary>
internal static class ServerCertificate
{
    private const string Pfx =
        "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";

    public static X509Certificate2 Get() =>
        X509CertificateLoader.LoadPkcs12(Convert.FromBase64String(Pfx), password: null);
}
