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
    public void Validate_RejectsSkiaIdentifiedUnsafeDimensionsBeforePixelAllocation(int width, int height)
    {
        var result = CustomCompanionImageValidator.Validate(ValidPngWithDimensions(width, height));

        Assert.AreEqual(CompanionImageValidationCode.UnsafeDimensions, result.Code);
        Assert.IsFalse(result.PixelBufferAllocated);
    }

    [TestMethod]
    public void Validate_DoesNotTrustCorruptPngDimensionsBeforeCodecDetection()
    {
        var result = CustomCompanionImageValidator.Validate(PngWithIhdrDimensions(4_096, 2_929));

        Assert.AreEqual(CompanionImageValidationCode.InvalidImage, result.Code);
    }

    [TestMethod]
    public void Validate_AcceptsSingleFramePngWithAnimationControlChunk()
    {
        var result = CustomCompanionImageValidator.Validate(PngWithAnimationControlChunk(1));

        Assert.IsTrue(result.IsValid);
        Assert.AreEqual(1, result.Image!.FrameCount);
    }

    [TestMethod]
    public void Validate_DoesNotTrustSpoofedPngDimensionsBeforeCodecDetection()
    {
        var result = CustomCompanionImageValidator.Validate(SpoofedPngHeader(4_097, 1));

        Assert.AreEqual(CompanionImageValidationCode.InvalidImage, result.Code);
    }

    [TestMethod]
    public void Validate_DoesNotTrustSpoofedPngAnimationMarkerBeforeCodecDetection()
    {
        var result = CustomCompanionImageValidator.Validate(SpoofedPngWithAnimationMarker());

        Assert.AreEqual(CompanionImageValidationCode.InvalidImage, result.Code);
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
    [DataRow("animated.webp", CompanionImageValidationCode.AnimationNotSupported)]
    [DataRow("animated.png", CompanionImageValidationCode.AnimationNotSupported)]
    public void Validate_UsesContainerAnimationMarkersWhenCodecFrameReportingIsIncomplete(
        string fixtureName,
        CompanionImageValidationCode expectedCode)
    {
        var result = CustomCompanionImageValidator.Validate(FixtureBytes(fixtureName));

        Assert.AreEqual(expectedCode, result.Code);
    }

    [DataTestMethod]
    [DataRow("truncated.png", CompanionImageValidationCode.InvalidImage)]
    [DataRow("truncated.webp", CompanionImageValidationCode.InvalidImage)]
    public void Validate_RejectsUndecodableContentWithoutTrustingItsPrefix(
        string fixtureName,
        CompanionImageValidationCode expectedCode)
    {
        var result = CustomCompanionImageValidator.Validate(FixtureBytes(fixtureName));

        Assert.AreEqual(expectedCode, result.Code);
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

    private static byte[] ValidPngWithDimensions(int width, int height)
    {
        using var bitmap = new SkiaSharp.SKBitmap(width, height);
        bitmap.Erase(SkiaSharp.SKColors.Transparent);
        using var image = SkiaSharp.SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SkiaSharp.SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }

    private static byte[] PngWithAnimationControlChunk(uint frameCount)
    {
        var source = FixtureBytes("valid.png");
        var chunk = new byte[20];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(chunk, 8);
        "acTL"u8.CopyTo(chunk.AsSpan(4));
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(chunk.AsSpan(8), frameCount);
        var crc = Crc32.Hash(chunk.AsSpan(4, 12));
        crc.CopyTo(chunk, 16);

        var result = new byte[source.Length + chunk.Length];
        source.AsSpan(0, 33).CopyTo(result);
        chunk.CopyTo(result, 33);
        source.AsSpan(33).CopyTo(result.AsSpan(33 + chunk.Length));
        return result;
    }

    private static byte[] SpoofedPngHeader(int width, int height)
    {
        var bytes = new byte[33];
        new byte[] { 0x89, (byte)'P', (byte)'N', (byte)'G', 0x0d, 0x0a, 0x1a, 0x0a }.CopyTo(bytes, 0);
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(8), 13);
        "IHDR"u8.CopyTo(bytes.AsSpan(12));
        System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(16), width);
        System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(20), height);
        return bytes;
    }

    private static byte[] SpoofedPngWithAnimationMarker()
    {
        var header = SpoofedPngHeader(1, 1);
        var marker = new byte[20];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(marker, 8);
        "acTL"u8.CopyTo(marker.AsSpan(4));
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(marker.AsSpan(8), 2);

        var result = new byte[header.Length + marker.Length];
        header.CopyTo(result, 0);
        marker.CopyTo(result, header.Length);
        return result;
    }
}
