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

    [TestMethod]
    public void Resample_48kTo16k_PassbandSignalIsPreserved()
    {
        // A 2 kHz tone is well below the 8 kHz Nyquist limit of 16 kHz audio;
        // it should survive the downsample with reasonable amplitude.
        var resampler = new AudioResampler(48000, 16000, 1);

        const int sampleCount = 4800; // 100 ms at 48 kHz
        const double freq = 2000.0;

        var input = new float[sampleCount];
        for (int i = 0; i < sampleCount; i++)
            input[i] = (float)Math.Sin(2 * Math.PI * freq * i / 48000);

        var output = resampler.Resample(input);

        // Skip the first and last few frames to avoid filter transients at boundaries.
        int skip = 32;
        double rms = 0;
        int count = output.Length - 2 * skip;
        for (int i = skip; i < output.Length - skip; i++)
            rms += output[i] * output[i];
        rms = Math.Sqrt(rms / count);

        // Sine amplitude is 1.0, so RMS ≈ 0.707; allow generous tolerance.
        Assert.IsTrue(rms > 0.5, $"Passband signal RMS {rms:F4} too low – signal was attenuated unexpectedly.");
    }

    [TestMethod]
    public void Resample_48kTo16k_StopbandSignalIsAttenuated()
    {
        // A 10 kHz tone is above the 8 kHz Nyquist limit of 16 kHz audio.
        // Without anti-aliasing it would alias back into the passband; with the
        // FIR filter it should be strongly attenuated.
        var resampler = new AudioResampler(48000, 16000, 1);

        const int sampleCount = 9600; // 200 ms at 48 kHz
        const double freq = 10000.0;

        var input = new float[sampleCount];
        for (int i = 0; i < sampleCount; i++)
            input[i] = (float)Math.Sin(2 * Math.PI * freq * i / 48000);

        var output = resampler.Resample(input);

        // Skip boundary transients before measuring energy.
        int skip = 32;
        double rms = 0;
        int count = output.Length - 2 * skip;
        for (int i = skip; i < output.Length - skip; i++)
            rms += output[i] * output[i];
        rms = Math.Sqrt(rms / count);

        // The Hamming-windowed FIR provides ~43 dB stopband attenuation,
        // so RMS should be well below 0.1 (−20 dB relative to full scale).
        Assert.IsTrue(rms < 0.1, $"Stopband signal RMS {rms:F4} too high – aliasing suppression is insufficient.");
    }

    [TestMethod]
    public void Resample_16kTo48k_ProducesCorrectLength()
    {
        // Upsampling should not apply an anti-aliasing filter.
        var resampler = new AudioResampler(16000, 48000, 1);

        const int sampleCount = 320; // 20 ms at 16 kHz
        var input = new float[sampleCount];
        for (int i = 0; i < sampleCount; i++)
            input[i] = (float)Math.Sin(2 * Math.PI * 440 * i / 16000);

        var output = resampler.Resample(input);

        // 320 samples × 3 = 960 samples at 48 kHz
        Assert.IsTrue(output.Length >= 900 && output.Length <= 980);
    }
}
