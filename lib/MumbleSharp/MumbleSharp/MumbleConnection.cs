using MumbleProto;
using MumbleSharp.Audio;
using MumbleSharp.Audio.Codecs;
using MumbleSharp.Packets;
using ProtoBuf;
using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography.X509Certificates;

namespace MumbleSharp
{
    /// <summary>
    /// Handles the low level details of connecting to a mumble server. Once connection is established decoded packets are passed off to the MumbleProtocol for processing
    /// </summary>
    public class MumbleConnection
    {
        private static double PING_DELAY_MILLISECONDS = 5000;

        public float? TcpPingAverage { get; set; }
        public float? TcpPingVariance { get; set; }
        public uint? TcpPingPackets { get; set; }

        public ConnectionStates State { get; private set; }

        TcpSocket _tcp;
        UdpSocket _udp;

        DateTime _lastSentPing = DateTime.MinValue;

        public IMumbleProtocol Protocol { get; private set; }

        /// <summary>
        /// Whether or not voice support is unabled with this connection
        /// </summary>
        public bool VoiceSupportEnabled { get; private set; }

        public IPEndPoint Host
        {
            get;
            private set;
        }

        readonly CryptState _cryptState = new CryptState();

        private bool _isServerVersion15OrHigher;
        private ulong _serverProtocolVersion;

        public bool IsServerVersion15OrHigher => _isServerVersion15OrHigher;

        public void SetServerProtocolVersion(ulong version)
        {
            _serverProtocolVersion = version;
            _isServerVersion15OrHigher = (version >= 0x105000);
        }

        private VoicePacketHandler15 _voicePacketHandler15;

        /// <summary>
        /// Creates a connection to the server using the given address and port.
        /// </summary>
        /// <param name="server">The server adress or IP.</param>
        /// <param name="port">The port the server listens to.</param>
        /// <param name="protocol">An object which will handle messages from the server.</param>
        /// <param name="voiceSupport">Whether or not voice support is unabled with this connection.</param>
        public MumbleConnection(string server, int port, IMumbleProtocol protocol, bool voiceSupport = true)
            : this(new IPEndPoint(Dns.GetHostAddresses(server).First(a => a.AddressFamily == AddressFamily.InterNetwork), port), protocol, voiceSupport)
        {
        }

        /// <summary>
        /// Creates a connection to the server
        /// </summary>
        /// <param name="host"></param>
        /// <param name="protocol"></param>
        /// <param name="voiceSupport">Whether or not voice support is unabled with this connection.</param>
        public MumbleConnection(IPEndPoint host, IMumbleProtocol protocol, bool voiceSupport = true)
        {
            Host = host;
            State = ConnectionStates.Disconnected;
            Protocol = protocol;
            VoiceSupportEnabled = voiceSupport;
            _voicePacketHandler15 = new VoicePacketHandler15(this);
        }

        public void Connect(string username, string password, string[] tokens, string serverName)
        {
            if (State != ConnectionStates.Disconnected)
                throw new InvalidOperationException(string.Format("Cannot start connecting MumbleConnection when connection state is {0}", State));

            State = ConnectionStates.Connecting;
            Protocol.Initialise(this);

            _tcp = new TcpSocket(Host, Protocol, this);
            _tcp.Connect(username, password, tokens, serverName);

            _udp = new UdpSocket(Host, Protocol, this);
            _udp.Connect();

            State = ConnectionStates.Connected;
        }

        public void Close()
        {
            State = ConnectionStates.Disconnecting;

            _udp?.Close();
            _tcp?.Close();

            State = ConnectionStates.Disconnected;
        }

        /// <summary>
        /// Processes a received network packet.
        /// This method should be called periodically.
        /// </summary>
        /// <returns>true, if a packet was processed. When this returns true you may want to recall the Process() method as soon as possible as their might be a queue on the network stack (like after a simple Thread.Yield() instead of a more relaxed Thread.Sleep(1) if it returned false).</returns>
        public bool Process()
        {
            if ((DateTime.UtcNow - _lastSentPing).TotalMilliseconds > PING_DELAY_MILLISECONDS)
            {
                _tcp.SendPing();

                if (_udp.IsConnected)
                    SendEncryptedUdpPing();

                _lastSentPing = DateTime.UtcNow;
            }

            _tcpProcessed = _tcp.Process();
            _udpProcessed = _udp.IsConnected ? _udp.Process() : false;
            return _tcpProcessed || _udpProcessed;
        }
        //declared outside method for alloc optimization
        private bool _tcpProcessed;
        private bool _udpProcessed;

