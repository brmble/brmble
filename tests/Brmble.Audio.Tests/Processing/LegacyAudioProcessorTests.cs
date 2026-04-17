using Brmble.Audio.Processing;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Audio.Tests.Processing;

[TestClass]
public class LegacyAudioProcessorTests
{
    [TestMethod]
    public void Process_WithAmplification1_CopiesInputVerbatimWhenRnnoiseOff()
    {
        using var proc = new LegacyAudioProcessor { MaxAmplification = 1.0f, RnnoiseEnabled = false };
        byte[] input = new byte[960]; // 10 ms @ 48 kHz mono
        for (int i = 0; i < input.Length; i++) input[i] = (byte)(i & 0xFF);
        byte[] output = new byte[input.Length];

        int written = proc.Process(input, output);

        Assert.AreEqual(input.Length, written);
        CollectionAssert.AreEqual(input, output);
    }

    [TestMethod]
    public void Process_WithAmplification_BoostsQuietSignal()
    {
        using var proc = new LegacyAudioProcessor { MaxAmplification = 4.0f, RnnoiseEnabled = false };
        // A quiet signal: int16 amplitude ~1000 (RMS ~1000, below TargetRms=1500, so AGC will boost)
        byte[] input = new byte[960];
        for (int i = 0; i < input.Length / 2; i++)
        {
            short s = (short)(1000 * (i % 2 == 0 ? 1 : -1));
            input[i * 2] = (byte)(s & 0xFF);
            input[i * 2 + 1] = (byte)((s >> 8) & 0xFF);
        }
        byte[] output = new byte[input.Length];

        proc.Process(input, output);

        // Output RMS must be strictly greater than input RMS.
        // AGC: neededBoost = 1500/1000 = 1.5, gain = min(1.5, 4.0) = 1.5
        double inRms = Rms(input);
        double outRms = Rms(output);
        Assert.IsTrue(outRms > inRms * 1.4,
            $"expected output RMS > 1.4x input, got in={inRms:F1}, out={outRms:F1}");
    }

    private static double Rms(byte[] pcm16)
    {
        double sumSq = 0;
        int samples = pcm16.Length / 2;
        for (int i = 0; i < samples; i++)
        {
            short s = (short)(pcm16[i * 2] | (pcm16[i * 2 + 1] << 8));
            sumSq += (double)s * s;
        }
        return Math.Sqrt(sumSq / samples);
    }
}
