using System.Threading;
using Brmble.Audio.Processing;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using NAudio.Wave;

namespace Brmble.Audio.Tests.Processing;

[TestClass]
public class FixtureWaveProviderTests
{
    private static string FixturePath =>
        System.IO.Path.Combine(
            System.IO.Path.GetDirectoryName(typeof(FixtureWaveProviderTests).Assembly.Location)!,
            "fixtures", "apm", "near_speech.wav");

    [TestMethod]
    public void Start_EmitsDataAvailableAtCadence()
    {
        using var provider = new FixtureWaveProvider(FixturePath, frameMs: 20, loop: true);
        int count = 0;
        provider.DataAvailable += (_, _) => Interlocked.Increment(ref count);

        provider.StartRecording();
        Thread.Sleep(250);
        provider.StopRecording();

        Assert.IsTrue(count >= 6 && count <= 20,
            $"Expected callback count in [6, 20] but got {count}");
    }

    [TestMethod]
    public void WaveFormat_Is48kMono16Bit()
    {
        using var provider = new FixtureWaveProvider(FixturePath, frameMs: 20, loop: true);

        Assert.AreEqual(48000, provider.WaveFormat.SampleRate);
        Assert.AreEqual(1, provider.WaveFormat.Channels);
        Assert.AreEqual(16, provider.WaveFormat.BitsPerSample);
    }
}
