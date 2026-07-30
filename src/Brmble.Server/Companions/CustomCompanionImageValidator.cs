using SkiaSharp;

namespace Brmble.Server.Companions;

public static class CustomCompanionImageValidator
{
    public static CompanionImageValidationResult Validate(byte[] bytes)
    {
        try
        {
            return ValidateCore(bytes);
        }
        catch (ArgumentException)
        {
            return new(CompanionImageValidationCode.InvalidImage, null);
        }
        catch (InvalidOperationException)
        {
            return new(CompanionImageValidationCode.InvalidImage, null);
        }
    }

    private static CompanionImageValidationResult ValidateCore(byte[] bytes)
    {
        using var data = SKData.CreateCopy(bytes);
        using var codec = SKCodec.Create(data);
        if (codec is null)
            return new(CompanionImageValidationCode.UnsupportedFormat, null);

        var mimeType = codec.EncodedFormat switch
        {
            SKEncodedImageFormat.Png => "image/png",
            SKEncodedImageFormat.Webp => "image/webp",
            _ => null
        };
        if (mimeType is null)
            return new(CompanionImageValidationCode.UnsupportedFormat, null);

        var width = codec.Info.Width;
        var height = codec.Info.Height;
        if (HasUnsafeDimensions(width, height))
            return new(CompanionImageValidationCode.UnsafeDimensions, null);

        var frameCount = Math.Max(1, codec.FrameCount);
        if (frameCount > CustomCompanionOptions.MaxFrames)
            return new(CompanionImageValidationCode.AnimationNotSupported, null);

        var decodeInfo = new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul);
        using var bitmap = new SKBitmap(decodeInfo);
        var decodeResult = codec.GetPixels(bitmap.Info, bitmap.GetPixels());
        if (decodeResult != SKCodecResult.Success)
        {
            return new(
                CompanionImageValidationCode.InvalidImage,
                null,
                PixelBufferAllocated: true);
        }

        return new(
            CompanionImageValidationCode.Valid,
            new(mimeType, width, height, frameCount),
            PixelBufferAllocated: true);
    }

    private static bool HasUnsafeDimensions(int width, int height)
    {
        long pixels;
        try
        {
            pixels = checked((long)width * height);
        }
        catch (OverflowException)
        {
            return true;
        }

        return width <= 0 || height <= 0 ||
            width > CustomCompanionOptions.MaxWidth ||
            height > CustomCompanionOptions.MaxHeight ||
            pixels > CustomCompanionOptions.MaxPixels ||
            checked(pixels * 4) > CustomCompanionOptions.MaxDecodedBytes;
    }

}
