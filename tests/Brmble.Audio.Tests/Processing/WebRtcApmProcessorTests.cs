using Brmble.Audio.Processing;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Audio.Tests.Processing;

[TestClass]
public class WebRtcApmProcessorTests
{
    [TestMethod]
    public void Process_ProducesSameLengthForFullFrames()
    {
        using var proc = new WebRtcApmProcessor();
        byte[] input = new byte[9600]; // 10 frames × 960 bytes
        byte[] output = new byte[input.Length + WebRtcApmProcessor.FrameBytes];

        int written = proc.Process(input, output);

        Assert.AreEqual(input.Length, written);
    }

    [TestMethod]
    public void Process_BuffersSubFrameLeftover()
    {
        using var proc = new WebRtcApmProcessor();
        byte[] input = new byte[WebRtcApmProcessor.FrameBytes / 2];
        byte[] output = new byte[input.Length + WebRtcApmProcessor.FrameBytes];

        // First call: buffer the sub-frame, no output yet
        int written1 = proc.Process(input, output);
        Assert.AreEqual(0, written1, "First call with half frame should write 0 bytes");

        // Second call: complete the frame, should output one frame
        int written2 = proc.Process(input, output);
        Assert.AreEqual(WebRtcApmProcessor.FrameBytes, written2, "Second call should output one complete frame");
    }

    [TestMethod]
    public void Reset_DiscardsBufferedSubFrame()
    {
        using var proc = new WebRtcApmProcessor();
        byte[] half = new byte[WebRtcApmProcessor.FrameBytes / 2];
        byte[] output = new byte[WebRtcApmProcessor.FrameBytes * 2];

        proc.Process(half, output);
        proc.Reset();

        // After Reset the previous half frame must be gone: another half frame
        // should buffer again instead of completing a (stale) frame.
        int written = proc.Process(half, output);
        Assert.AreEqual(0, written, "Reset should discard the buffered leftover from the previous transmission");
    }

    [TestMethod]
    public void Process_SilenceInSilenceOut()
    {
        using var proc = new WebRtcApmProcessor();
        byte[] input = new byte[WebRtcApmProcessor.FrameBytes]; // All zeros (silence)
        byte[] output = new byte[input.Length];

        int written = proc.Process(input, output);

        Assert.AreEqual(input.Length, written);

        // Find max absolute int16 value in output
        int maxAbs = 0;
        for (int i = 0; i < output.Length / 2; i++)
        {
            short s = (short)(output[i * 2] | (output[i * 2 + 1] << 8));
            int abs = Math.Abs(s);
            if (abs > maxAbs) maxAbs = abs;
        }

        // Allow small residual from HPF and processing (but expect near-silence)
        Assert.IsTrue(maxAbs < 100, $"Expected silence, but found max absolute value: {maxAbs}");
    }

    [TestMethod]
    public void SoftLimit_PassesThroughBelowKnee_AndBoundsAboveIt()
    {
        // Identity below the knee
        Assert.AreEqual(0.5f, WebRtcApmProcessor.SoftLimit(0.5f));
        Assert.AreEqual(-0.5f, WebRtcApmProcessor.SoftLimit(-0.5f));

        // A full-scale peak with 1.5x gain (the issue #597 scenario) must not hard-clip
        float limited = WebRtcApmProcessor.SoftLimit(1.5f);
        Assert.IsTrue(limited < 1f, $"Expected < 1.0, got {limited}");
        Assert.IsTrue(limited > 0.85f, $"Expected above the knee, got {limited}");
        Assert.AreEqual(-limited, WebRtcApmProcessor.SoftLimit(-1.5f), "Limiter must be symmetric");

        // Monotonic: louder in stays louder out (no folding artifacts)
        Assert.IsTrue(WebRtcApmProcessor.SoftLimit(1.2f) < WebRtcApmProcessor.SoftLimit(1.5f));
    }
}
