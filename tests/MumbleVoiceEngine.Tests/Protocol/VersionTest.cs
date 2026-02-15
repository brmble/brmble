using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace MumbleVoiceEngine.Tests.Protocol
{
    [TestClass]
    public class VersionTest
    {
        [TestMethod]
        public void Version_1_5_0_Encoding()
        {
            uint major = 1;
            uint minor = 5;
            uint patch = 0;

            uint version = (major << 16) | (minor << 8) | patch;

            Assert.AreEqual(0x010500u, version);
            Assert.AreEqual(66816u, version);
        }

        [TestMethod]
        public void Version_1_4_0_Encoding()
        {
            uint major = 1;
            uint minor = 4;
            uint patch = 0;

            uint version = (major << 16) | (minor << 8) | patch;

            Assert.AreEqual(0x010400u, version);
            Assert.AreEqual(66560u, version);
        }

        [TestMethod]
        public void Version_1_2_5_Encoding()
        {
            uint major = 1;
            uint minor = 2;
            uint patch = 5;

            uint version = (major << 16) | (minor << 8) | patch;

            Assert.AreEqual(0x010205u, version);
            Assert.AreEqual(66053u, version);
        }

        [TestMethod]
        public void Version_1_5_0_Decoding()
        {
            uint version = 0x010500;

            uint major = (version >> 16) & 0xFF;
            uint minor = (version >> 8) & 0xFF;
            uint patch = version & 0xFF;

            Assert.AreEqual(1u, major);
            Assert.AreEqual(5u, minor);
            Assert.AreEqual(0u, patch);
        }

        [TestMethod]
        public void VersionV2_1_5_0_Encoding()
        {
            ulong major = 1;
            ulong minor = 5;
            ulong patch = 0;

            ulong versionV2 = (major << 32) | (minor << 16) | patch;

            Assert.AreEqual(4295294976ul, versionV2);
        }

        [TestMethod]
        public void VersionV2_1_5_0_Decoding()
        {
            ulong versionV2 = 4295294976ul;

            ulong major = (versionV2 >> 32) & 0xFFFF;
            ulong minor = (versionV2 >> 16) & 0xFFFF;
            ulong patch = versionV2 & 0xFFFF;

            Assert.AreEqual(1ul, major);
            Assert.AreEqual(5ul, minor);
            Assert.AreEqual(0ul, patch);
        }
    }
}
