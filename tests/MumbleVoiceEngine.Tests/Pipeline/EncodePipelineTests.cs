using Microsoft.VisualStudio.TestTools.UnitTesting;
using System.Collections.Generic;
using MumbleVoiceEngine.Pipeline;

namespace MumbleVoiceEngine.Tests.Pipeline
{
    [TestClass]
    public class EncodePipelineTests
    {
        [TestMethod]
        public void EmitTerminator_with_empty_accumulator_emits_one_packet_with_terminator_flag()
        {
            var captured = new List<byte[]>();
            var pipeline = new EncodePipeline(
                sampleRate: 48000, channels: 1, bitrate: 72000,
                onPacketReady: m => captured.Add(m.ToArray()),
                frameSize: 480);

            pipeline.EmitTerminator();

            Assert.AreEqual(1, captured.Count, "Expected exactly one packet emitted on terminator with empty accumulator");
            // Packet layout: [typeTarget][seq varint][size varint][opus]
            // The size varint has bit 0x2000 OR'd in for terminator. Easiest assertion:
            // the packet must contain a non-empty payload (Opus frame for ~10 ms of zeros).
            Assert.IsTrue(captured[0].Length > 4);
        }

        [TestMethod]
        public void EmitTerminator_with_partial_accumulator_emits_padded_packet_with_terminator_flag()
        {
            var captured = new List<byte[]>();
            var pipeline = new EncodePipeline(
                sampleRate: 48000, channels: 1, bitrate: 72000,
                onPacketReady: m => captured.Add(m.ToArray()),
                frameSize: 480);

            // Submit half a frame (480 samples * 2 bytes = 960 bytes for full frame; half = 240 * 2 = 480 bytes)
            pipeline.SubmitPcm(new byte[240 * 2]);
            Assert.AreEqual(0, captured.Count, "Half a frame should not yet emit a packet");

            pipeline.EmitTerminator();

            Assert.AreEqual(1, captured.Count, "EmitTerminator should flush the partial frame");
        }

        [TestMethod]
        public void Pipeline_continues_emitting_packets_after_EmitTerminator()
        {
            var captured = new List<byte[]>();
            var pipeline = new EncodePipeline(
                sampleRate: 48000, channels: 1, bitrate: 72000,
                onPacketReady: m => captured.Add(m.ToArray()),
                frameSize: 480);

            pipeline.EmitTerminator();           // 1 packet (empty accumulator path)
            pipeline.SubmitPcm(new byte[480 * 2]); // 2 packets total
            Assert.AreEqual(2, captured.Count);
        }
    }
}
