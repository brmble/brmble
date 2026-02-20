using Microsoft.VisualStudio.TestTools.UnitTesting;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace Brmble.Client.Tests.Services;

/// <summary>
/// Tests for the X509CertificateLoader paths used in CertificateService.
/// CertificateService was updated from the obsolete X509Certificate2(string/byte[])
/// constructors to X509CertificateLoader.LoadPkcs12FromFile / LoadPkcs12.
/// These tests verify the replacement API works for the PFX format we generate.
/// </summary>
[TestClass]
public class CertificateLoaderTests
{
    private string _tempDir = null!;

    [TestInitialize]
    public void Setup()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(_tempDir);
    }

    [TestCleanup]
    public void Cleanup()
    {
        Directory.Delete(_tempDir, recursive: true);
    }

    private static byte[] CreatePasswordlessPfx()
    {
        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var req = new CertificateRequest("CN=Brmble User", ecdsa, HashAlgorithmName.SHA256);
        var now = DateTimeOffset.UtcNow;
        using var cert = req.CreateSelfSigned(now, now.AddYears(100));
        return cert.Export(X509ContentType.Pfx);
    }

    [TestMethod]
    public void LoadPkcs12FromFile_LoadsPasswordlessPfxAndPreservesSubjectAndThumbprint()
    {
        var pfxBytes = CreatePasswordlessPfx();
        var pfxPath = Path.Combine(_tempDir, "identity.pfx");
        File.WriteAllBytes(pfxPath, pfxBytes);

        // This mirrors the replacement in CertificateService.SendStatus and GenerateCertificate
        var cert = X509CertificateLoader.LoadPkcs12FromFile(pfxPath, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);

        Assert.IsNotNull(cert);
        Assert.AreEqual("CN=Brmble User", cert.Subject);
        Assert.IsFalse(string.IsNullOrEmpty(cert.Thumbprint), "Thumbprint should be non-empty");
        Assert.AreEqual(40, cert.Thumbprint.Length, "SHA-1 thumbprint is 40 hex chars");
    }

    [TestMethod]
    public void LoadPkcs12_LoadsPasswordlessPfxBytesAndPreservesSubjectAndThumbprint()
    {
        var pfxBytes = CreatePasswordlessPfx();

        // This mirrors the replacement in CertificateService.ImportCertificate
        var cert = X509CertificateLoader.LoadPkcs12(pfxBytes, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);

        Assert.IsNotNull(cert);
        Assert.AreEqual("CN=Brmble User", cert.Subject);
        Assert.IsFalse(string.IsNullOrEmpty(cert.Thumbprint), "Thumbprint should be non-empty");
        Assert.AreEqual(40, cert.Thumbprint.Length, "SHA-1 thumbprint is 40 hex chars");
    }

    [TestMethod]
    public void LoadPkcs12FromFile_ThumbprintMatchesLoadPkcs12()
    {
        var pfxBytes = CreatePasswordlessPfx();
        var pfxPath = Path.Combine(_tempDir, "identity.pfx");
        File.WriteAllBytes(pfxPath, pfxBytes);

        var fromFile = X509CertificateLoader.LoadPkcs12FromFile(pfxPath, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);
        var fromBytes = X509CertificateLoader.LoadPkcs12(pfxBytes, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);

        Assert.AreEqual(fromFile.Thumbprint, fromBytes.Thumbprint, "File and byte loading should produce identical certificates");
    }
}
