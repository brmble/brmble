using System.Security.Cryptography;
using System.Text;

namespace Brmble.Client.Services.Security;

public class SecurePasswordStorage : ISecurePasswordStorage
{
    private const string Prefix = "DPAPI:";
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Brmble.SecureStorage.v1");

    public string Encrypt(string plainText)
    {
        var plainBytes = Encoding.UTF8.GetBytes(plainText);
        var checksum = SHA256.HashData(plainBytes);
        var payload = new byte[checksum.Length + plainBytes.Length];
        Buffer.BlockCopy(checksum, 0, payload, 0, checksum.Length);
        Buffer.BlockCopy(plainBytes, 0, payload, checksum.Length, plainBytes.Length);
        var encryptedBytes = ProtectedData.Protect(payload, Entropy, DataProtectionScope.CurrentUser);
        return Prefix + Convert.ToBase64String(encryptedBytes);
    }

    public string Decrypt(string encryptedBase64)
    {
        if (!TryDecrypt(encryptedBase64, out var plainText))
        {
            throw new CryptographicException("Failed to decrypt the data. The data may be corrupted or was encrypted by a different user.");
        }
        return plainText!;
    }

    public bool TryDecrypt(string encryptedBase64, out string? plainText)
    {
        plainText = null;

        if (!IsEncrypted(encryptedBase64))
        {
            return false;
        }

        try
        {
            var base64 = encryptedBase64.Substring(Prefix.Length);
            var encryptedBytes = Convert.FromBase64String(base64);
            var payload = ProtectedData.Unprotect(encryptedBytes, Entropy, DataProtectionScope.CurrentUser);

            if (payload.Length < 32)
            {
                return false;
            }

            var storedChecksum = new byte[32];
            var actualChecksum = new byte[32];
            Buffer.BlockCopy(payload, 0, storedChecksum, 0, 32);
            Buffer.BlockCopy(payload, 0, actualChecksum, 0, 32);

            var plainBytes = new byte[payload.Length - 32];
            Buffer.BlockCopy(payload, 32, plainBytes, 0, plainBytes.Length);

            var computedChecksum = SHA256.HashData(plainBytes);

            if (!CryptographicOperations.FixedTimeEquals(storedChecksum, computedChecksum))
            {
                return false;
            }

            plainText = Encoding.UTF8.GetString(plainBytes);
            return true;
        }
        catch (CryptographicException)
        {
            return false;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    public bool IsEncrypted(string value)
    {
        if (string.IsNullOrEmpty(value) || !value.StartsWith(Prefix))
        {
            return false;
        }

        var base64 = value.Substring(Prefix.Length);
        if (string.IsNullOrEmpty(base64))
        {
            return false;
        }

        try
        {
            Convert.FromBase64String(base64);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