        public void SendControl<T>(PacketType type, T packet)
        {
            _tcp.Send<T>(type, packet);
        }

        private void SendEncryptedUdpPing()
        {
            // CryptState not yet initialized (no CryptSetup from server yet)
            if (!_cryptState.Initialized)
                return;

            // Build the raw ping payload (same format as UdpSocket.SendPing)
            long timestamp = DateTime.UtcNow.Ticks;
            byte[] pingData = new byte[9];
            pingData[0] = 1 << 5; // Ping type
            pingData[1] = (byte)((timestamp >> 56) & 0xFF);
            pingData[2] = (byte)((timestamp >> 48) & 0xFF);
            pingData[3] = (byte)((timestamp >> 40) & 0xFF);
            pingData[4] = (byte)((timestamp >> 32) & 0xFF);
            pingData[5] = (byte)((timestamp >> 24) & 0xFF);
            pingData[6] = (byte)((timestamp >> 16) & 0xFF);
            pingData[7] = (byte)((timestamp >> 8) & 0xFF);
            pingData[8] = (byte)((timestamp) & 0xFF);

            // Encrypt before sending — server requires all UDP to be OCB-AES128 encrypted
            byte[] encrypted = _cryptState.Encrypt(pingData, pingData.Length);
            if (encrypted != null)
                _udp.Send(encrypted, encrypted.Length);
        }

        /// <summary>
        /// When true, voice is sent via TCP tunnel even if UDP is connected.
        /// </summary>
        public bool ForceTcp { get; set; }

        public void SendVoice(ArraySegment<byte> packet)
        {
            //The packet must be a well formed Mumble packet as described in https://mumble-protocol.readthedocs.org/en/latest/voice_data.html#packet-format
            //The packet is created in BasicMumbleProtocol's EncodingThread

            if (!VoiceSupportEnabled)
                throw new InvalidOperationException("Voice Support is disabled with this connection");

            if (!ForceTcp && _udp != null && _udp.IsConnected)
            {
                // Encrypt and send via UDP
                byte[] voiceData = new byte[packet.Count];
                Buffer.BlockCopy(packet.Array, packet.Offset, voiceData, 0, packet.Count);
                byte[] encrypted = _cryptState.Encrypt(voiceData, voiceData.Length);
                if (encrypted != null)
                    _udp.Send(encrypted, encrypted.Length);
                else
                    _tcp.SendVoice(PacketType.UDPTunnel, packet); // Encryption failed, fallback to TCP
            }
            else
            {
                _tcp.SendVoice(PacketType.UDPTunnel, packet); // TCP tunnel fallback
            }
        }

        internal void ReceivedEncryptedUdp(byte[] packet)
        {
            byte[] plaintext = _cryptState.Decrypt(packet, packet.Length);

            if (plaintext == null)
                return;

            ReceiveDecryptedUdp(plaintext);
        }

        internal void ReceiveDecryptedUdp(byte[] packet)
        {
            var type = packet[0] >> 5 & 0x7;

            if (type == 1)
            {
                if (_isServerVersion15OrHigher && packet.Length > 1)
                {
                    try
                    {
                        var pingData = new byte[packet.Length - 1];
                        Array.Copy(packet, 1, pingData, 0, packet.Length - 1);
                        var ping = MumbleProto.UDP.Ping.ParseFrom(pingData);

                        var legacyPacket = new byte[1 + sizeof(long)];
                        legacyPacket[0] = packet[0];

                        var timestampBytes = BitConverter.GetBytes(ping.Timestamp);
                        if (BitConverter.IsLittleEndian)
                            Array.Reverse(timestampBytes);

                        Array.Copy(timestampBytes, 0, legacyPacket, 1, timestampBytes.Length);

                        Protocol.UdpPing(legacyPacket);
                    }
                    catch
                    {
                        Protocol.UdpPing(packet);
                    }
                }
                else
                {
                    Protocol.UdpPing(packet);
                }
            }
            else if (VoiceSupportEnabled)
            {
                if (_isServerVersion15OrHigher)
                {
                    var payloadLength = packet.Length - 1;
                    if (payloadLength > 0)
                    {
                        var payload = new byte[payloadLength];
                        Array.Copy(packet, 1, payload, 0, payloadLength);
                        // Try protobuf handler first, fall back to old handler if it fails
                        bool handled = _voicePacketHandler15.ProcessUDPPacket(payload, payloadLength);
                        if (!handled)
                        {
                            // Protobuf parsing failed, try old protocol handler
                            UnpackVoicePacket(packet, type);
                        }
                    }
                }
                else
                {
                    UnpackVoicePacket(packet, type);
                }
            }
        }

