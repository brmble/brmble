using Microsoft.VisualStudio.TestTools.UnitTesting;
using MumbleVoiceEngine.Codec;
using System;

namespace MumbleVoiceEngine.Tests.Codec
{
    [TestClass]
    public class OpusCodecTest
    {
        [TestMethod]
        public void Encode_Decode_Roundtrip_ProducesSameSampleCount()
        {
            using var encoder = new OpusEncoder(48000, 1) { Bitrate = 72000 };
            using var decoder = new OpusDecoder(48000, 1);

            // 960 samples of 400Hz sine wave at 48kHz
            var pcm = new byte[960 * 2];
            for (int i = 0; i < 960; i++)
            {
                short sample = (short)(Math.Sin(2.0 * Math.PI * 400 * i / 48000) * 16000);
                pcm[i * 2] = (byte)(sample & 0xFF);
                pcm[i * 2 + 1] = (byte)(sample >> 8);
            }

            var encoded = new byte[4000];
            int encodedLen = encoder.Encode(pcm, 0, encoded, 0, 960);
            Assert.IsTrue(encodedLen > 0 && encodedLen < 4000);

            var decoded = new byte[960 * 2];
            int decodedLen = decoder.Decode(encoded, 0, encodedLen, decoded, 0);
            Assert.AreEqual(960 * 2, decodedLen);
        }

        [TestMethod]
        public void Encoder_BitrateProperty_Works()
        {
            using var encoder = new OpusEncoder(48000, 1);
            encoder.Bitrate = 72000;
            Assert.AreEqual(72000, encoder.Bitrate);
        }

        [TestMethod]
        public void Encoder_FecProperty_Works()
        {
            using var encoder = new OpusEncoder(48000, 1);
            encoder.EnableForwardErrorCorrection = true;
            Assert.IsTrue(encoder.EnableForwardErrorCorrection);
        }
    }
}
