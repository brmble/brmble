using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Audio.Processing;
using Brmble.Tools.ApmBench;

namespace Brmble.Audio.Tests.ApmBench;

[TestClass]
public class ArgsTests
{
    [TestMethod]
    public void Parse_MinimalValidArgs_ReturnsCorrectArgs()
    {
        var result = Args.Parse(new[] { "--in", "a.wav", "--out", "b.wav", "--ns", "high" });

        Assert.AreEqual("a.wav", result.Input);
        Assert.AreEqual("b.wav", result.Output);
        Assert.AreEqual(NoiseSuppressionLevel.High, result.NoiseSuppression);
        Assert.IsFalse(result.Metrics);
    }

    [TestMethod]
    public void Parse_MetricsFlag_ReturnsTrueMetrics()
    {
        var result = Args.Parse(new[] { "--in", "a.wav", "--out", "b.wav", "--ns", "high", "--metrics" });

        Assert.IsTrue(result.Metrics);
    }

    [DataTestMethod]
    [DataRow("off", NoiseSuppressionLevel.Off)]
    [DataRow("low", NoiseSuppressionLevel.Low)]
    [DataRow("moderate", NoiseSuppressionLevel.Moderate)]
    [DataRow("high", NoiseSuppressionLevel.High)]
    [DataRow("veryhigh", NoiseSuppressionLevel.VeryHigh)]
    [DataRow("very-high", NoiseSuppressionLevel.VeryHigh)]
    public void Parse_NsAliases_ReturnCorrectLevel(string nsStr, NoiseSuppressionLevel expected)
    {
        var result = Args.Parse(new[] { "--in", "a.wav", "--out", "b.wav", "--ns", nsStr });

        Assert.AreEqual(expected, result.NoiseSuppression);
    }

    [TestMethod]
    [ExpectedException(typeof(ArgumentException))]
    public void Parse_MissingRequired_Throws()
    {
        Args.Parse(new[] { "--in", "a.wav" });
    }

    [TestMethod]
    [ExpectedException(typeof(ArgumentException))]
    public void Parse_UnknownFlag_Throws()
    {
        Args.Parse(new[] { "--in", "a.wav", "--out", "b.wav", "--ns", "high", "--unknown" });
    }

    [TestMethod]
    [ExpectedException(typeof(ArgumentException))]
    public void Parse_UnknownNs_Throws()
    {
        Args.Parse(new[] { "--in", "a.wav", "--out", "b.wav", "--ns", "invalid" });
    }
}
