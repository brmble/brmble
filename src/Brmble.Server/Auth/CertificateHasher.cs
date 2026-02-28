using System.Security.Cryptography;

namespace Brmble.Server.Auth;

public static class CertificateHasher
{
    public static string HashDer(byte[] der) =>
        Convert.ToHexStringLower(SHA1.HashData(der));
}
