using System.IO.Hashing;
using Brmble.Server.Companions;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Companions;

[TestClass]
public sealed class CustomCompanionImageValidatorTests
{
    [DataTestMethod]
    [DataRow("valid.png", "image/png")]
    [DataRow("valid.webp", "image/webp")]
    public void Validate_AcceptsOnlyFullyDecodableStillImages(string fixtureName, string expectedMime)
    {
        var result = CustomCompanionImageValidator.Validate(FixtureBytes(fixtureName));

        Assert.IsTrue(result.IsValid);
        Assert.AreEqual(expectedMime, result.Image!.MimeType);
        Assert.AreEqual(1, result.Image.FrameCount);
    }

    [DataTestMethod]
    [DataRow(4_097, 1)]
    [DataRow(1, 4_097)]
    [DataRow(4_000, 3_001)]
    [DataRow(4_096, 2_930)]
    [DataRow(0, 1)]
    public void Validate_RejectsUnsafeMetadataBeforePixelAllocation(int width, int height)
    {
        var result = CustomCompanionImageValidator.Validate(PngWithIhdrDimensions(width, height));

        Assert.AreEqual(CompanionImageValidationCode.UnsafeDimensions, result.Code);
        Assert.IsFalse(result.PixelBufferAllocated);
    }

    [TestMethod]
    public void Validate_DoesNotRejectExactPixelBoundaryBeforeDecode()
    {
        var result = CustomCompanionImageValidator.Validate(PngWithIhdrDimensions(4_096, 2_929));

        Assert.AreNotEqual(CompanionImageValidationCode.UnsafeDimensions, result.Code);
    }

    [TestMethod]
    public void Validate_RejectsPlainTextAndJpeg()
    {
        Assert.AreEqual(CompanionImageValidationCode.UnsupportedFormat,
            CustomCompanionImageValidator.Validate("not an image"u8.ToArray()).Code);
        Assert.AreEqual(CompanionImageValidationCode.UnsupportedFormat,
            CustomCompanionImageValidator.Validate([0xff, 0xd8, 0xff, 0xd9]).Code);
    }

    [DataTestMethod]
    [DataRow("animated.webp")]
    [DataRow("animated.png")]
    public void Validate_RejectsMultipleFrames(string fixtureName)
    {
        var result = CustomCompanionImageValidator.Validate(FixtureBytes(fixtureName));

        Assert.AreEqual(CompanionImageValidationCode.AnimationNotSupported, result.Code);
    }

    [DataTestMethod]
    [DataRow("truncated.png")]
    [DataRow("truncated.webp")]
    public void Validate_RejectsRecognizedButUndecodableContent(string fixtureName)
    {
        var result = CustomCompanionImageValidator.Validate(FixtureBytes(fixtureName));

        Assert.AreEqual(CompanionImageValidationCode.InvalidImage, result.Code);
    }

    [TestMethod]
    public void Validate_UsesCheckedPixelMultiplication()
    {
        var result = CustomCompanionImageValidator.Validate(PngWithIhdrDimensions(int.MaxValue, int.MaxValue));

        Assert.AreEqual(CompanionImageValidationCode.UnsafeDimensions, result.Code);
        Assert.IsFalse(result.PixelBufferAllocated);
    }

    internal static byte[] FixtureBytes(string name) => File.ReadAllBytes(
        Path.Combine(AppContext.BaseDirectory, "Companions", "Fixtures", name));

    internal static byte[] PngWithIhdrDimensions(int width, int height)
    {
        var bytes = FixtureBytes("valid.png");
        BitConverter.GetBytes(System.Net.IPAddress.HostToNetworkOrder(width)).CopyTo(bytes, 16);
        BitConverter.GetBytes(System.Net.IPAddress.HostToNetworkOrder(height)).CopyTo(bytes, 20);
        var crc = Crc32.Hash(bytes.AsSpan(12, 17));
        crc.CopyTo(bytes, 29);
        return bytes;
    }
}
