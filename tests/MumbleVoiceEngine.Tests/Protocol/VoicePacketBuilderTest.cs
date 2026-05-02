using Microsoft.VisualStudio.TestTools.UnitTesting;
using MumbleVoiceEngine.Protocol;
using System.IO;

namespace MumbleVoiceEngine.Tests.Protocol
{
    [TestClass]
    public class VoicePacketBuilderTest
    {
        [TestMethod]
        public void Build_OpusPacket_CorrectFormat()
        {
            byte[] opusData = new byte[] { 0xAA, 0xBB, 0xCC };
            byte[] packet = VoicePacketBuilder.Build(opusData, sequenceNumber: 42, target: 0);

            // Client→server packets: [type|target, sequence(varint), size(varint), data...]
            Assert.AreEqual((byte)(4 << 5), packet[0]); // type=Opus, target=0

            // Read sequence with PacketReader
            using var reader = new PacketReader(new MemoryStream(packet, 1, packet.Length - 1));
            long seq = reader.ReadVarInt64();
            Assert.AreEqual(42L, seq);

            int size = (int)reader.ReadVarInt64();
            Assert.AreEqual(3, size);

            byte[]? data = reader.ReadBytes(size);
            Assert.IsNotNull(data);
            CollectionAssert.AreEqual(opusData, data);
        }

        [TestMethod]
        public void Build_LargeSequence_EncodesCorrectly()
        {
            byte[] opusData = new byte[100];
            byte[] packet = VoicePacketBuilder.Build(opusData, sequenceNumber: 999999, target: 0);

            using var reader = new PacketReader(new MemoryStream(packet, 1, packet.Length - 1));
            long seq = reader.ReadVarInt64();
            Assert.AreEqual(999999L, seq);
        }

        [TestMethod]
        public void Build_WithTarget_PreservesTarget()
        {
            byte[] opusData = new byte[] { 1, 2, 3 };
            byte[] packet = VoicePacketBuilder.Build(opusData, sequenceNumber: 0, target: 5);

            // Verify type|target byte
            Assert.AreEqual((byte)((4 << 5) | 5), packet[0]);
        }

        [TestMethod]
        public void Build_WithTerminator_SetsBit13InSize()
        {
            byte[] opusData = new byte[] { 0xAA, 0xBB, 0xCC };
            byte[] packet = VoicePacketBuilder.Build(opusData, sequenceNumber: 0, target: 0, terminator: true);

            using var reader = new PacketReader(new MemoryStream(packet, 1, packet.Length - 1));
            reader.ReadVarInt64(); // sequence
            int rawSize = (int)reader.ReadVarInt64();

            Assert.AreEqual(0x2000, rawSize & 0x2000, "Terminator bit (0x2000) must be set");
            Assert.AreEqual(3, rawSize & 0x1FFF, "Lower 13 bits must encode payload length");
        }

        [TestMethod]
        public void Build_WithoutTerminator_LeavesBit13Unset()
        {
            byte[] opusData = new byte[] { 0xAA, 0xBB, 0xCC };
            byte[] packet = VoicePacketBuilder.Build(opusData, sequenceNumber: 0, target: 0, terminator: false);

            using var reader = new PacketReader(new MemoryStream(packet, 1, packet.Length - 1));
            reader.ReadVarInt64(); // sequence
            int rawSize = (int)reader.ReadVarInt64();

            Assert.AreEqual(0, rawSize & 0x2000, "Terminator bit must NOT be set");
            Assert.AreEqual(3, rawSize, "Plain length without terminator");
        }

        [TestMethod]
        public void Build_WithTerminator_RemainsParseable()
        {
            // Receivers mask 0x2000 off — the payload must still parse correctly.
            byte[] opusData = new byte[] { 0xAA, 0xBB, 0xCC };
            byte[] clientPacket = VoicePacketBuilder.Build(opusData, sequenceNumber: 7, target: 0, terminator: true);

            // Simulate server prepending session ID (parser expects server format)
            byte[] sessionVarint = Varint.Encode(1);
            byte[] serverPacket = new byte[1 + sessionVarint.Length + clientPacket.Length - 1];
            serverPacket[0] = clientPacket[0];
            Array.Copy(sessionVarint, 0, serverPacket, 1, sessionVarint.Length);
            Array.Copy(clientPacket, 1, serverPacket, 1 + sessionVarint.Length, clientPacket.Length - 1);

            var parsed = VoicePacketParser.Parse(serverPacket);
            Assert.IsNotNull(parsed);
            Assert.AreEqual(7L, parsed.Value.Sequence);
            CollectionAssert.AreEqual(opusData, parsed.Value.OpusData);
        }

        [TestMethod]
        public void Build_Parse_ViaServerFormat_RoundTrips()
        {
            // Simulate server relaying: take builder output, prepend session ID
            byte[] opusData = new byte[] { 0xAA, 0xBB, 0xCC };
            byte[] clientPacket = VoicePacketBuilder.Build(opusData, sequenceNumber: 42, target: 0);

            // Server adds session ID after the type byte
            byte[] sessionVarint = Varint.Encode(7); // session=7
            byte[] serverPacket = new byte[1 + sessionVarint.Length + clientPacket.Length - 1];
            serverPacket[0] = clientPacket[0]; // type|target
            Array.Copy(sessionVarint, 0, serverPacket, 1, sessionVarint.Length);
            Array.Copy(clientPacket, 1, serverPacket, 1 + sessionVarint.Length, clientPacket.Length - 1);

            var parsed = VoicePacketParser.Parse(serverPacket);
            Assert.IsNotNull(parsed);
            Assert.AreEqual(7u, parsed.Value.Session);
            Assert.AreEqual(42L, parsed.Value.Sequence);
            CollectionAssert.AreEqual(opusData, parsed.Value.OpusData);
        }
    }
}
