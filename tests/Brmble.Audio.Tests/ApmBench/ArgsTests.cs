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
        var result = Args.Parse(new[] { "--in", "a.wav", "--out", "b.wav", "--stack", "apm" });

        Assert.AreEqual("a.wav", result.Input);
        Assert.AreEqual("b.wav", result.Output);
        Assert.AreEqual(ProcessingStack.WebRtcApm, result.Stack);
        Assert.IsFalse(result.Metrics);
    }

    [TestMethod]
    public void Parse_MetricsFlag_ReturnsTrueMetrics()
    {
        var result = Args.Parse(new[] { "--in", "a.wav", "--out", "b.wav", "--stack", "apm", "--metrics" });

        Assert.IsTrue(result.Metrics);
    }

    [DataTestMethod]
    [DataRow("none", ProcessingStack.None)]
    [DataRow("legacy", ProcessingStack.Legacy)]
    [DataRow("apm", ProcessingStack.WebRtcApm)]
    [DataRow("webrtcapm", ProcessingStack.WebRtcApm)]
    public void Parse_StackAliases_ReturnCorrectStack(string stackStr, ProcessingStack expectedStack)
    {
        var result = Args.Parse(new[] { "--in", "a.wav", "--out", "b.wav", "--stack", stackStr });

        Assert.AreEqual(expectedStack, result.Stack);
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
        Args.Parse(new[] { "--in", "a.wav", "--out", "b.wav", "--stack", "apm", "--unknown" });
    }

    [TestMethod]
    [ExpectedException(typeof(ArgumentException))]
    public void Parse_UnknownStack_Throws()
    {
        Args.Parse(new[] { "--in", "a.wav", "--out", "b.wav", "--stack", "invalid" });
    }
}
