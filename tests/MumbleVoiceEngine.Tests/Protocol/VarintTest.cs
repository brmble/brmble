using System.Linq;
using MumbleVoiceEngine.Protocol;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using System;
using System.IO;

namespace MumbleVoiceEngine.Tests.Protocol
{
    [TestClass]
    public class VarintTest
    {
        [TestMethod]
        public void LeadingOnesInAllBytes()
        {
            for (int i = 0; i <= byte.MaxValue; i++)
            {
                var digits = Convert.ToString(i, 2);
                if (digits.Length < 8)
                    digits = Enumerable.Repeat("0", 8 - digits.Length).Aggregate((a, b) => a + b) + digits;

                var expected = digits.TakeWhile(a => a == '1').Count();
                var actual = PacketReader.LeadingOnes((byte)i);
                Assert.AreEqual(expected, actual);
            }
        }

        private static byte B(string s)
        {
            return Convert.ToByte(s, 2);
        }

        private static PacketReader R(params byte[] bytes)
        {
            return new PacketReader(new MemoryStream(bytes));
        }

        [TestMethod]
        public void VariableLength_ZeroLeadingOnes()
        {
            var expected = B("01001001");
            PacketReader r = R(expected, B("11111111"));
            var actual = r.ReadVarInt64();
            Assert.AreEqual(expected, actual);
        }

        [TestMethod]
        public void VariableLength_OneLeadingOne()
        {
            var expected = B("00101100") << 8 | B("11100101");
            PacketReader r = R(B("10101100"), B("11100101"), B("11111111"));
            var actual = r.ReadVarInt64();
            Assert.AreEqual(expected, actual);
        }

        [TestMethod]
        public void VariableLength_TwoLeadingOnes()
        {
            var expected = B("00010010") << 16 | B("11100101") << 8 | B("11111111");
            PacketReader r = R(B("11010010"), B("11100101"), B("11111111"));
            var actual = r.ReadVarInt64();
            Assert.AreEqual(expected, actual);
        }

        [TestMethod]
        public void VariableLength_ThreeLeadingOnes()
        {
            var expected = B("00000010") << 24 | B("11100101") << 16 | B("11111111") << 8 | B("00001111");
            PacketReader r = R(B("11100010"), B("11100101"), B("11111111"), B("00001111"));
            var actual = r.ReadVarInt64();
            Assert.AreEqual(expected, actual);
        }

        [TestMethod]
        public void VariableLength_FourLeadingOnes_FourBytes()
        {
            var expected = B("11100101") << 24 | B("11111111") << 16 | B("00001111") << 8 | B("10101010");
            PacketReader r = R(B("11110010"), B("11100101"), B("11111111"), B("00001111"), B("10101010"));
            var actual = r.ReadVarInt64();
            Assert.AreEqual(expected, actual);
        }

        [TestMethod]
        public void VariableLength_FourLeadingOnes_EightBytes()
        {
            var expected = B("11100101") << 56 | B("11111111") << 48 | B("00001111") << 40 | B("10101010") << 32 | B("11100101") << 24 | B("11111111") << 16 | B("00001111") << 8 | B("10101010");
            PacketReader r = R(B("11110110"), B("11100101"), B("11111111"), B("00001111"), B("10101010"), B("11100101"), B("11111111"), B("00001111"), B("10101010"));
            var actual = r.ReadVarInt64();
            Assert.AreEqual(expected, actual);
        }

        [TestMethod]
        public void VariableLength_Negative()
        {
            var expected = ~(B("11100101") << 24 | B("10000001") << 16 | B("00001111") << 8 | B("10101010"));
            PacketReader r = R(B("11111000"), B("11110010"), B("11100101"), B("10000001"), B("00001111"), B("10101010"));
            var actual = r.ReadVarInt64();
            Assert.AreEqual(expected, actual);
        }

        [TestMethod]
        public void VariableLength_InvertedTwoBitNumber()
        {
            var expected = ~B("00000000");
            var r = R(B("11111100"));
            var actual = r.ReadVarInt64();
            Assert.AreEqual(expected, actual);

            expected = ~B("00000001");
            r = R(B("11111101"));
            actual = r.ReadVarInt64();
            Assert.AreEqual(expected, actual);

            expected = ~B("00000010");
            r = R(B("11111110"));
            actual = r.ReadVarInt64();
            Assert.AreEqual(expected, actual);

            expected = ~B("00000011");
            r = R(B("11111111"));
            actual = r.ReadVarInt64();
            Assert.AreEqual(expected, actual);
        }

        [TestMethod]
        public void Encode_SmallValue_SingleByte()
        {
            var encoded = Varint.Encode(42);
            Assert.AreEqual(1, encoded.Length);
            Assert.AreEqual(42, encoded[0]);
        }

        [TestMethod]
        public void Encode_Decode_Roundtrip()
        {
            ulong[] values = { 0, 1, 42, 127, 128, 255, 1000, 16383, 16384, 999999 };
            foreach (var value in values)
            {
                var encoded = Varint.Encode(value);
                using var reader = new PacketReader(new MemoryStream(encoded));
                var decoded = reader.ReadVarInt64();
                Assert.AreEqual((long)value, decoded, $"Roundtrip failed for {value}");
            }
        }
    }
}
