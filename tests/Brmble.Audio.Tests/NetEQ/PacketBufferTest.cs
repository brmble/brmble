using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Audio.NetEQ;
using Brmble.Audio.NetEQ.Models;

namespace Brmble.Audio.Tests.NetEQ;

[TestClass]
public class PacketBufferTest
{
    private static EncodedPacket MakePacket(long seq, long arrivalMs = 0)
    {
        return new EncodedPacket(
            Sequence: seq,
            Timestamp: seq * 960,
            Payload: new byte[] { (byte)(seq & 0xFF) },
            ArrivalTimeMs: arrivalMs
        );
    }

    [TestMethod]
    public void Insert_SinglePacket_CanRetrieve()
    {
        var buf = new PacketBuffer();
        buf.Insert(MakePacket(1));
        var result = buf.TryGetNext(960);
        Assert.IsNotNull(result);
        Assert.AreEqual(1L, result.Sequence);
    }

    [TestMethod]
    public void Insert_OutOfOrder_ReturnsInOrder()
    {
        var buf = new PacketBuffer();
        buf.Insert(MakePacket(3));
        buf.Insert(MakePacket(1));
        buf.Insert(MakePacket(2));
        Assert.AreEqual(1L, buf.TryGetNext(960)!.Sequence);
        Assert.AreEqual(2L, buf.TryGetNext(1920)!.Sequence);
        Assert.AreEqual(3L, buf.TryGetNext(2880)!.Sequence);
    }

    [TestMethod]
    public void Insert_Duplicate_Rejected()
    {
        var buf = new PacketBuffer();
        buf.Insert(MakePacket(1));
        buf.Insert(MakePacket(1));
        Assert.AreEqual(1, buf.Count);
    }

    [TestMethod]
    public void TryGetNext_NoMatch_ReturnsNull()
    {
        var buf = new PacketBuffer();
        buf.Insert(MakePacket(5));
        var result = buf.TryGetNext(960);
        Assert.IsNull(result);
    }

    [TestMethod]
    public void Insert_StalePacket_Rejected()
    {
        var buf = new PacketBuffer();
        buf.Insert(MakePacket(10));
        buf.TryGetNext(10 * 960);
        buf.Insert(MakePacket(3));
        Assert.AreEqual(0, buf.Count);
    }

    [TestMethod]
    public void Insert_ExceedsCapacity_OldestDropped()
    {
        var buf = new PacketBuffer(maxCapacity: 3);
        buf.Insert(MakePacket(1));
        buf.Insert(MakePacket(2));
        buf.Insert(MakePacket(3));
        buf.Insert(MakePacket(4));
        Assert.AreEqual(3, buf.Count);
        Assert.IsNull(buf.TryGetNext(960));
        Assert.IsNotNull(buf.TryGetNext(1920));
    }

    [TestMethod]
    public void Count_ReflectsCurrentSize()
    {
        var buf = new PacketBuffer();
        Assert.AreEqual(0, buf.Count);
        buf.Insert(MakePacket(1));
        Assert.AreEqual(1, buf.Count);
        buf.TryGetNext(960);
        Assert.AreEqual(0, buf.Count);
    }

    [TestMethod]
    public void Flush_ClearsAll()
    {
        var buf = new PacketBuffer();
        buf.Insert(MakePacket(1));
        buf.Insert(MakePacket(2));
        buf.Flush();
        Assert.AreEqual(0, buf.Count);
    }

    [TestMethod]
    public void Contains_ReturnsTrueForExistingTimestamp()
    {
        var buf = new PacketBuffer();
        buf.Insert(MakePacket(1));
        Assert.IsTrue(buf.Contains(960));
        Assert.IsFalse(buf.Contains(1920));
    }
}
