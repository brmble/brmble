using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Brmble.Server.Auth;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class CertificateHasherTests
{
    [TestMethod]
    public void HashDer_ReturnsLowercaseHexSha1()
    {
        var der = new byte[] { 0x30, 0x82, 0x01, 0x22 };
        var result = CertificateHasher.HashDer(der);

        var expected = Convert.ToHexStringLower(SHA1.HashData(der));
        Assert.AreEqual(expected, result);
        Assert.AreEqual(result, result.ToLowerInvariant());
    }

    [TestMethod]
    public void HashDer_MatchesX509GetCertHashString()
    {
        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var req = new CertificateRequest("CN=test", ecdsa, HashAlgorithmName.SHA256);
        using var cert = req.CreateSelfSigned(DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddYears(1));

        var fromHasher = CertificateHasher.HashDer(cert.RawData);
        var fromX509 = cert.GetCertHashString(HashAlgorithmName.SHA1).ToLowerInvariant();

        Assert.AreEqual(fromX509, fromHasher);
    }
}
