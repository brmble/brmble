using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Client.Services.SpeechEnhancement;

namespace Brmble.Client.Tests.Services.SpeechEnhancement;

[TestClass]
public class AudioResamplerTests
{
    [TestMethod]
    public void Resample_48kTo16k_ProducesCorrectLength()
    {
        using var resampler = new AudioResampler(48000, 16000, 1);

        // 960 samples at 48kHz = 20ms
        var input48k = new float[960];
        for (int i = 0; i < 960; i++)
            input48k[i] = (float)Math.Sin(2 * Math.PI * 440 * i / 48000);

        // r8brain has warmup latency — first calls may return fewer samples.
        // Process many blocks so warmup cost is amortized.
        int totalOut = 0;
        for (int block = 0; block < 100; block++)
            totalOut += resampler.Resample(input48k).Length;

        // 100 blocks × 960 = 96000 at 48kHz = 2000ms
        // Expected: 2000ms × 16000 = 32000 (±warmup tolerance)
        Assert.IsTrue(totalOut > 29000 && totalOut < 35000,
            $"Expected ~32000 total output samples, got {totalOut}");
    }
}
