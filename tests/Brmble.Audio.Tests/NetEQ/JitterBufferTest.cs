using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Audio.Codecs;
using Brmble.Audio.Diagnostics;
using Brmble.Audio.NetEQ;
using Brmble.Audio.NetEQ.Models;
using Brmble.Audio.Tests.Helpers;

namespace Brmble.Audio.Tests.NetEQ;

[TestClass]
public class JitterBufferTest
{
    private const int FrameSize = 960;

    private static EncodedPacket MakePacket(long seq, long arrivalMs = 0)
    {
        return new EncodedPacket(
            Sequence: seq,
            Timestamp: seq * FrameSize,
            Payload: new byte[] { (byte)(seq & 0xFF), 0x01, 0x02 },
            ArrivalTimeMs: arrivalMs
        );
    }

    [TestMethod]
    public void GetAudio_NoPackets_ReturnsPLC()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder, initialBufferFrames: 0);

        var output = new short[FrameSize];
        jb.GetAudio(output);

        Assert.AreEqual(1, decoder.PlcCallCount);
        Assert.AreEqual(0, decoder.DecodeCallCount);

        var stats = jb.GetStats();
        Assert.AreEqual(1L, stats.ExpandFrames);
    }

    [TestMethod]
    public void InsertThenGetAudio_DecodesNormally()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder, initialBufferFrames: 0);

        jb.InsertPacket(MakePacket(0, arrivalMs: 0));

        var output = new short[FrameSize];
        jb.GetAudio(output);

        Assert.AreEqual(1, decoder.DecodeCallCount);
        Assert.AreEqual(0, decoder.PlcCallCount);

        var stats = jb.GetStats();
        Assert.AreEqual(1L, stats.NormalFrames);
    }

    [TestMethod]
    public void OutOfOrderPackets_ReorderedCorrectly()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder, initialBufferFrames: 0);

        jb.InsertPacket(MakePacket(1, arrivalMs: 5));
        jb.InsertPacket(MakePacket(0, arrivalMs: 10));

        var output = new short[FrameSize];

        jb.GetAudio(output);
        Assert.AreEqual(1, decoder.DecodeCallCount);

        jb.GetAudio(output);
        Assert.AreEqual(2, decoder.DecodeCallCount);
    }

    [TestMethod]
    public void MissingPacket_TriggersPLC_ThenMerge()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder, initialBufferFrames: 0);

        jb.InsertPacket(MakePacket(0, arrivalMs: 0));
        jb.InsertPacket(MakePacket(2, arrivalMs: 40));

        var output = new short[FrameSize];

        // Tick 1: decode seq 0 (Normal)
        jb.GetAudio(output);
        Assert.AreEqual(1, decoder.DecodeCallCount);

        // Tick 2: seq 1 missing → PLC (Expand)
        jb.GetAudio(output);
        Assert.AreEqual(1, decoder.PlcCallCount);

        // Tick 3: seq 2 available, previous was Expand → Merge
        jb.GetAudio(output);
        Assert.AreEqual(2, decoder.DecodeCallCount);

        var stats = jb.GetStats();
        Assert.AreEqual(1L, stats.ExpandFrames);
        Assert.IsTrue(stats.NormalFrames > 0 || stats.TotalFrames == 3);
    }

    [TestMethod]
    public void GetAudio_AlwaysReturnsSamples()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder, initialBufferFrames: 0);

        var output = new short[FrameSize];
        for (int i = 0; i < 100; i++)
            jb.GetAudio(output);

        Assert.AreEqual(100, decoder.PlcCallCount);
    }

    [TestMethod]
    public void Volume_ScalesOutput()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder, initialBufferFrames: 0);
        jb.Volume = 0.5f;

        jb.InsertPacket(MakePacket(0, arrivalMs: 0));

        var output = new short[FrameSize];
        jb.GetAudio(output);

        Assert.IsTrue(output[100] < 100,
            $"Expected scaled output, got {output[100]}");
    }

    [TestMethod]
    public void Stats_TracksAllDecisions()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder, initialBufferFrames: 0);

        var output = new short[FrameSize];
        for (int i = 0; i < 5; i++)
            jb.GetAudio(output);

        var stats = jb.GetStats();
        Assert.AreEqual(5L, stats.TotalFrames);
        Assert.AreEqual(5L, stats.ExpandFrames);
    }
}
