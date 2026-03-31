using Microsoft.VisualStudio.TestTools.UnitTesting;
using MumbleVoiceEngine.Audio;
using System;

namespace MumbleVoiceEngine.Tests.Audio
{
    [TestClass]
    public class R8BrainResamplerTest
    {
        [TestMethod]
        public void Resample_SameRate_ReturnsInputLength()
        {
            using var resampler = new R8BrainResampler(48000, 48000, 960);
            var input = new double[960];
            for (int i = 0; i < 960; i++)
                input[i] = Math.Sin(2.0 * Math.PI * 400 * i / 48000);

            int outSamples = resampler.Process(input, out double[] output);
            Assert.IsTrue(Math.Abs(outSamples - 960) <= 1,
                $"Same-rate resample should return ~960 samples, got {outSamples}");
        }

        [TestMethod]
        public void Resample_44100To48000_ProducesCorrectRatio()
        {
            using var resampler = new R8BrainResampler(44100, 48000, 441);
            var input = new double[441]; // 10ms at 44.1kHz
            for (int i = 0; i < 441; i++)
                input[i] = Math.Sin(2.0 * Math.PI * 400 * i / 44100);

            // Process many blocks to amortize r8brain's internal filter latency
            int totalOut = 0;
            for (int block = 0; block < 100; block++)
            {
                int n = resampler.Process(input, out _);
                totalOut += n;
            }

            // 100 blocks x 441 = 44100 input at 44100 = 1s
            // Expected: 1s x 48000 = 48000 (+/- latency from filter warmup)
            Assert.IsTrue(totalOut > 46000 && totalOut < 49000,
                $"Expected ~48000 total output samples, got {totalOut}");
        }

        [TestMethod]
        public void Resample_48000To16000_Downsamples()
        {
            using var resampler = new R8BrainResampler(48000, 16000, 960);
            var input = new double[960]; // 20ms at 48kHz
            for (int i = 0; i < 960; i++)
                input[i] = Math.Sin(2.0 * Math.PI * 400 * i / 48000);

            int totalOut = 0;
            for (int block = 0; block < 100; block++)
            {
                int n = resampler.Process(input, out _);
                totalOut += n;
            }

            // 100 x 960 = 96000 at 48kHz = 2s
            // Expected: 2s x 16000 = 32000
            // r8brain's high-quality filter has significant latency for 3:1
            // downsampling, so the lower bound accounts for warmup delay
            Assert.IsTrue(totalOut > 28000 && totalOut < 33000,
                $"Expected ~32000 total output samples, got {totalOut}");
        }

        [TestMethod]
        public void Clear_ResetsState()
        {
            using var resampler = new R8BrainResampler(48000, 16000, 960);
            var input = new double[960];
            resampler.Process(input, out _);
            resampler.Clear();
            resampler.Process(input, out _);
        }

        [TestMethod]
        public void Dispose_PreventsUseAfterFree()
        {
            var resampler = new R8BrainResampler(48000, 16000, 960);
            resampler.Dispose();
            Assert.ThrowsException<ObjectDisposedException>(() =>
                resampler.Process(new double[960], out _));
        }
    }
}
