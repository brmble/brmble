using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Audio.NetEQ;

namespace Brmble.Audio.Tests.NetEQ;

[TestClass]
public class RingBufferTest
{
    [TestMethod]
    public void Write_ThenRead_ReturnsSamples()
    {
        var rb = new RingBuffer(capacity: 4800);
        short[] data = Enumerable.Range(0, 960).Select(i => (short)i).ToArray();
        rb.Write(data);

        var output = new short[960];
        int read = rb.Read(output);
        Assert.AreEqual(960, read);
        Assert.AreEqual((short)0, output[0]);
        Assert.AreEqual((short)959, output[959]);
    }

    [TestMethod]
    public void Read_Empty_ReturnsZero()
    {
        var rb = new RingBuffer(capacity: 4800);
        var output = new short[960];
        int read = rb.Read(output);
        Assert.AreEqual(0, read);
    }

    [TestMethod]
    public void Write_Overrun_DropsOldest()
    {
        var rb = new RingBuffer(capacity: 1920);
        short[] frame1 = Enumerable.Repeat((short)1, 960).ToArray();
        short[] frame2 = Enumerable.Repeat((short)2, 960).ToArray();
        short[] frame3 = Enumerable.Repeat((short)3, 960).ToArray();

        rb.Write(frame1);
        rb.Write(frame2);
        rb.Write(frame3); // overrun: drops frame1

        var output = new short[960];
        rb.Read(output);
        Assert.AreEqual((short)2, output[0]);
    }

    [TestMethod]
    public void AvailableSamples_TracksState()
    {
        var rb = new RingBuffer(capacity: 4800);
        Assert.AreEqual(0, rb.AvailableSamples);
        rb.Write(new short[960]);
        Assert.AreEqual(960, rb.AvailableSamples);
        rb.Read(new short[960]);
        Assert.AreEqual(0, rb.AvailableSamples);
    }
}
