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
    [DataRow("near_speech.wav", NoiseSuppressionLevel.Off)]
    [DataRow("near_speech.wav", NoiseSuppressionLevel.High)]
    [DataRow("near_speech.wav", NoiseSuppressionLevel.VeryHigh)]
    [DataRow("noise_speech.wav", NoiseSuppressionLevel.Off)]
    [DataRow("noise_speech.wav", NoiseSuppressionLevel.High)]
    [DataRow("noise_speech.wav", NoiseSuppressionLevel.VeryHigh)]
    public void RunNsLevelAgainstFixture_ProducesValidOutput(string fixture, NoiseSuppressionLevel level)
    {
        string inPath = Path.Combine(FixturesDir, fixture);
        string outPath = Path.Combine(Path.GetTempPath(), $"{Path.GetFileNameWithoutExtension(fixture)}-{level}-{Guid.NewGuid():N}.wav");

        try
        {
            int exit = Program.Main(new[] { "--in", inPath, "--out", outPath, "--ns", NsArg(level) });
            Assert.AreEqual(0, exit, $"{fixture} ns={level}: ApmBench.Main returned non-zero exit code");

            using var reader = new WaveFileReader(outPath);
            Assert.AreEqual(48000, reader.WaveFormat.SampleRate, $"{fixture} ns={level}: output sample rate must be 48000");
            Assert.AreEqual(1, reader.WaveFormat.Channels, $"{fixture} ns={level}: output must be mono");
            Assert.AreEqual(16, reader.WaveFormat.BitsPerSample, $"{fixture} ns={level}: output must be 16-bit");
            Assert.IsTrue(reader.Length > 0, $"{fixture} ns={level}: output must not be empty");

            // Sanity: output RMS is within a broad range of the input.
            var inStats = ReadStats(inPath);
            var outStats = ReadStats(outPath);
            double low = inStats.RmsDbfs - 15;
            double high = inStats.RmsDbfs + 15;
            Assert.IsTrue(outStats.RmsDbfs >= low && outStats.RmsDbfs <= high,
                $"{fixture} ns={level}: input RMS {inStats.RmsDbfs:F1} dBFS vs output {outStats.RmsDbfs:F1} dBFS — outside ±15 dB range");
        }
        finally
        {
            try { File.Delete(outPath); } catch { }
        }
    }

    private static AudioStats ReadStats(string path)
    {
        using var reader = new WaveFileReader(path);
        using var ms = new MemoryStream();
        reader.CopyTo(ms);
        return Metrics.Measure(ms.ToArray());
    }

    private static string NsArg(NoiseSuppressionLevel level) => level switch
    {
        NoiseSuppressionLevel.Off => "off",
        NoiseSuppressionLevel.Low => "low",
        NoiseSuppressionLevel.Moderate => "moderate",
        NoiseSuppressionLevel.High => "high",
        NoiseSuppressionLevel.VeryHigh => "veryhigh",
        _ => throw new InvalidOperationException(),
    };
}
