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
    }
}
