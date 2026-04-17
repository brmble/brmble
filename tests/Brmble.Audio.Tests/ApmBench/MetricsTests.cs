using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Tools.ApmBench;

namespace Brmble.Audio.Tests.ApmBench;

[TestClass]
public class MetricsTests
{
    [TestMethod]
    public void Measure_Silence_ReturnsMinus120dBFS()
    {
        var pcm16 = new byte[960]; // all zeros
        var m = Metrics.Measure(pcm16);

        Assert.IsTrue(m.RmsDbfs <= -120.0, $"expected RmsDbfs <= -120.0, got {m.RmsDbfs}");
        Assert.AreEqual(0, m.ClippedSamples);
    }

    [TestMethod]
    public void Measure_FullScaleTone_ReturnsNearZero()
    {
        // alternating +32767 / -32768 int16 samples (full-scale square wave)
        var pcm16 = new byte[20];
        for (int i = 0; i < 10; i++)
        {
            if (i % 2 == 0)
            {
                // +32767: little-endian (0xFF, 0x7F)
                pcm16[i * 2] = 0xFF;
                pcm16[i * 2 + 1] = 0x7F;
            }
            else
            {
                // -32768: little-endian (0x00, 0x80)
                pcm16[i * 2] = 0x00;
                pcm16[i * 2 + 1] = 0x80;
            }
        }

        var m = Metrics.Measure(pcm16);

        Assert.IsTrue(m.RmsDbfs >= -0.5 && m.RmsDbfs <= 0.5, $"expected -0.5 <= RmsDbfs <= 0.5, got {m.RmsDbfs}");
        Assert.IsTrue(m.PeakDbfs >= -0.1 && m.PeakDbfs <= 0.1, $"expected -0.1 <= PeakDbfs <= 0.1, got {m.PeakDbfs}");
    }

    [TestMethod]
    public void Measure_CountsClippedSamples()
    {
        // 4 samples: {32767, -32768, 0, 100}
        var pcm16 = new byte[8];

        // Sample 0: 32767 (0xFF, 0x7F)
        pcm16[0] = 0xFF;
        pcm16[1] = 0x7F;

        // Sample 1: -32768 (0x00, 0x80)
        pcm16[2] = 0x00;
        pcm16[3] = 0x80;

        // Sample 2: 0 (0x00, 0x00)
        pcm16[4] = 0x00;
        pcm16[5] = 0x00;

        // Sample 3: 100 (0x64, 0x00)
        pcm16[6] = 0x64;
        pcm16[7] = 0x00;

        var m = Metrics.Measure(pcm16);

        Assert.AreEqual(2, m.ClippedSamples);
    }
}
