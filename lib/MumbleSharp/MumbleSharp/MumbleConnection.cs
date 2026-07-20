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

        // UDP is considered alive while the last successfully decrypted UDP
        // packet (ping echo or voice) is younger than this. Two missed ping
        // intervals plus margin, matching the reference client's behaviour.
        internal const double UDP_LIVENESS_TIMEOUT_MILLISECONDS = 12000;

        public float? TcpPingAverage { get; set; }
        public float? TcpPingVariance { get; set; }
        public uint? TcpPingPackets { get; set; }

        public float? UdpPingAverage { get; private set; }
        public float? UdpPingVariance { get; private set; }
        public uint? UdpPingPackets { get; private set; }

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
        internal CryptState CryptState => _cryptState;

        // Sentinel meaning "never" that stays far away from any real monotonic
        // timestamp (which starts near 0 at boot), without subtraction overflow.
        private const long NeverMs = long.MinValue / 2;

        // Monotonic milliseconds (Stopwatch is wall-clock independent;
        // Environment.TickCount64 is unavailable on netstandard2.0/2.1).
        private static long MonotonicMs =>
            System.Diagnostics.Stopwatch.GetTimestamp() * 1000 / System.Diagnostics.Stopwatch.Frequency;

        // Monotonic ms (wall-clock adjustments must not affect liveness)
        // of the last successfully decrypted UDP packet.
        // Written from the process thread, read from the capture thread (SendVoice).
        private long _lastGoodUdpMs = NeverMs;

        // Client-initiated crypt resync state (see MaybeRequestCryptResync).
        private int _consecutiveDecryptFailures;
        private long _lastResyncRequestMs = NeverMs;
        internal uint ResyncRequests { get; private set; }

        /// <summary>
        /// True while UDP voice is confirmed working: an encrypted ping echo or
        /// voice packet round-tripped recently. Voice is only committed to UDP
        /// while healthy; otherwise it goes over the TCP tunnel. Pings keep
        /// probing, so this recovers automatically when UDP comes back.
        /// </summary>
        public bool UdpHealthy =>
            MonotonicMs - System.Threading.Volatile.Read(ref _lastGoodUdpMs)
                < UDP_LIVENESS_TIMEOUT_MILLISECONDS;

        internal void MarkUdpAlive() =>
            System.Threading.Volatile.Write(ref _lastGoodUdpMs, MonotonicMs);

        /// <summary>
        /// Called by UdpSocket when the OS reports the UDP path unusable
        /// (e.g. ICMP port unreachable surfacing as a SocketException).
        /// Voice falls back to the TCP tunnel immediately; pings keep probing.
        /// </summary>
        internal void MarkUdpUnusable() =>
            System.Threading.Volatile.Write(ref _lastGoodUdpMs, NeverMs);

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
            if (_tcp == null)
                return;

            _tcp.Send<T>(type, packet);
        }

        private void SendEncryptedUdpPing()
        {
            // CryptState not yet initialized (no CryptSetup from server yet)
            if (!_cryptState.Initialized)
                return;

            byte[] pingData = BuildUdpPing(DateTime.UtcNow.Ticks);

            // Encrypt before sending — server requires all UDP to be OCB-AES128 encrypted
            byte[] encrypted = _cryptState.Encrypt(pingData, pingData.Length);
            if (encrypted != null)
                _udp.TrySend(encrypted, encrypted.Length);
        }

        /// <summary>
        /// Builds a UDP ping packet: type header + timestamp as a Mumble varint.
        /// Always uses the 8-byte varint form (0xF4 prefix) since a tick count
        /// never fits the short forms anyway.
        /// </summary>
        internal static byte[] BuildUdpPing(long timestamp)
        {
            byte[] pingData = new byte[10];
            pingData[0] = 1 << 5; // Ping type
            pingData[1] = 0xF4;   // varint prefix: 111101__ = 8-byte value follows
            for (int i = 0; i < 8; i++)
                pingData[2 + i] = (byte)(timestamp >> (56 - 8 * i));
            return pingData;
        }

        public void SendVoice(ArraySegment<byte> packet)
        {
            //The packet must be a well formed Mumble packet as described in https://mumble-protocol.readthedocs.org/en/latest/voice_data.html#packet-format
            //The packet is created in BasicMumbleProtocol's EncodingThread

            if (!VoiceSupportEnabled)
                throw new InvalidOperationException("Voice Support is disabled with this connection");

            // Commit voice to UDP only when crypt is ready and the UDP path has
            // recently proven itself (ping echo / incoming voice). Everything
            // else goes through the TCP tunnel, like the reference client.
            if (_udp != null && _udp.IsConnected && _cryptState.Initialized && UdpHealthy)
            {
                byte[] voiceData = new byte[packet.Count];
                Buffer.BlockCopy(packet.Array, packet.Offset, voiceData, 0, packet.Count);
                byte[] encrypted = _cryptState.Encrypt(voiceData, voiceData.Length);
                if (encrypted != null && _udp.TrySend(encrypted, encrypted.Length))
                    return;
            }

            _tcp.SendVoice(PacketType.UDPTunnel, packet); // TCP tunnel fallback
        }

        internal void ReceivedEncryptedUdp(byte[] packet)
        {
            if (!_cryptState.Initialized)
                return;

            byte[] plaintext = _cryptState.Decrypt(packet, packet.Length);

            if (plaintext == null)
            {
                _consecutiveDecryptFailures++;
                MaybeRequestCryptResync();
                return;
            }

            _consecutiveDecryptFailures = 0;
            MarkUdpAlive();
            ReceiveDecryptedUdp(plaintext);
        }

        /// <summary>
        /// A nonce desync silently kills UDP receive: every packet fails to
        /// decrypt and is dropped. After a burst of consecutive failures, ask
        /// the server for its current nonce by sending an empty CryptSetup
        /// (rate-limited to one request per 5 seconds).
        /// </summary>
        private void MaybeRequestCryptResync()
        {
            if (_consecutiveDecryptFailures < 10)
                return;
            var now = MonotonicMs;
            if (now - _lastResyncRequestMs < 5000)
                return;
            _lastResyncRequestMs = now;
            ResyncRequests++;
            SendControl<CryptSetup>(PacketType.CryptSetup, new CryptSetup());
        }

        internal void ReceiveDecryptedUdp(byte[] packet)
        {
            var type = packet[0] >> 5 & 0x7;

            if (type == 1)
            {
                ReceiveUdpPingEcho(packet);
                Protocol.UdpPing(packet);
            }
            else if(VoiceSupportEnabled)
                UnpackVoicePacket(packet, type);
        }

        private void ReceiveUdpPingEcho(byte[] packet)
        {
            MarkUdpAlive();
            try
            {
                using (var reader = new UdpPacketReader(new MemoryStream(packet, 1, packet.Length - 1)))
                {
                    long sentTicks = reader.ReadVarInt64();
                    float rttMs = (float)TimeSpan.FromTicks(DateTime.UtcNow.Ticks - sentTicks).TotalMilliseconds;
                    if (rttMs < 0 || rttMs > 60000)
                        return; // garbage or foreign timestamp format — liveness already noted

                    var previousMean = _meanOfUdpPings;
                    _countOfUdpPings++;
                    _meanOfUdpPings = _meanOfUdpPings + ((rttMs - _meanOfUdpPings) / _countOfUdpPings);
                    _varianceTimesCountOfUdpPings = _varianceTimesCountOfUdpPings +
                                                    ((rttMs - _meanOfUdpPings) * (rttMs - previousMean));

                    UdpPingPackets = (uint)_countOfUdpPings;
                    UdpPingAverage = _meanOfUdpPings;
                    UdpPingVariance = _varianceTimesCountOfUdpPings / _countOfUdpPings;
                }
            }
            catch (IOException) { /* malformed echo payload — liveness already noted */ }
            catch (InvalidDataException) { /* invalid varint in echo payload */ }
        }

        private void UnpackVoicePacket(byte[] packet, int type)
        {
            var vType = (SpeechCodecs)type;
            var target = (SpeechTarget)(packet[0] & 0x1F);

            using (var reader = new UdpPacketReader(new MemoryStream(packet, 1, packet.Length - 1)))
            {
                UInt32 session = (uint)reader.ReadVarInt64();
                Int64 sequence = reader.ReadVarInt64();

                //Null codec means the user was not found. This can happen if a user leaves while voice packets are still in flight
                IVoiceCodec codec = Protocol.GetCodec(session, vType);
                if (codec == null)
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

                    Protocol.EncodedVoice(data, session, sequence, codec, target);
                }
            }
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

        private float _meanOfUdpPings;
        private float _varianceTimesCountOfUdpPings;
        private int _countOfUdpPings;

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
