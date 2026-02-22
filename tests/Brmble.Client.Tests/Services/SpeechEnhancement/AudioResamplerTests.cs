using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Client.Services.SpeechEnhancement;

namespace Brmble.Client.Tests.Services.SpeechEnhancement;

[TestClass]
public class AudioResamplerTests
{
    [TestMethod]
    public void Resample_48kTo16k_ProducesCorrectLength()
    {
        var resampler = new AudioResampler(48000, 16000, 1);
        
        // 960 samples at 48kHz = 20ms
        var input48k = new float[960];
        for (int i = 0; i < 960; i++)
            input48k[i] = (float)Math.Sin(2 * Math.PI * 440 * i / 48000);
        
        var output16k = resampler.Resample(input48k);
        
        // Should be ~320 samples at 16kHz
        Assert.IsTrue(output16k.Length >= 300 && output16k.Length <= 340);
    }
}
