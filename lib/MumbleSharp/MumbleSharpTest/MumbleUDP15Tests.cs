using Microsoft.VisualStudio.TestTools.UnitTesting;
using System;
using System.IO;
using MumbleProto.UDP;

namespace MumbleSharpTest
{
    [TestClass]
    public class MumbleUDP15Tests
    {
        [TestMethod]
        public void Audio_Serializes_And_Deserializes()
        {
            var audio = new Audio
            {
                SenderSession = 123,
                FrameNumber = 456,
                OpusData = new byte[] { 0x00, 0x01, 0x02 },
                Target = 0
            };

            var bytes = audio.ToByteArray();
            var parsed = Audio.ParseFrom(bytes);

            Assert.AreEqual(123u, parsed.SenderSession);
            Assert.AreEqual(456UL, parsed.FrameNumber);
            Assert.AreEqual(0u, parsed.Target);
            CollectionAssert.AreEqual(new byte[] { 0x00, 0x01, 0x02 }, parsed.OpusData);
        }

        [TestMethod]
        public void Audio_WithContext_Serializes_And_Deserializes()
        {
            var audio = new Audio
            {
                SenderSession = 1,
                FrameNumber = 100,
                Context = 2,
                OpusData = new byte[] { 0xFF, 0xFE },
                IsTerminator = false
            };

            var bytes = audio.ToByteArray();
            var parsed = Audio.ParseFrom(bytes);

            Assert.AreEqual(1u, parsed.SenderSession);
            Assert.AreEqual(100UL, parsed.FrameNumber);
            Assert.AreEqual(2u, parsed.Context);
            Assert.IsFalse(parsed.IsTerminator);
        }

        [TestMethod]
        public void Audio_WithPositionalData_Serializes_And_Deserializes()
        {
            var audio = new Audio
            {
                SenderSession = 5,
                FrameNumber = 10,
                PositionalData = new float[] { 1.5f, 2.5f, 3.5f },
                VolumeAdjustment = 1.5f
            };

            var bytes = audio.ToByteArray();
            var parsed = Audio.ParseFrom(bytes);

            Assert.AreEqual(5u, parsed.SenderSession);
            Assert.AreEqual(10UL, parsed.FrameNumber);
            Assert.IsNotNull(parsed.PositionalData);
            Assert.AreEqual(3, parsed.PositionalData.Length);
            Assert.AreEqual(1.5f, parsed.PositionalData[0]);
            Assert.AreEqual(2.5f, parsed.PositionalData[1]);
            Assert.AreEqual(3.5f, parsed.PositionalData[2]);
            Assert.AreEqual(1.5f, parsed.VolumeAdjustment);
        }

        [TestMethod]
        public void Audio_Terminator_Serializes_And_Deserializes()
        {
            var audio = new Audio
            {
                SenderSession = 1,
                FrameNumber = 1000,
                IsTerminator = true,
                OpusData = Array.Empty<byte>()
            };

            var bytes = audio.ToByteArray();
            var parsed = Audio.ParseFrom(bytes);

            Assert.AreEqual(1u, parsed.SenderSession);
            Assert.AreEqual(1000UL, parsed.FrameNumber);
            Assert.IsTrue(parsed.IsTerminator);
        }

        [TestMethod]
        public void Ping_Serializes_And_Deserializes()
        {
            var ping = new Ping
            {
                Timestamp = 12345
            };

            var bytes = ping.ToByteArray();
            var parsed = Ping.ParseFrom(bytes);

            Assert.AreEqual(12345UL, parsed.Timestamp);
        }

        [TestMethod]
        public void Ping_WithExtendedInfo_Serializes_And_Deserializes()
        {
            var ping = new Ping
            {
                Timestamp = 99999,
                RequestExtendedInformation = true,
                ServerVersionV2 = 0x105000,
                UserCount = 10,
                MaxUserCount = 100,
                MaxBandwidthPerUser = 72000
            };

            var bytes = ping.ToByteArray();
            var parsed = Ping.ParseFrom(bytes);

            Assert.AreEqual(99999UL, parsed.Timestamp);
            Assert.IsTrue(parsed.RequestExtendedInformation);
            Assert.AreEqual(0x105000UL, parsed.ServerVersionV2);
            Assert.AreEqual(10u, parsed.UserCount);
            Assert.AreEqual(100u, parsed.MaxUserCount);
            Assert.AreEqual(72000u, parsed.MaxBandwidthPerUser);
        }

        [TestMethod]
        public void VersionDetection_15AtThreshold()
        {
            ulong version15 = 0x105000;
            bool is15OrHigher = (version15 >= 0x105000);
            Assert.IsTrue(is15OrHigher);
        }

        [TestMethod]
        public void VersionDetection_14BelowThreshold()
        {
            ulong version14 = 0x104000;
            bool is15OrHigher = (version14 >= 0x105000);
            Assert.IsFalse(is15OrHigher);
        }

        [TestMethod]
        public void VersionDetection_16AboveThreshold()
        {
            ulong version16 = 0x106000;
            bool is15OrHigher = (version16 >= 0x105000);
            Assert.IsTrue(is15OrHigher);
        }
    }
}
