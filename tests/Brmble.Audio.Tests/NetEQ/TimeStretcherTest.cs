using System.Collections.Generic;
using Brmble.Audio.NetEQ;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Audio.Tests.NetEQ;

[TestClass]
public class TimeStretcherTest
{
    private const int SampleRate = 48000;
    private const int FrameSamples = 960; // 20ms

    [TestMethod]
    public void Process_RatioOne_ReturnsApproximatelySameLength()
    {
        using var stretcher = new TimeStretcher(SampleRate);
        var input = new short[FrameSamples];
        for (int i = 0; i < FrameSamples; i++)
            input[i] = (short)(Math.Sin(2 * Math.PI * 440 * i / SampleRate) * 8000);

        var output = new short[FrameSamples * 2];
        int produced = stretcher.Process(input, tempo: 1.0, output);

        int tail = stretcher.Flush(output.AsSpan(produced));
        int total = produced + tail;

        Assert.IsTrue(Math.Abs(total - FrameSamples) <= 10,
            $"Expected ~{FrameSamples} samples, got {total}");
    }

    [TestMethod]
    [DataRow(0.80)] // decelerate by 20%
    [DataRow(0.90)]
    [DataRow(1.10)]
    [DataRow(1.25)] // accelerate by 25%
    public void Process_StretchRatio_PreservesPitch(double tempo)
    {
        using var stretcher = new TimeStretcher(SampleRate);
        const double freq = 440.0; // A4
        const int totalInput = FrameSamples * 20; // 400ms feed

        var input = new short[FrameSamples];
        var output = new short[FrameSamples * 2];
        var combined = new List<short>(capacity: totalInput * 2);

        for (int f = 0; f < 20; f++)
        {
            int t0 = f * FrameSamples;
            for (int i = 0; i < FrameSamples; i++)
                input[i] = (short)(Math.Sin(2 * Math.PI * freq * (t0 + i) / SampleRate) * 8000);
            int got = stretcher.Process(input, tempo, output);
            for (int i = 0; i < got; i++) combined.Add(output[i]);
        }
        int tail = stretcher.Flush(output);
        for (int i = 0; i < tail; i++) combined.Add(output[i]);

        int crossings = 0;
        for (int i = 1; i < combined.Count; i++)
        {
            if ((combined[i - 1] < 0 && combined[i] >= 0) ||
                (combined[i - 1] >= 0 && combined[i] < 0))
                crossings++;
        }
        double seconds = combined.Count / (double)SampleRate;
        double detected = crossings / 2.0 / seconds;

        double error = Math.Abs(detected - freq) / freq;
        Assert.IsTrue(error < 0.05,
            $"tempo={tempo}: detected={detected:F1}Hz expected={freq:F1}Hz err={error:P1}");
    }

    [TestMethod]
    public void Process_MultipleFrames_MaintainContinuity()
    {
        using var stretcher = new TimeStretcher(SampleRate);
        const double freq = 300.0;
        const int frames = 10;

        var frame = new short[FrameSamples];
        var outBuf = new short[FrameSamples * 2];
        var combined = new List<short>();

        for (int f = 0; f < frames; f++)
        {
            int t0 = f * FrameSamples;
            for (int i = 0; i < FrameSamples; i++)
                frame[i] = (short)(Math.Sin(2 * Math.PI * freq * (t0 + i) / SampleRate) * 8000);
            int n = stretcher.Process(frame, tempo: 1.10, outBuf);
            for (int i = 0; i < n; i++) combined.Add(outBuf[i]);
        }
        int tail = stretcher.Flush(outBuf);
        for (int i = 0; i < tail; i++) combined.Add(outBuf[i]);

        Assert.IsTrue(combined.Count > 0, "Should produce some output");

        // For a 300Hz sine at amplitude 8000, ideal max per-sample delta
        // is 2π*300/48000*8000 ≈ 314. Allow generous headroom for stretch
        // boundary artifacts. A true discontinuity (click/step) would show
        // deltas in the thousands.
        int maxJump = 0;
        for (int i = 1; i < combined.Count; i++)
        {
            int d = Math.Abs(combined[i] - combined[i - 1]);
            if (d > maxJump) maxJump = d;
        }
        Assert.IsTrue(maxJump < 3000,
            $"Max inter-sample jump {maxJump} suggests discontinuity");
    }

    [TestMethod]
    public void Process_SilentInput_ProducesSilentOutput()
    {
        using var stretcher = new TimeStretcher(SampleRate);
        var silent = new short[FrameSamples];
        var output = new short[FrameSamples * 2];

        for (int f = 0; f < 10; f++)
            stretcher.Process(silent, tempo: 1.15, output);

        int tail = stretcher.Flush(output);
        // Tolerance for WSOLA windowing rounding residue on a zero-input signal.
        for (int i = 0; i < tail; i++)
            Assert.IsTrue(Math.Abs(output[i]) < 32, $"Non-silent sample at {i}: {output[i]}");
    }

    [TestMethod]
    public void Process_ImpulseInput_DoesNotExplode()
    {
        using var stretcher = new TimeStretcher(SampleRate);
        var impulse = new short[FrameSamples];
        impulse[0] = short.MaxValue;
        var output = new short[FrameSamples * 2];

        int produced = stretcher.Process(impulse, tempo: 1.0, output);
        int tail = stretcher.Flush(output.AsSpan(produced));

        int total = produced + tail;
        int saturated = 0;
        double sumSq = 0;
        for (int i = 0; i < total; i++)
        {
            if (output[i] == short.MaxValue || output[i] == short.MinValue) saturated++;
            sumSq += (double)output[i] * output[i];
        }
        double rms = total > 0 ? Math.Sqrt(sumSq / total) : 0;

        // A stable stretcher fed a single-sample impulse must not uniformly saturate
        // the output nor produce a DC-like full-scale signal.
        Assert.IsTrue(saturated < total / 10,
            $"Too many saturated samples: {saturated}/{total}");
        Assert.IsTrue(rms < short.MaxValue / 4.0,
            $"RMS {rms:F0} suggests runaway output");
    }

    [TestMethod]
    public void IsOperational_OnSuccessfulInit_ReturnsTrue()
    {
        using var stretcher = new TimeStretcher(SampleRate);
        Assert.IsTrue(stretcher.IsOperational);
    }
}
