using Microsoft.VisualStudio.TestTools.UnitTesting;
using MumbleVoiceEngine.Crypto;

namespace MumbleVoiceEngine.Tests.Crypto
{
    [TestClass]
    public class OcbAesTest
    {
        private static readonly byte[] TestKey = { 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f };
        private static readonly byte[] TestNonce = { 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01 };

        private void AssertArraysEqual<T>(T[] expected, T[] actual)
        {
            Assert.AreEqual(expected.Length, actual.Length);
            for (int i = 0; i < expected.Length; i++)
                Assert.AreEqual(expected[i], actual[i]);
        }

        /// <summary>
        /// Encrypt then decrypt, verify plaintext recovered and tags match.
        /// Tests the OCB2 (S2/S3) algorithm used by Mumble's CryptStateOCB2.
        /// Note: The old OCB1 reference test vectors are NOT compatible with this implementation.
        /// </summary>
        private void RoundTrip(byte[] plaintext)
        {
            var ocb = new OcbAes();
            ocb.Initialise(TestKey);

            byte[] encTag = new byte[16];
            byte[] ct = ocb.Encrypt(plaintext, 0, plaintext.Length, TestNonce, 0, encTag, 0);

            Assert.AreEqual(plaintext.Length, ct.Length);

            // Ciphertext should differ from plaintext (unless empty)
            if (plaintext.Length > 0)
                Assert.IsFalse(plaintext.SequenceEqual(ct), "Ciphertext should differ from plaintext");

            // Tag should be non-zero
            Assert.IsTrue(encTag.Any(b => b != 0), "Tag should be non-zero");

            byte[] decTag = new byte[16];
            byte[] pt2 = ocb.Decrypt(ct, 0, ct.Length, TestNonce, 0, decTag, 0);

            AssertArraysEqual(plaintext, pt2);
            AssertArraysEqual(encTag, decTag);
        }

        [TestMethod]
        public void RoundTrip_0B() => RoundTrip(new byte[0]);

        [TestMethod]
        public void RoundTrip_3B() => RoundTrip(new byte[] { 0x00, 0x01, 0x02 });

        [TestMethod]
        public void RoundTrip_15B() => RoundTrip(Enumerable.Range(0, 15).Select(i => (byte)i).ToArray());

        [TestMethod]
        public void RoundTrip_16B() => RoundTrip(Enumerable.Range(0, 16).Select(i => (byte)i).ToArray());

        [TestMethod]
        public void RoundTrip_20B() => RoundTrip(Enumerable.Range(0, 20).Select(i => (byte)i).ToArray());

        [TestMethod]
        public void RoundTrip_32B() => RoundTrip(Enumerable.Range(0, 32).Select(i => (byte)i).ToArray());

        [TestMethod]
        public void RoundTrip_34B() => RoundTrip(Enumerable.Range(0, 34).Select(i => (byte)i).ToArray());

        [TestMethod]
        public void RoundTrip_100B() => RoundTrip(Enumerable.Range(0, 100).Select(i => (byte)i).ToArray());

        [TestMethod]
        public void DifferentNonces_ProduceDifferentCiphertext()
        {
            var ocb = new OcbAes();
            ocb.Initialise(TestKey);

            byte[] pt = Enumerable.Range(0, 20).Select(i => (byte)i).ToArray();
            byte[] nonce1 = new byte[16]; nonce1[15] = 1;
            byte[] nonce2 = new byte[16]; nonce2[15] = 2;

            byte[] tag1 = new byte[16];
            byte[] ct1 = ocb.Encrypt(pt, 0, pt.Length, nonce1, 0, tag1, 0);

            byte[] tag2 = new byte[16];
            byte[] ct2 = ocb.Encrypt(pt, 0, pt.Length, nonce2, 0, tag2, 0);

            Assert.IsFalse(ct1.SequenceEqual(ct2), "Different nonces should produce different ciphertext");
            Assert.IsFalse(tag1.SequenceEqual(tag2), "Different nonces should produce different tags");
        }

        [TestMethod]
        public void WrongKey_ProducesDifferentTag()
        {
            byte[] pt = Enumerable.Range(0, 20).Select(i => (byte)i).ToArray();

            var ocb1 = new OcbAes();
            ocb1.Initialise(TestKey);
            byte[] tag1 = new byte[16];
            ocb1.Encrypt(pt, 0, pt.Length, TestNonce, 0, tag1, 0);

            var ocb2 = new OcbAes();
            byte[] key2 = new byte[16]; key2[0] = 0xFF;
            ocb2.Initialise(key2);
            byte[] tag2 = new byte[16];
            ocb2.Encrypt(pt, 0, pt.Length, TestNonce, 0, tag2, 0);

            Assert.IsFalse(tag1.SequenceEqual(tag2), "Different keys should produce different tags");
        }

        [TestMethod]
        public void MumbleTypicalPacketSize_RoundTrip()
        {
            // Typical Mumble voice packet: ~90 bytes Opus + header
            var pt = new byte[90];
            new Random(42).NextBytes(pt);
            RoundTrip(pt);
        }
    }
}
