using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Client.Services.Security;
using System.Security.Cryptography;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class SecurePasswordStorageTests
{
    private ISecurePasswordStorage _storage = null!;

    [TestInitialize]
    public void Setup()
    {
        _storage = new SecurePasswordStorage();
    }

    [TestMethod]
    public void Encrypt_ReturnsDpapiPrefixedBase64()
    {
        var plainText = "mySecretPassword";

        var encrypted = _storage.Encrypt(plainText);

        Assert.IsTrue(encrypted.StartsWith("DPAPI:"), "Encrypted value should start with DPAPI: prefix");
        var base64 = encrypted.Substring(6);
        Assert.IsTrue(IsValidBase64(base64), "Should contain valid base64 after prefix");
    }

    [TestMethod]
    public void Decrypt_Roundtrip_ReturnsOriginalText()
    {
        var plainText = "mySecretPassword123!@#";

        var encrypted = _storage.Encrypt(plainText);
        var decrypted = _storage.Decrypt(encrypted);

        Assert.AreEqual(plainText, decrypted);
    }

    [TestMethod]
    public void Encrypt_SameInput_ProducesDifferentOutput()
    {
        var plainText = "testPassword";

        var encrypted1 = _storage.Encrypt(plainText);
        var encrypted2 = _storage.Encrypt(plainText);

        Assert.AreNotEqual(encrypted1, encrypted2, "DPAPI with entropy should produce different ciphertexts");
        Assert.AreEqual(plainText, _storage.Decrypt(encrypted1));
        Assert.AreEqual(plainText, _storage.Decrypt(encrypted2));
    }

    [TestMethod]
    public void IsEncrypted_ReturnsTrue_ForDpapiEncryptedValue()
    {
        var encrypted = _storage.Encrypt("password");

        Assert.IsTrue(_storage.IsEncrypted(encrypted));
    }

    [TestMethod]
    public void IsEncrypted_ReturnsFalse_ForPlainText()
    {
        var plainText = "just a regular password";

        Assert.IsFalse(_storage.IsEncrypted(plainText));
    }

    [TestMethod]
    public void IsEncrypted_ReturnsFalse_ForInvalidBase64WithoutPrefix()
    {
        var invalidValue = "not-valid-base64!!!";

        Assert.IsFalse(_storage.IsEncrypted(invalidValue));
    }

    [TestMethod]
    public void IsEncrypted_ReturnsFalse_ForDpapiPrefixWithoutValidBase64()
    {
        var invalidValue = "DPAPI:!!!not-valid-base64";

        Assert.IsFalse(_storage.IsEncrypted(invalidValue));
    }

    [TestMethod]
    public void TryDecrypt_ReturnsTrue_ForValidEncryptedValue()
    {
        var plainText = "recoverablePassword";
        var encrypted = _storage.Encrypt(plainText);

        var success = _storage.TryDecrypt(encrypted, out var decrypted);

        Assert.IsTrue(success);
        Assert.AreEqual(plainText, decrypted);
    }

    [TestMethod]
    public void TryDecrypt_ReturnsFalse_ForPlainText()
    {
        var plainText = "notEncrypted";

        var success = _storage.TryDecrypt(plainText, out var decrypted);

        Assert.IsFalse(success);
        Assert.IsNull(decrypted);
    }

    [TestMethod]
    public void TryDecrypt_ReturnsFalse_ForTamperedData()
    {
        var encrypted = _storage.Encrypt("password");
        var tampered = encrypted.Substring(0, encrypted.Length - 1) + "X";

        var success = _storage.TryDecrypt(tampered, out var decrypted);

        Assert.IsFalse(success);
        Assert.IsNull(decrypted);
    }

    [TestMethod]
    [ExpectedException(typeof(CryptographicException))]
    public void Decrypt_ThrowsOnInvalidData()
    {
        var plainText = "not-encrypted-value";

        _storage.Decrypt(plainText);
    }

    [TestMethod]
    public void Decrypt_HandlesSpecialCharacters()
    {
        var plainText = "p@$$w0rd!#%^&*()_+-=[]{}|;':\",./<>?`~";

        var encrypted = _storage.Encrypt(plainText);
        var decrypted = _storage.Decrypt(encrypted);

        Assert.AreEqual(plainText, decrypted);
    }

    [TestMethod]
    public void Decrypt_HandlesUnicodeCharacters()
    {
        var plainText = "пароль密码🔐";

        var encrypted = _storage.Encrypt(plainText);
        var decrypted = _storage.Decrypt(encrypted);

        Assert.AreEqual(plainText, decrypted);
    }

    [TestMethod]
    public void Decrypt_HandlesEmptyString()
    {
        var plainText = "";

        var encrypted = _storage.Encrypt(plainText);
        var decrypted = _storage.Decrypt(encrypted);

        Assert.AreEqual(plainText, decrypted);
    }

    private static bool IsValidBase64(string value)
    {
        if (string.IsNullOrEmpty(value)) return false;
        try
        {
            Convert.FromBase64String(value);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
