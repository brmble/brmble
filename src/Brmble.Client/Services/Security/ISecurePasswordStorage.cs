namespace Brmble.Client.Services.Security;

public interface ISecurePasswordStorage
{
    string Encrypt(string plainText);
    string Decrypt(string encryptedBase64);
    bool TryDecrypt(string encryptedBase64, out string? plainText);
    bool IsEncrypted(string value);
}
