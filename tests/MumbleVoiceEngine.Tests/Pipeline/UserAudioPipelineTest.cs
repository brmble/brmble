using Microsoft.VisualStudio.TestTools.UnitTesting;
using MumbleVoiceEngine.Codec;
using MumbleVoiceEngine.Pipeline;
using System;
using System.Linq;

namespace MumbleVoiceEngine.Tests.Pipeline
{
    [TestClass]
    public class UserAudioPipelineTest
    {
        private static byte[] EncodeSineFrame(OpusEncoder encoder, int seq)
        {
            var pcmIn = new byte[960 * 2];
            for (int i = 0; i < 960; i++)
            {
                short s = (short)(Math.Sin(2.0 * Math.PI * 400 * i / 48000) * 16000);
                pcmIn[i * 2] = (byte)(s & 0xFF);
                pcmIn[i * 2 + 1] = (byte)(s >> 8);
            }
            var encoded = new byte[4000];
            int encLen = encoder.Encode(pcmIn, 0, encoded, 0, 960);
            var opusData = new byte[encLen];
            Array.Copy(encoded, opusData, encLen);
            return opusData;
        }

        [TestMethod]
        public void FeedOpus_ReadPcm_ProducesAudio()
        {
            using var pipeline = new UserAudioPipeline(sampleRate: 48000, channels: 1);
            using var encoder = new OpusEncoder(48000, 1) { Bitrate = 72000 };

            pipeline.FeedEncodedPacket(EncodeSineFrame(encoder, 0), sequence: 0);

            var pcmOut = new byte[960 * 2];
            int read = pipeline.Read(pcmOut, 0, pcmOut.Length);

            Assert.AreEqual(960 * 2, read);
            Assert.IsTrue(pcmOut.Any(b => b != 0));
        }

        [TestMethod]
        public void NoData_Read_ReturnsSilence()
        {
            using var pipeline = new UserAudioPipeline(sampleRate: 48000, channels: 1);
            var pcm = new byte[960 * 2];
            int read = pipeline.Read(pcm, 0, pcm.Length);
            Assert.AreEqual(960 * 2, read);
            Assert.IsTrue(pcm.All(b => b == 0)); // silence
        }

        [TestMethod]
        public void MultiplePackets_ReadAll_ProducesAudio()
        {
            using var pipeline = new UserAudioPipeline(sampleRate: 48000, channels: 1);
            using var encoder = new OpusEncoder(48000, 1) { Bitrate = 72000 };

            for (int seq = 0; seq < 3; seq++)
                pipeline.FeedEncodedPacket(EncodeSineFrame(encoder, seq), sequence: seq);

            // Read all 3 frames worth of PCM
            var pcmOut = new byte[960 * 2 * 3];
            int read = pipeline.Read(pcmOut, 0, pcmOut.Length);
            Assert.AreEqual(960 * 2 * 3, read);
            Assert.IsTrue(pcmOut.Any(b => b != 0));
        }

        [TestMethod]
        public void WaveFormat_Is48kHz_16bit_Mono()
        {
            using var pipeline = new UserAudioPipeline(sampleRate: 48000, channels: 1);
            Assert.AreEqual(48000, pipeline.WaveFormat.SampleRate);
            Assert.AreEqual(16, pipeline.WaveFormat.BitsPerSample);
            Assert.AreEqual(1, pipeline.WaveFormat.Channels);
        }
    }
}
