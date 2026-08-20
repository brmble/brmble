using Brmble.Server.Paint;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using SkiaSharp;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintSourceValidatorTests
{
    private static readonly byte[] ValidPng = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    private static readonly byte[] ValidJpeg = CreateValidImage(SKEncodedImageFormat.Jpeg);
    private static readonly byte[] ValidWebP = CreateValidImage(SKEncodedImageFormat.Webp);

    private static readonly byte[] Png5000x1 =
    [
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x13, 0x88, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
    ];

    private static readonly byte[] TruncatedPngWithDimensions =
    [
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    ];

    [TestMethod]
    public void Validate_AcceptsValidPngAndReturnsServerMetadata()
    {
        var source = new PaintSourceValidator().Validate("image/png", ValidPng);

        Assert.AreEqual("image/png", source.MimeType);
        Assert.AreEqual(1, source.Width);
        Assert.AreEqual(1, source.Height);
        Assert.AreEqual(ValidPng.Length, source.SizeBytes);
    }

    [TestMethod]
    public void Validate_AcceptsValidJpegAndReturnsServerMetadata()
    {
        var source = new PaintSourceValidator().Validate("image/jpeg", ValidJpeg);

        Assert.AreEqual("image/jpeg", source.MimeType);
        Assert.AreEqual(1, source.Width);
        Assert.AreEqual(1, source.Height);
        Assert.AreEqual(ValidJpeg.Length, source.SizeBytes);
    }

    [TestMethod]
    public void Validate_AcceptsValidWebPAndReturnsServerMetadata()
    {
        var source = new PaintSourceValidator().Validate("image/webp", ValidWebP);

        Assert.AreEqual("image/webp", source.MimeType);
        Assert.AreEqual(1, source.Width);
        Assert.AreEqual(1, source.Height);
        Assert.AreEqual(ValidWebP.Length, source.SizeBytes);
    }

    [TestMethod]
    public void Validate_UsesDecodedMimeTypeWhenDeclaredTypeDiffers()
    {
        var source = new PaintSourceValidator().Validate("image/jpeg", ValidPng);

        Assert.AreEqual("image/png", source.MimeType);
        Assert.AreEqual(1, source.Width);
        Assert.AreEqual(1, source.Height);
        Assert.AreEqual(ValidPng.Length, source.SizeBytes);
    }

    [TestMethod]
    public void Validate_RejectsUnsupportedMimeType()
        => Assert.ThrowsException<PaintValidationException>(() =>
            new PaintSourceValidator().Validate("image/svg+xml", ValidPng));

    [TestMethod]
    public void Validate_RejectsMoreThanTenMiB()
        => Assert.ThrowsException<PaintValidationException>(() =>
            new PaintSourceValidator().Validate("image/png", new byte[PaintSourceValidator.MaxSourceImageBytes + 1]));

    [TestMethod]
    public void Validate_RejectsImageWhoseDecodedDimensionsExceedTheCap()
        => Assert.ThrowsException<PaintValidationException>(() =>
            new PaintSourceValidator().Validate("image/png", Png5000x1));

    [TestMethod]
    public void Validate_RejectsCorruptBytesForSupportedMimeType()
        => Assert.ThrowsException<PaintValidationException>(() =>
            new PaintSourceValidator().Validate("image/png", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));

    [TestMethod]
    public void Validate_RejectsPngWithHeaderAndDimensionsButNoImageData()
        => Assert.ThrowsException<PaintValidationException>(() =>
            new PaintSourceValidator().Validate("image/png", TruncatedPngWithDimensions));

    private static byte[] CreateValidImage(SKEncodedImageFormat format)
    {
        using var bitmap = new SKBitmap(1, 1);
        bitmap.Erase(SKColors.Transparent);
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(format, 100);
        return data.ToArray();
    }
}