        private void PackVoicePacket(ArraySegment<byte> packet)
        {
        }

        private void UnpackVoicePacket(byte[] packet, int type)
        {
            // In the old protocol (pre-1.5), the packet type indicates the codec:
            // type 0 = CELT Alpha, type 2 = Speex, type 3 = CELT Beta, type 4 = Opus
            var vType = (SpeechCodecs)type;
            var target = (SpeechTarget)(packet[0] & 0x1F);

            using (var reader = new UdpPacketReader(new MemoryStream(packet, 1, packet.Length - 1)))
            {
                UInt32 session = (uint)reader.ReadVarInt64();
                Int64 sequence = reader.ReadVarInt64();

                //Null codec means the user was not found. This can happen if a user leaves while voice packets are still in flight
                IVoiceCodec voiceCodec = Protocol.GetCodec(session, vType);
                if (voiceCodec == null)
                    return;

                if (vType == SpeechCodecs.Opus)
                {
                    int size = (int)reader.ReadVarInt64();
                    size &= 0x1fff;

                    if (size == 0)
                        return;

                    byte[] data = reader.ReadBytes(size);
                    if (data == null)
                        return;

                    Protocol.EncodedVoice(data, session, sequence, voiceCodec, target);
                }
            }
        }

        /// <summary>
        /// Test helper to directly call UnpackVoicePacket.
        /// </summary>
        internal void TestUnpackVoicePacket(byte[] packet, int type)
        {
            UnpackVoicePacket(packet, type);
        }

        internal void ProcessCryptState(CryptSetup cryptSetup)
        {
            if (cryptSetup.ShouldSerializeKey() && cryptSetup.ShouldSerializeClientNonce() && cryptSetup.ShouldSerializeServerNonce()) // Full key setup
            {
                _cryptState.SetKeys(cryptSetup.Key, cryptSetup.ClientNonce, cryptSetup.ServerNonce);
            }
            else if (cryptSetup.ServerNonce != null) // Server syncing its nonce to us.
            {
                _cryptState.ServerNonce = cryptSetup.ServerNonce;
            }
            else // Server wants our nonce.
            {
                SendControl<CryptSetup>(PacketType.CryptSetup, new CryptSetup { ClientNonce = _cryptState.ClientNonce });
            }
        }

        #region pings
        //using the approch described here to do running calculations of ping values.
        // http://dsp.stackexchange.com/questions/811/determining-the-mean-and-standard-deviation-in-real-time
        private float _meanOfPings;
        private float _varianceTimesCountOfPings;
        private int _countOfPings;

        /// <summary>
        /// Gets a value indicating whether ping stats should set timestamp when pinging.
        /// Only set the timestamp if we're currently connected.  This prevents the ping stats from being built.
        /// otherwise the stats will be throw off by the time it takes to connect.
        /// </summary>
        /// <value>
        ///   <c>true</c> if ping stats should set timestamp when pinging; otherwise, <c>false</c>.
        /// </value>
        internal bool ShouldSetTimestampWhenPinging { get; private set; }

        internal void ReceivePing(Ping ping)
        {
            ShouldSetTimestampWhenPinging = true;
            if (ping.ShouldSerializeTimestamp() && ping.Timestamp != 0)
            {
                var mostRecentPingtime =
                    (float)TimeSpan.FromTicks(DateTime.UtcNow.Ticks - (long)ping.Timestamp).TotalMilliseconds;

                //The ping time is the one-way transit time.
                mostRecentPingtime /= 2;

                var previousMean = _meanOfPings;
                _countOfPings++;
                _meanOfPings = _meanOfPings + ((mostRecentPingtime - _meanOfPings) / _countOfPings);
                _varianceTimesCountOfPings = _varianceTimesCountOfPings +
                                             ((mostRecentPingtime - _meanOfPings) * (mostRecentPingtime - previousMean));

                TcpPingPackets = (uint)_countOfPings;
                TcpPingAverage = _meanOfPings;
                TcpPingVariance = _varianceTimesCountOfPings / _countOfPings;
            }


        }
        #endregion
    }
}
