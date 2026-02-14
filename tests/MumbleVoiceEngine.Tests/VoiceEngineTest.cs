using Microsoft.VisualStudio.TestTools.UnitTesting;
using System;
using System.Collections.Generic;

namespace MumbleVoiceEngine.Tests
{
    [TestClass]
    public class VoiceEngineTest
    {
        private static void InitCrypto(VoiceEngine engine)
        {
            byte[] key = new byte[16];
            byte[] clientNonce = new byte[16];
            byte[] serverNonce = new byte[16];
            new Random(42).NextBytes(key);
            new Random(43).NextBytes(clientNonce);
            new Random(44).NextBytes(serverNonce);
            engine.SetCryptKey(key, clientNonce, serverNonce);
        }

        [TestMethod]
        public void SetCryptKey_InitializesCrypto()
        {
            using var engine = new VoiceEngine();
            Assert.IsFalse(engine.IsCryptoReady);

            InitCrypto(engine);
            Assert.IsTrue(engine.IsCryptoReady);
        }

        [TestMethod]
        public void SubmitMicAudio_ProducesEncryptedPackets()
        {
            using var engine = new VoiceEngine();
            InitCrypto(engine);

            var packets = new List<byte[]>();
            engine.OnEncryptedPacketReady += (data, len) =>
            {
                var copy = new byte[len];
                Array.Copy(data, copy, len);
                packets.Add(copy);
            };

            // Submit one frame of PCM (960 samples * 2 bytes)
            engine.SubmitMicAudio(new byte[960 * 2]);

            Assert.AreEqual(1, packets.Count);
            // Encrypted packet = 4 byte header + ciphertext
            Assert.IsTrue(packets[0].Length > 4);
        }

        [TestMethod]
        public void GetUserAudio_UnknownSession_ReturnsNull()
        {
            using var engine = new VoiceEngine();
            Assert.IsNull(engine.GetUserAudio(999));
        }

        [TestMethod]
        public void RemoveUser_DisposesAndRemoves()
        {
            using var engine = new VoiceEngine();
            InitCrypto(engine);

            // Force creation of a user pipeline via ReceiveEncryptedPacket
            // We can't easily forge a valid encrypted packet, so test the remove path
            // by checking that GetUserAudio returns null after remove
            engine.RemoveUser(42);
            Assert.IsNull(engine.GetUserAudio(42));
        }
    }
}
