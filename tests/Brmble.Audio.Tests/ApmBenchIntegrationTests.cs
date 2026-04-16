using System.IO;
using Brmble.Audio.Processing;
using Brmble.Tools.ApmBench;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using NAudio.Wave;

namespace Brmble.Audio.Tests;

[TestClass]
public class ApmBenchIntegrationTests
{
    public static readonly string FixturesDir =
        Path.Combine(Path.GetDirectoryName(typeof(ApmBenchIntegrationTests).Assembly.Location)!, "fixtures", "apm");

    [DataTestMethod]
    [DataRow("near_speech.wav", ProcessingStack.None)]
    [DataRow("near_speech.wav", ProcessingStack.Legacy)]
    [DataRow("near_speech.wav", ProcessingStack.WebRtcApm)]
    [DataRow("noise_speech.wav", ProcessingStack.None)]
    [DataRow("noise_speech.wav", ProcessingStack.Legacy)]
    [DataRow("noise_speech.wav", ProcessingStack.WebRtcApm)]
    public void RunStackAgainstFixture_ProducesValidOutput(string fixture, ProcessingStack stack)
    {
        string inPath = Path.Combine(FixturesDir, fixture);
        string outPath = Path.Combine(Path.GetTempPath(), $"{Path.GetFileNameWithoutExtension(fixture)}-{stack}.wav");

        int exit = Program.Main(new[] { "--in", inPath, "--out", outPath, "--stack", StackArg(stack) });
        Assert.AreEqual(0, exit, $"{fixture} stack={stack}: ApmBench.Main returned non-zero exit code");

        using var reader = new WaveFileReader(outPath);
        Assert.AreEqual(48000, reader.WaveFormat.SampleRate, $"{fixture} stack={stack}: output sample rate must be 48000");
        Assert.AreEqual(1, reader.WaveFormat.Channels, $"{fixture} stack={stack}: output must be mono");
        Assert.AreEqual(16, reader.WaveFormat.BitsPerSample, $"{fixture} stack={stack}: output must be 16-bit");
        Assert.IsTrue(reader.Length > 0, $"{fixture} stack={stack}: output must not be empty");

        // Sanity: output RMS is within a broad range of the input.
        var inStats = ReadStats(inPath);
        var outStats = ReadStats(outPath);
        double low = inStats.RmsDbfs - 15;
        double high = inStats.RmsDbfs + 15;
        Assert.IsTrue(outStats.RmsDbfs >= low && outStats.RmsDbfs <= high,
            $"{fixture} stack={stack}: input RMS {inStats.RmsDbfs:F1} dBFS vs output {outStats.RmsDbfs:F1} dBFS — outside ±15 dB range");
    }

    private static AudioStats ReadStats(string path)
    {
        using var reader = new WaveFileReader(path);
        using var ms = new MemoryStream();
        reader.CopyTo(ms);
        return Metrics.Measure(ms.ToArray());
    }

    private static string StackArg(ProcessingStack stack) => stack switch
    {
        ProcessingStack.None => "none",
        ProcessingStack.Legacy => "legacy",
        ProcessingStack.WebRtcApm => "apm",
        _ => throw new InvalidOperationException(),
    };
}
