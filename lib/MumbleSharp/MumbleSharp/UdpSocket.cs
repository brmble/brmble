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
    internal class UdpSocket
    {
        readonly UdpClient _client;
        readonly IPEndPoint _host;
        readonly IMumbleProtocol _protocol;
        readonly MumbleConnection _connection;

        public bool IsConnected { get; private set; }

        public UdpSocket(IPEndPoint host, IMumbleProtocol protocol, MumbleConnection connection)
        {
            _host = host;
            _protocol = protocol;
            _connection = connection;
            _client = new UdpClient();
        }

        public void Connect()
        {
            _client.Connect(_host);
            IsConnected = true;
        }

        public void Close()
        {
            IsConnected = false;
            _client.Close();
        }

        /// <summary>
        /// Send a datagram. A refused/unreachable UDP path (e.g. ICMP port
        /// unreachable surfacing as SocketException on Windows) is not fatal to
        /// the session — it just means UDP is down; the caller falls back to
        /// the TCP tunnel and pings keep probing for recovery.
        /// </summary>
        public bool TrySend(byte[] data, int length)
        {
            try
            {
                _client.Send(data, length);
                return true;
            }
            catch (SocketException)
            {
                _connection.MarkUdpUnusable();
                return false;
            }
            catch (ObjectDisposedException)
            {
                return false;
            }
        }

        public bool Process()
        {
            try
            {
                if (_client.Client == null
                    || _client.Available == 0)
                    return false;

                IPEndPoint sender = _host;
                byte[] data = _client.Receive(ref sender);

                _connection.ReceivedEncryptedUdp(data);

                return true;
            }
            catch (SocketException)
            {
                // ICMP port unreachable from a previous send is delivered on
                // the next receive call. UDP down, session stays up.
                _connection.MarkUdpUnusable();
                return false;
            }
            catch (ObjectDisposedException)
            {
                return false;
            }
        }
    }
}
