// src/Brmble.Server/Auth/ICertificateHashExtractor.cs
using System.Security.Cryptography;

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
        return cert?.GetCertHashString(HashAlgorithmName.SHA1).ToLowerInvariant();
    }
}
