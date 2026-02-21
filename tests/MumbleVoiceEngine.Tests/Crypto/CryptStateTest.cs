using Microsoft.VisualStudio.TestTools.UnitTesting;
using MumbleVoiceEngine.Crypto;
using System;

namespace MumbleVoiceEngine.Tests.Crypto
{
    [TestClass]
    public class CryptStateTest
    {
        private CryptState CreateCryptState()
        {
            var cs = new CryptState();
            var key = new byte[16] { 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
                                     0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f };
            var clientNonce = new byte[16];
            var serverNonce = new byte[16];
            cs.SetKeys(key, clientNonce, serverNonce);
            return cs;
        }

        [TestMethod]
        public void EncryptDecrypt_Roundtrip()
        {
            var sender = CreateCryptState();
            var receiver = CreateCryptState();

            byte[] plaintext = new byte[] { 0x20, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05 };
            byte[] encrypted = sender.Encrypt(plaintext, plaintext.Length);

            Assert.IsNotNull(encrypted);
            Assert.AreEqual(plaintext.Length + 4, encrypted.Length);

            byte[]? decrypted = receiver.Decrypt(encrypted, encrypted.Length);

            Assert.IsNotNull(decrypted, "Decryption returned null - tag verification failed");
            CollectionAssert.AreEqual(plaintext, decrypted);
        }

        [TestMethod]
        public void EncryptDecrypt_MultiplePackets()
        {
            var sender = CreateCryptState();
            var receiver = CreateCryptState();

            for (int i = 0; i < 10; i++)
            {
                byte[] plaintext = new byte[] { 0x20, (byte)i, 0x01, 0x02 };
                byte[] encrypted = sender.Encrypt(plaintext, plaintext.Length);
                byte[]? decrypted = receiver.Decrypt(encrypted, encrypted.Length);

                Assert.IsNotNull(decrypted, $"Packet {i} decryption failed");
                CollectionAssert.AreEqual(plaintext, decrypted);
            }

            Assert.AreEqual(10, receiver.Good);
            Assert.AreEqual(0, receiver.Late);
            Assert.AreEqual(0, receiver.Lost);
        }

        [TestMethod]
        public void Decrypt_CorruptedTag_ReturnsNull()
        {
            var sender = CreateCryptState();
            var receiver = CreateCryptState();

            byte[] plaintext = new byte[] { 0x20, 0x00, 0x01 };
            byte[] encrypted = sender.Encrypt(plaintext, plaintext.Length);

            encrypted[1] ^= 0xFF;

            byte[]? decrypted = receiver.Decrypt(encrypted, encrypted.Length);
            Assert.IsNull(decrypted, "Corrupted packet should return null");
        }

        [TestMethod]
        public void Decrypt_LostPackets_CountsCorrectly()
        {
            // Use non-zero nonce[1] so replay detection doesn't false-positive
            // (decryptHistory defaults to 0, so serverNonce[1] must differ)
            var key = new byte[16] { 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
                                     0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f };
            var clientNonce = new byte[16];
            clientNonce[1] = 1;
            var serverNonce = new byte[16];
            serverNonce[1] = 1;

            var sender = new CryptState();
            sender.SetKeys(key, clientNonce, new byte[16]);

            var receiver = new CryptState();
            receiver.SetKeys(key, new byte[16], serverNonce);

            byte[] p1 = new byte[] { 0x20, 0x01 };
            byte[] p2 = new byte[] { 0x20, 0x02 };
            byte[] p3 = new byte[] { 0x20, 0x03 };
            sender.Encrypt(p1, p1.Length);
            sender.Encrypt(p2, p2.Length);
            byte[] e3 = sender.Encrypt(p3, p3.Length);

            byte[]? d3 = receiver.Decrypt(e3, e3.Length);
            Assert.IsNotNull(d3);
            CollectionAssert.AreEqual(p3, d3);
            Assert.AreEqual(2, receiver.Lost);
        }

        [TestMethod]
        public void Decrypt_TooShort_ReturnsNull()
        {
            var receiver = CreateCryptState();
            byte[] tooShort = new byte[] { 0x01, 0x02, 0x03 };
            Assert.IsNull(receiver.Decrypt(tooShort, tooShort.Length));
        }
    }
}
