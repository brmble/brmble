using System.Net;
using MumbleSharp;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class MumbleConnectionUdpTests
{
    private static MumbleConnection CreateConnection() =>
        new(new IPEndPoint(IPAddress.Loopback, 64738), new BasicMumbleProtocol());

    [TestMethod]
    public void UdpHealthy_InitiallyFalse()
    {
        Assert.IsFalse(CreateConnection().UdpHealthy,
            "Voice must start on the TCP tunnel until UDP proves itself");
    }

    [TestMethod]
    public void PingEcho_MeasuresRtt()
    {
        var conn = CreateConnection();
        var echo = MumbleConnection.BuildUdpPing(DateTime.UtcNow.Ticks);

        conn.ReceiveDecryptedUdp(echo);

        Assert.IsNotNull(conn.UdpPingAverage);
        Assert.IsTrue(conn.UdpPingAverage.Value >= 0 && conn.UdpPingAverage.Value < 1000,
            $"RTT should be near zero for a same-instant echo, got {conn.UdpPingAverage}");
        Assert.AreEqual(1u, conn.UdpPingPackets!.Value);
    }

    [TestMethod]
    public void TunneledPingEcho_DoesNotProveUdpLiveness()
    {
        var conn = CreateConnection();

        // ReceiveDecryptedUdp is the shared path also fed by TCP UDPTunnel
        // packets — a type-1 payload arriving there must not mark UDP healthy.
        conn.ReceiveDecryptedUdp(MumbleConnection.BuildUdpPing(DateTime.UtcNow.Ticks));

        Assert.IsFalse(conn.UdpHealthy, "Only the encrypted UDP receive path may prove liveness");
    }

    [TestMethod]
    public void MarkUdpUnusable_RevertsToUnhealthy()
    {
        var conn = CreateConnection();
        conn.MarkUdpAlive();
        Assert.IsTrue(conn.UdpHealthy);

        conn.MarkUdpUnusable();

        Assert.IsFalse(conn.UdpHealthy, "SocketException on the UDP path must drop voice back to the tunnel");
    }

    [TestMethod]
    public void BuildUdpPing_TimestampRoundTripsThroughVarintReader()
    {
        long timestamp = DateTime.UtcNow.Ticks;
        var packet = MumbleConnection.BuildUdpPing(timestamp);

        Assert.AreEqual(0x20, packet[0], "Ping type header");
        using var reader = new UdpPacketReader(new MemoryStream(packet, 1, packet.Length - 1));
        Assert.AreEqual(timestamp, reader.ReadVarInt64(),
            "8-byte varint decode must return the exact tick count (regression: int shifts were masked to <<24)");
    }

    [TestMethod]
    public void SustainedDecryptFailures_RequestOneCryptResync()
    {
        var conn = CreateConnection();
        // Initialized crypt with garbage traffic → every decrypt fails.
        conn.CryptState.SetKeys(new byte[16], new byte[16], new byte[16]);
        var garbage = new byte[32];

        for (int i = 0; i < 25; i++)
            conn.ReceivedEncryptedUdp(garbage);

        // Rate limiter: one request per burst, not one per failing packet.
        Assert.AreEqual(1u, conn.ResyncRequests);
        Assert.IsFalse(conn.UdpHealthy, "Failed decrypts are not liveness evidence");
    }

    [TestMethod]
    public void DecryptFailuresBelowThreshold_DoNotRequestResync()
    {
        var conn = CreateConnection();
        conn.CryptState.SetKeys(new byte[16], new byte[16], new byte[16]);
        var garbage = new byte[32];

        for (int i = 0; i < 9; i++)
            conn.ReceivedEncryptedUdp(garbage);

        Assert.AreEqual(0u, conn.ResyncRequests);
    }
}
