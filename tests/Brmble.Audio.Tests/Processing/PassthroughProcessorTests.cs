using Brmble.Audio.Processing;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Audio.Tests.Processing;

[TestClass]
public class PassthroughProcessorTests
{
    [TestMethod]
    public void Process_CopiesInputToOutputExactly()
    {
        using var proc = new PassthroughProcessor();
        byte[] input = new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 };
        byte[] output = new byte[input.Length];

        int written = proc.Process(input, output);

        Assert.AreEqual(input.Length, written);
        CollectionAssert.AreEqual(input, output);
    }

    [TestMethod]
    public void Process_EmptyInputWritesNothing()
    {
        using var proc = new PassthroughProcessor();
        byte[] output = new byte[8];

        int written = proc.Process(ReadOnlySpan<byte>.Empty, output);

        Assert.AreEqual(0, written);
    }
}
