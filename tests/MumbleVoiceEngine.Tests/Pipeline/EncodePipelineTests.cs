using Microsoft.VisualStudio.TestTools.UnitTesting;
using System.Collections.Generic;
using MumbleVoiceEngine.Pipeline;

namespace MumbleVoiceEngine.Tests.Pipeline
{
    [TestClass]
    public class EncodePipelineTests
    {
        // Mumble varint decoder, just enough for the 1- and 2-byte cases used by the
        // size field at small Opus payloads (≤ ~50 bytes). Returns the decoded value
        // and advances `offset` past the varint.
        private static ulong DecodeVarint(byte[] bytes, ref int offset)
        {
            byte b0 = bytes[offset];
            if ((b0 & 0x80) == 0) { offset += 1; return b0; }                       // 1 byte: 0xxxxxxx
            if ((b0 & 0xC0) == 0x80) { var v = ((ulong)(b0 & 0x3F) << 8) | bytes[offset + 1]; offset += 2; return v; } // 2 bytes: 10xxxxxx ...
            throw new System.NotImplementedException("Larger varints not needed for this test");
        }

        // Skip the type/target byte (1) and the sequence varint, then decode the size
        // varint and check whether the terminator bit (0x2000) is set.
        private static bool HasTerminatorBit(byte[] packet)
        {
            int offset = 1; // skip type/target
            DecodeVarint(packet, ref offset); // sequence
            ulong sizeField = DecodeVarint(packet, ref offset);
            return (sizeField & 0x2000UL) != 0;
        }

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
            Assert.IsTrue(HasTerminatorBit(captured[0]), "Packet must have the 0x2000 terminator bit set in its size varint");
            Assert.AreEqual(1, pipeline.CurrentSequence, "Sequence number must advance by exactly 1");
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
            Assert.IsTrue(HasTerminatorBit(captured[0]), "Packet must have the 0x2000 terminator bit set in its size varint");
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
            Assert.IsTrue(HasTerminatorBit(captured[0]), "First packet (terminator) must have the 0x2000 bit set");
            Assert.IsFalse(HasTerminatorBit(captured[1]), "Second packet (regular SubmitPcm) must NOT have the terminator bit set");
        }
    }
}
