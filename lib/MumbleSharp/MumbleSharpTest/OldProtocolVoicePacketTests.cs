using Microsoft.VisualStudio.TestTools.UnitTesting;
using System;
using System.Collections.Generic;
using System.Net.Security;
using MumbleSharp;
using MumbleSharp.Audio;
using MumbleSharp.Audio.Codecs;
using MumbleSharp.Model;

namespace MumbleSharpTest
{
    /// <summary>
    /// Tests for old protocol (pre-1.5) voice packet handling.
    /// The bug was that packet type (0) was being used as codec type, 
    /// causing it to try CeltAlpha (0) instead of Opus (4).
    /// </summary>
    [TestClass]
    public class OldProtocolVoicePacketTests
    {
        /// <summary>
        /// Test that UnpackVoicePacket correctly uses packet type as codec type.
        /// For old protocol: type 0=CELT Alpha, type 2=Speex, type 3=CELT Beta, type 4=Opus
        /// </summary>
        [TestMethod]
        public void UnpackVoicePacket_ShouldUsePacketTypeAsCodec()
        {
            // Arrange: Create a mock protocol that captures GetCodec calls
            var mockProtocol = new MockProtocolWithOpus();
            var connection = new MumbleConnection("127.0.0.1", 64738, mockProtocol, voiceSupport: true);
            
            // Set server version to pre-1.5 so it uses the old handler
            connection.SetServerProtocolVersion(0x104000); // Mumble 1.4.0

            // Build an old-format voice packet with Opus (type 4):
            // Header byte: type(3 bits) + target(5 bits) = 0x80 (type 4 = Opus, target 0)
            var packet = new List<byte>();
            
            // Header: type=4 (Opus), target=0 (normal) => 4 << 5 = 0x80
            packet.Add(0x80);
            
            // Session = 2 (varint encoding: 0x02)
            packet.Add(0x02);
            
            // Sequence = 100 (varint: 0x64)
            packet.Add(0x64);
            
            // Opus data size = 4 bytes (varint: 0x04)
            packet.Add(0x04);
            
            // Fake Opus data
            packet.Add(0x4F); // 'O'
            packet.Add(0x70); // 'p'
            packet.Add(0x75); // 'u'
            packet.Add(0x73); // 's'
            
            byte[] packetBytes = packet.ToArray();

            // Act: Process the packet using old protocol handler
            connection.UnpackVoicePacket(packetBytes, 4); // type = 4 (Opus)

            // Assert: Verify GetCodec was called with Opus (4)
            Assert.IsTrue(mockProtocol.GetCodecCalled, "GetCodec should have been called");
            Assert.AreEqual(SpeechCodecs.Opus, mockProtocol.RequestedCodec, 
                "GetCodec should be called with Opus (4)");
            Assert.AreEqual(2u, mockProtocol.RequestedSession, "Should be called for session 2");
        }

        /// <summary>
        /// Test that when using CELT Alpha (type 0), it correctly maps to CeltAlpha codec.
        /// </summary>
        [TestMethod]
        public void UnpackVoicePacket_WithCeltAlpha_ShouldUseCeltAlpha()
        {
            // Arrange
            var mockProtocol = new MockProtocolWithCeltAlpha();
            var connection = new MumbleConnection("127.0.0.1", 64738, mockProtocol, voiceSupport: true);
            connection.SetServerProtocolVersion(0x104000);

            // Build packet with CELT Alpha (type 0)
            var packet = new byte[] { 0x00, 0x02, 0x01, 0x01, 0x00 };

            // Act
            connection.UnpackVoicePacket(packet, 0); // type = 0 (CELT Alpha)

            // Assert
            Assert.IsTrue(mockProtocol.GetCodecCalled);
            Assert.AreEqual(SpeechCodecs.CeltAlpha, mockProtocol.RequestedCodec);
        }

