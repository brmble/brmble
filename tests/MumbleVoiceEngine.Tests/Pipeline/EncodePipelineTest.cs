using Microsoft.VisualStudio.TestTools.UnitTesting;
using MumbleVoiceEngine.Pipeline;
using MumbleVoiceEngine.Protocol;
using System;
using System.Collections.Generic;
using System.IO;

namespace MumbleVoiceEngine.Tests.Pipeline
{
    [TestClass]
    public class EncodePipelineTest
    {
        [TestMethod]
        public void SubmitPcm_ProducesVoicePacket()
        {
            var packets = new List<byte[]>();
            var pipeline = new EncodePipeline(
                sampleRate: 48000,
                channels: 1,
                bitrate: 72000,
                onPacketReady: (data) => packets.Add(data.ToArray())
            );

            // Submit exactly one Opus frame (960 samples = 1920 bytes)
            var pcm = new byte[960 * 2];
            pipeline.SubmitPcm(pcm);

            Assert.AreEqual(1, packets.Count);

            // Verify it's a valid client→server voice packet
            // Format: [type|target(1), sequence(varint), size(varint), opusData...]
            byte[] pkt = packets[0];
            Assert.AreEqual((byte)(4 << 5), pkt[0]); // type=Opus, target=0

            using var reader = new PacketReader(new MemoryStream(pkt, 1, pkt.Length - 1));
            long seq = reader.ReadVarInt64();
            Assert.AreEqual(0L, seq);

            int size = (int)reader.ReadVarInt64();
            Assert.IsTrue(size > 0, "Opus encoded data should be non-empty");
        }

        [TestMethod]
        public void SubmitPartialFrame_NoPacketUntilFull()
        {
            var packets = new List<byte[]>();
            var pipeline = new EncodePipeline(
                sampleRate: 48000,
                channels: 1,
                bitrate: 72000,
                onPacketReady: (data) => packets.Add(data.ToArray())
            );

            // Submit half a frame (960 bytes = 480 samples)
            pipeline.SubmitPcm(new byte[960]);
            Assert.AreEqual(0, packets.Count);

            // Submit other half
            pipeline.SubmitPcm(new byte[960]);
            Assert.AreEqual(1, packets.Count);
        }

        [TestMethod]
        public void SequenceNumber_Increments()
        {
            var packets = new List<byte[]>();
            var pipeline = new EncodePipeline(
                sampleRate: 48000,
                channels: 1,
                bitrate: 72000,
                onPacketReady: (data) => packets.Add(data.ToArray())
            );

            pipeline.SubmitPcm(new byte[960 * 2]); // frame 0
            pipeline.SubmitPcm(new byte[960 * 2]); // frame 1

            Assert.AreEqual(2, packets.Count);

            // Parse sequence numbers from client→server packets
            using var reader0 = new PacketReader(new MemoryStream(packets[0], 1, packets[0].Length - 1));
            Assert.AreEqual(0L, reader0.ReadVarInt64());

            using var reader1 = new PacketReader(new MemoryStream(packets[1], 1, packets[1].Length - 1));
            Assert.AreEqual(1L, reader1.ReadVarInt64());
        }

        [TestMethod]
        public void SetTarget_ReflectedInPacket()
        {
            var packets = new List<byte[]>();
            var pipeline = new EncodePipeline(
                sampleRate: 48000,
                channels: 1,
                bitrate: 72000,
                onPacketReady: (data) => packets.Add(data.ToArray())
            );

            pipeline.SetTarget(3);
            pipeline.SubmitPcm(new byte[960 * 2]);

            Assert.AreEqual(1, packets.Count);
            Assert.AreEqual((byte)((4 << 5) | 3), packets[0][0]);
        }
    }
}
