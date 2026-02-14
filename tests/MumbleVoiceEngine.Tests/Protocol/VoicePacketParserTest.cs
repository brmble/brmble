using Microsoft.VisualStudio.TestTools.UnitTesting;
using MumbleVoiceEngine.Protocol;
using System.IO;

namespace MumbleVoiceEngine.Tests.Protocol
{
    [TestClass]
    public class VoicePacketParserTest
    {
        [TestMethod]
        public void Parse_OpusPacket_ExtractsFields()
        {
            // Build a voice packet: type=4(Opus)<<5 | target=0, session=1, sequence=42, size=5, data=[1,2,3,4,5]
            var ms = new MemoryStream();
            ms.WriteByte(4 << 5); // type=Opus, target=Normal
            ms.WriteByte(1);      // session=1 (varint)
            ms.WriteByte(42);     // sequence=42 (varint)
            ms.WriteByte(5);      // size=5 (varint, no termination bit)
            ms.Write(new byte[] { 1, 2, 3, 4, 5 }); // opus data

            var result = VoicePacketParser.Parse(ms.ToArray());

            Assert.IsNotNull(result);
            Assert.AreEqual(4, result.Value.Codec);     // Opus
            Assert.AreEqual(0, result.Value.Target);     // Normal
            Assert.AreEqual(1u, result.Value.Session);
            Assert.AreEqual(42L, result.Value.Sequence);
            Assert.AreEqual(5, result.Value.OpusData.Length);
            CollectionAssert.AreEqual(new byte[] { 1, 2, 3, 4, 5 }, result.Value.OpusData);
        }

        [TestMethod]
        public void Parse_PingPacket_ReturnsNull()
        {
            var ping = new byte[] { 1 << 5, 0, 0, 0, 0, 0, 0, 0, 0 }; // type=1 (ping)
            var result = VoicePacketParser.Parse(ping);
            Assert.IsNull(result);
        }

        [TestMethod]
        public void Parse_ZeroSizeOpus_ReturnsNull()
        {
            var ms = new MemoryStream();
            ms.WriteByte(4 << 5);
            ms.WriteByte(1);  // session
            ms.WriteByte(0);  // sequence
            ms.WriteByte(0);  // size=0
            var result = VoicePacketParser.Parse(ms.ToArray());
            Assert.IsNull(result);
        }
    }
}