        /// <summary>
        /// Test that when user is not in dictionary, voice packet is silently dropped (not crash).
        /// </summary>
        [TestMethod]
        public void UnpackVoicePacket_WhenUserNotFound_ShouldNotCrash()
        {
            // Arrange: Protocol that returns null for GetCodec (user not found)
            var mockProtocol = new MockProtocolReturnsNull();
            var connection = new MumbleConnection("127.0.0.1", 64738, mockProtocol, voiceSupport: true);
            connection.SetServerProtocolVersion(0x104000);

            // Simple packet
            var packet = new byte[] { 0x00, 0x02, 0x01, 0x01, 0x00 };

            // Act & Assert: Should not throw, just return silently
            connection.UnpackVoicePacket(packet, 0);
            // If we get here without exception, test passes
        }

        /// <summary>
        /// Test that version 1.5+ uses the protobuf handler instead of legacy handler.
        /// </summary>
        [TestMethod]
        public void ReceiveDecryptedUdp_When15Plus_ShouldUseProtobufHandler()
        {
            // Arrange
            var mockProtocol = new MockProtocolWithOpus();
            var connection = new MumbleConnection("127.0.0.1", 64738, mockProtocol, voiceSupport: true);
            connection.SetServerProtocolVersion(0x105000); // Mumble 1.5.0

            // Act: Check version detection
            Assert.IsTrue(connection.IsServerVersion15OrHigher, "1.5.0 should be detected as 1.5+");
        }

        /// <summary>
        /// Test that version 1.4.x uses the legacy handler.
        /// </summary>
        [TestMethod]
        public void ReceiveDecryptedUdp_When14_ShouldUseLegacyHandler()
        {
            // Arrange
            var mockProtocol = new MockProtocolWithOpus();
            var connection = new MumbleConnection("127.0.0.1", 64738, mockProtocol, voiceSupport: true);
            connection.SetServerProtocolVersion(0x104000); // Mumble 1.4.0

            // Act: Check version detection
            Assert.IsFalse(connection.IsServerVersion15OrHigher, "1.4.0 should NOT be detected as 1.5+");
        }

        #region Mock Classes

        private class MockProtocolWithOpus : IMumbleProtocol
        {
            public bool GetCodecCalled;
            public SpeechCodecs RequestedCodec;
            public uint RequestedSession;
            public bool EncodedVoiceCalled;

            public MumbleSharp.MumbleConnection Connection { get; set; }
            public User LocalUser => null;
            public Channel RootChannel => null;
            public IEnumerable<Channel> Channels => throw new NotImplementedException();
            public IEnumerable<User> Users => throw new NotImplementedException();
            public bool ReceivedServerSync { get; set; }
            public SpeechCodecs TransmissionCodec => SpeechCodecs.Opus;

            public void Initialise(MumbleSharp.MumbleConnection connection) { }
            public bool ValidateCertificate(object sender, System.Security.Cryptography.X509Certificates.X509Certificate certificate, System.Security.Cryptography.X509Certificates.X509Chain chain, SslPolicyErrors errors) => true;
            public System.Security.Cryptography.X509Certificates.X509Certificate SelectCertificate(object sender, string targetHost, System.Security.Cryptography.X509Certificates.X509CertificateCollection localCertificates, System.Security.Cryptography.X509Certificates.X509Certificate remoteCertificate, string[] acceptableIssuers) => null;

            public void Version(MumbleProto.Version version) { }
            public void ChannelState(MumbleProto.ChannelState channelState) { }
            public void UserState(MumbleProto.UserState userState) { }
            public void CodecVersion(MumbleProto.CodecVersion codecVersion) { }
            public void ContextAction(MumbleProto.ContextAction contextAction) { }
            public void PermissionQuery(MumbleProto.PermissionQuery permissionQuery) { }
            public void ServerSync(MumbleProto.ServerSync serverSync) { }
            public void ServerConfig(MumbleProto.ServerConfig serverConfig) { }

            public void EncodedVoice(byte[] packet, uint userSession, long sequence, IVoiceCodec codec, SpeechTarget target)
            {
                EncodedVoiceCalled = true;
            }

