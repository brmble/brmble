namespace Brmble.Server.Auth;

public interface ICertificateHashExtractor
{
    string? GetCertHash(HttpContext context);
}

public class MtlsCertificateHashExtractor : ICertificateHashExtractor
{
    public string? GetCertHash(HttpContext context)
    {
        var cert = context.Connection.ClientCertificate;
        return cert is null ? null : CertificateHasher.HashDer(cert.RawData);
    }
}
