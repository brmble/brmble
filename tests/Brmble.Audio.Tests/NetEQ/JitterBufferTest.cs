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
    public void EmptyBuffer_TriggersPLC_ThenMerge()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder, initialBufferFrames: 0);

        // Insert only one packet
        jb.InsertPacket(MakePacket(0, arrivalMs: 0));

        var output = new short[FrameSize];

        // Tick 1: decode seq 0 (Normal)
        jb.GetAudio(output);
        Assert.AreEqual(1, decoder.DecodeCallCount);

        // Tick 2: buffer empty → PLC (Expand)
        jb.GetAudio(output);
        Assert.AreEqual(1, decoder.PlcCallCount);

        // Tick 3: new packet arrives, previous was Expand → Merge
        jb.InsertPacket(MakePacket(1, arrivalMs: 40));
        jb.GetAudio(output);
        Assert.AreEqual(2, decoder.DecodeCallCount);

        var stats = jb.GetStats();
        Assert.AreEqual(1L, stats.ExpandFrames);
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

    [TestMethod]
    public void GetAudio_BufferAboveTargetPlus2_Accelerates()
    {
        // TargetLevel starts at 1 (DelayManager default minLevel).
        // With 8 packets in the buffer: bufferLevel=8 > targetLevel(1)+2=3 → Accelerate.
        // Note: GetAudio drains the sync buffer first, so after filling SyncBuffer for one
        // frame, the remaining packetBuffer count is used for the decision.
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder, initialBufferFrames: 0);

        // Insert 8 packets so after sync-buffer fill the remaining count is still high.
        for (int i = 0; i < 8; i++)
            jb.InsertPacket(MakePacket(i, arrivalMs: i * 20));

        var output = new short[FrameSize];
        jb.GetAudio(output);

        var stats = jb.GetStats();
        Assert.AreEqual(1L, stats.AccelerateFrames,
            $"Expected AccelerateFrames=1, got {stats.AccelerateFrames}. " +
            $"NormalFrames={stats.NormalFrames}, DecelerateFrames={stats.DecelerateFrames}");
    }

    [TestMethod]
    public void GetAudio_BufferBelowTargetMinus2_Decelerates()
    {
        // Drive TargetLevel up by feeding packets with high inter-arrival times,
        // then drain the buffer so bufferLevel < targetLevel - 2.
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder, initialBufferFrames: 0);

        // Feed packets with large timestamps spread out over a long simulated window
        // so DelayManager records high relative delay and raises TargetLevel above 3.
        // Each packet arrives "late" relative to its timestamp, driving the histogram up.
        for (int i = 0; i < 20; i++)
        {
            // arrival is 200ms later than expected → relative delay ~200ms → bucket ~10
            long timestamp = (long)i * FrameSize;
            long expectedMs = timestamp * 1000 / 48000; // = i * 20ms
            long arrivalMs = expectedMs + 200 + i * 20;
            jb.InsertPacket(new EncodedPacket(
                Sequence: i,
                Timestamp: timestamp,
                Payload: new byte[] { (byte)(i & 0xFF), 0x01, 0x02 },
                ArrivalTimeMs: arrivalMs));
        }

        // Drain all packets so buffer is empty
        var output = new short[FrameSize];
        for (int i = 0; i < 20; i++)
            jb.GetAudio(output);

        // Now insert exactly 1 packet; TargetLevel should be > 3 from history above,
        // so bufferLevel(1) < targetLevel - 2 → Decelerate.
        jb.InsertPacket(MakePacket(20, arrivalMs: 0));
        jb.GetAudio(output);

        var stats = jb.GetStats();
        Assert.IsTrue(stats.DecelerateFrames >= 1,
            $"Expected at least 1 DecelerateFrame. Stats: Normal={stats.NormalFrames}, " +
            $"Expand={stats.ExpandFrames}, Decelerate={stats.DecelerateFrames}, " +
            $"TargetLevel={stats.TargetLevel}, BufferLevel={stats.BufferLevel}");
    }

    [TestMethod]
    public void GetAudio_Accelerate_TimeStretcherWarmupFallsBackGracefully()
    {
        // Drive Accelerate condition (bufferLevel > targetLevel + 2) using the same
        // setup as GetAudio_BufferAboveTargetPlus2_Accelerates.
        // On the very first call the TimeStretcher is in warmup and produces < FrameSize
        // samples, so the CrossFade fallback path must engage.
        // Asserts: AccelerateFrames increments AND output contains at least one non-zero
        // sample (guards against the stretcher swallowing audio during warmup).
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder, initialBufferFrames: 0);

        // Insert 8 packets so buffer level is well above target after sync-buffer fill.
        for (int i = 0; i < 8; i++)
            jb.InsertPacket(MakePacket(i, arrivalMs: i * 20));

        var output = new short[FrameSize];
        jb.GetAudio(output);

        var stats = jb.GetStats();
        Assert.AreEqual(1L, stats.AccelerateFrames,
            $"Expected AccelerateFrames=1, got {stats.AccelerateFrames}. " +
            $"NormalFrames={stats.NormalFrames}, DecelerateFrames={stats.DecelerateFrames}");

        bool hasNonZero = false;
        for (int i = 0; i < FrameSize; i++)
        {
            if (output[i] != 0) { hasNonZero = true; break; }
        }
        Assert.IsTrue(hasNonZero,
            "Output was entirely silent — TimeStretcher warmup fallback did not engage correctly.");
    }

    [TestMethod]
    public void GetAudio_AfterExpand_Merges()
    {
        // After a PLC (Expand) frame, the next real packet should be served via Merge.
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder, initialBufferFrames: 0);

        jb.InsertPacket(MakePacket(0, arrivalMs: 0));

        var output = new short[FrameSize];

        // Tick 1: Normal — decodes seq 0
        jb.GetAudio(output);
        Assert.AreEqual(PlayoutDecision.Normal, jb.LastDecision);

        // Tick 2: buffer empty → Expand (PLC)
        jb.GetAudio(output);
        Assert.AreEqual(PlayoutDecision.Expand, jb.LastDecision);

        // Tick 3: insert new packet; previousDecision was Expand → Merge
        jb.InsertPacket(MakePacket(1, arrivalMs: 40));
        jb.GetAudio(output);
        Assert.AreEqual(PlayoutDecision.Merge, jb.LastDecision,
            $"Expected Merge after Expand, got {jb.LastDecision}");
    }

    [TestMethod]
    public void GetAudio_AfterExpand_IncrementsMergeFrames()
    {
        // Normal → Expand → Merge. After the Merge tick, MergeFrames must be 1.
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder, initialBufferFrames: 0);

        jb.InsertPacket(MakePacket(0, arrivalMs: 0));

        var output = new short[FrameSize];

        // Tick 1: Normal — decodes seq 0
        jb.GetAudio(output);

        // Tick 2: buffer empty → Expand (PLC)
        jb.GetAudio(output);

        // Tick 3: insert new packet; previousDecision was Expand → Merge
        jb.InsertPacket(MakePacket(1, arrivalMs: 40));
        jb.GetAudio(output);

        Assert.AreEqual(PlayoutDecision.Merge, jb.LastDecision,
            $"Expected Merge decision, got {jb.LastDecision}");

        var stats = jb.GetStats();
        Assert.AreEqual(1L, stats.MergeFrames,
            $"Expected MergeFrames=1, got {stats.MergeFrames}");
        // The Expand on tick 2 had both syncBuffer and packetBuffer empty → counts as an
        // underflow. Merge does not add a second underflow; total stays at 1.
        Assert.AreEqual(1L, stats.Underflows,
            $"Expected Underflows=1 (from the Expand tick), got {stats.Underflows}");
    }

    [TestMethod]
    public void GetAudio_EmptyBufferAndPackets_IncrementsUnderflows()
    {
        // Insert one packet to start playout, drain it (Normal), then pull again
        // with no packets → Expand with both syncBuffer and packetBuffer empty → Underflow.
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder, initialBufferFrames: 1);

        // Insert one packet to satisfy the initial buffer requirement.
        jb.InsertPacket(MakePacket(0, arrivalMs: 0));

        var output = new short[FrameSize];

        // Tick 1: playout starts, decodes seq 0 → Normal
        jb.GetAudio(output);
        Assert.AreEqual(PlayoutDecision.Normal, jb.LastDecision);

        // Tick 2: no packets, no sync buffer content → Expand + Underflow
        jb.GetAudio(output);
        Assert.AreEqual(PlayoutDecision.Expand, jb.LastDecision);

        var stats = jb.GetStats();
        Assert.AreEqual(1L, stats.Underflows,
            $"Expected Underflows=1, got {stats.Underflows}");
        Assert.AreEqual(1L, stats.ExpandFrames,
            $"Expected ExpandFrames=1, got {stats.ExpandFrames}");
        Assert.AreEqual(0L, stats.MergeFrames,
            $"Expected MergeFrames=0, got {stats.MergeFrames}");
    }
}