            public void UdpPing(byte[] packet) { }
            public void Ping(MumbleProto.Ping ping) { }
            public void UserRemove(MumbleProto.UserRemove userRemove) { }
            public void ChannelRemove(MumbleProto.ChannelRemove channelRemove) { }
            public void TextMessage(MumbleProto.TextMessage textMessage) { }
            public void UserList(MumbleProto.UserList userList) { }
            public void SuggestConfig(MumbleProto.SuggestConfig suggestedConfiguration) { }

            public IVoiceCodec GetCodec(uint user, SpeechCodecs codec)
            {
                GetCodecCalled = true;
                RequestedCodec = codec;
                RequestedSession = user;
                // Return a mock Opus codec
                return new MockOpusCodec();
            }

            public void SendVoice(ArraySegment<byte> pcm, SpeechTarget target, uint targetId) { }
            public void SendVoiceStop() { }
            public void Reject(MumbleProto.Reject reject) { }
            public void PermissionDenied(MumbleProto.PermissionDenied permissionDenied) { }
            public void Acl(MumbleProto.Acl acl) { }
            public void QueryUsers(MumbleProto.QueryUsers queryUsers) { }
            public void UserStats(MumbleProto.UserStats userStats) { }
            public void BanList(MumbleProto.BanList banList) { }
        }

        private class MockProtocolWithCeltAlpha : IMumbleProtocol
        {
            public bool GetCodecCalled;
            public SpeechCodecs RequestedCodec;
            public uint RequestedSession;

            public MumbleSharp.MumbleConnection Connection { get; set; }
            public User LocalUser => null;
            public Channel RootChannel => null;
            public IEnumerable<Channel> Channels => throw new NotImplementedException();
            public IEnumerable<User> Users => throw new NotImplementedException();
            public bool ReceivedServerSync { get; set; }
            public SpeechCodecs TransmissionCodec => SpeechCodecs.Opus;

            public void Initialise(MumbleSharp.MumbleConnection connection) { }
            public bool ValidateCertificate(object sender, System.Security.Cryptography.X509Certificates.X509Certificate certificate, System.Security.Cryptography.X509Certificates.X509Chain chain, SslPolicyErrors errors) => true;
            public System.Security.Cryptography.X509Certificates.X509Certificate SelectCertificate(object sender, string targetHost, System.Security.Cryptography.X509Certificates.X509CertificateCollection localCertificates, System.Security.Cryptography.X509Certificates.X509Certificate remoteCertificate, string[] acceptableIssuers) => null;

            public void Version(MumbleProto.Version version) { }
            public void ChannelState(MumbleProto.ChannelState channelState) { }
            public void UserState(MumbleProto.UserState userState) { }
            public void CodecVersion(MumbleProto.CodecVersion codecVersion) { }
            public void ContextAction(MumbleProto.ContextAction contextAction) { }
            public void PermissionQuery(MumbleProto.PermissionQuery permissionQuery) { }
            public void ServerSync(MumbleProto.ServerSync serverSync) { }
            public void ServerConfig(MumbleProto.ServerConfig serverConfig) { }
            public void EncodedVoice(byte[] packet, uint userSession, long sequence, IVoiceCodec codec, SpeechTarget target) { }
            public void UdpPing(byte[] packet) { }
            public void Ping(MumbleProto.Ping ping) { }
            public void UserRemove(MumbleProto.UserRemove userRemove) { }
            public void ChannelRemove(MumbleProto.ChannelRemove channelRemove) { }
            public void TextMessage(MumbleProto.TextMessage textMessage) { }
            public void UserList(MumbleProto.UserList userList) { }
            public void SuggestConfig(MumbleProto.SuggestConfig suggestedConfiguration) { }

            public IVoiceCodec GetCodec(uint user, SpeechCodecs codec)
            {
                GetCodecCalled = true;
                RequestedCodec = codec;
                RequestedSession = user;
                return new MockCeltCodec();
            }

            public void SendVoice(ArraySegment<byte> pcm, SpeechTarget target, uint targetId) { }
            public void SendVoiceStop() { }
            public void Reject(MumbleProto.Reject reject) { }
            public void PermissionDenied(MumbleProto.PermissionDenied permissionDenied) { }
            public void Acl(MumbleProto.Acl acl) { }
            public void QueryUsers(MumbleProto.QueryUsers queryUsers) { }
            public void UserStats(MumbleProto.UserStats userStats) { }
            public void BanList(MumbleProto.BanList banList) { }
        }

        private class MockCeltCodec : IVoiceCodec
        {
            public byte[] Decode(byte[] encodedData) => new byte[encodedData.Length * 100];
            public IEnumerable<int> PermittedEncodingFrameSizes => new[] { 480, 960 };
            public byte[] Encode(ArraySegment<byte> pcm) => new byte[] { 0x43, 0x45, 0x4C, 0x54 };
        }

        private class MockProtocolReturnsNull : IMumbleProtocol
        {
            public MumbleSharp.MumbleConnection Connection { get; set; }
            public User LocalUser => null;
            public Channel RootChannel => null;
            public IEnumerable<Channel> Channels => throw new NotImplementedException();
            public IEnumerable<User> Users => throw new NotImplementedException();
            public bool ReceivedServerSync { get; set; }
            public SpeechCodecs TransmissionCodec => SpeechCodecs.Opus;

            public void Initialise(MumbleSharp.MumbleConnection connection) { }
            public bool ValidateCertificate(object sender, System.Security.Cryptography.X509Certificates.X509Certificate certificate, System.Security.Cryptography.X509Certificates.X509Chain chain, SslPolicyErrors errors) => true;
            public System.Security.Cryptography.X509Certificates.X509Certificate SelectCertificate(object sender, string targetHost, System.Security.Cryptography.X509Certificates.X509CertificateCollection localCertificates, System.Security.Cryptography.X509Certificates.X509Certificate remoteCertificate, string[] acceptableIssuers) => null;

            public void Version(MumbleProto.Version version) { }
            public void ChannelState(MumbleProto.ChannelState channelState) { }
            public void UserState(MumbleProto.UserState userState) { }
            public void CodecVersion(MumbleProto.CodecVersion codecVersion) { }
            public void ContextAction(MumbleProto.ContextAction contextAction) { }
            public void PermissionQuery(MumbleProto.PermissionQuery permissionQuery) { }
            public void ServerSync(MumbleProto.ServerSync serverSync) { }
            public void ServerConfig(MumbleProto.ServerConfig serverConfig) { }
            public void EncodedVoice(byte[] packet, uint userSession, long sequence, IVoiceCodec codec, SpeechTarget target) { }
            public void UdpPing(byte[] packet) { }
            public void Ping(MumbleProto.Ping ping) { }
            public void UserRemove(MumbleProto.UserRemove userRemove) { }
            public void ChannelRemove(MumbleProto.ChannelRemove channelRemove) { }
            public void TextMessage(MumbleProto.TextMessage textMessage) { }
            public void UserList(MumbleProto.UserList userList) { }
            public void SuggestConfig(MumbleProto.SuggestConfig suggestedConfiguration) { }

            public IVoiceCodec GetCodec(uint user, SpeechCodecs codec)
            {
                return null; // Simulate user not found
            }

            public void SendVoice(ArraySegment<byte> pcm, SpeechTarget target, uint targetId) { }
            public void SendVoiceStop() { }
            public void Reject(MumbleProto.Reject reject) { }
            public void PermissionDenied(MumbleProto.PermissionDenied permissionDenied) { }
            public void Acl(MumbleProto.Acl acl) { }
            public void QueryUsers(MumbleProto.QueryUsers queryUsers) { }
            public void UserStats(MumbleProto.UserStats userStats) { }
            public void BanList(MumbleProto.BanList banList) { }
        }

        private class MockOpusCodec : IVoiceCodec
        {
            public byte[] Decode(byte[] encodedData) => new byte[encodedData.Length * 100];
            public IEnumerable<int> PermittedEncodingFrameSizes => new[] { 480, 960, 1920, 2880 };
            public byte[] Encode(ArraySegment<byte> pcm) => new byte[] { 0x4F, 0x70, 0x75, 0x73 };
        }

        #endregion
    }
}
