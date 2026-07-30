using SkiaSharp;

namespace Brmble.Server.Companions;

public static class CustomCompanionImageValidator
{
    private static ReadOnlySpan<byte> PngSignature => [0x89, (byte)'P', (byte)'N', (byte)'G', 0x0d, 0x0a, 0x1a, 0x0a];

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
        if (TryGetPngDimensions(bytes, out var pngWidth, out var pngHeight) &&
            HasUnsafeDimensions(pngWidth, pngHeight))
        {
            return new(CompanionImageValidationCode.UnsafeDimensions, null);
        }
        if (HasAnimationMarker(bytes))
            return new(CompanionImageValidationCode.AnimationNotSupported, null);

        using var data = SKData.CreateCopy(bytes);
        using var codec = SKCodec.Create(data);
        if (codec is null)
        {
            return new(IsRecognizedImagePrefix(bytes)
                ? CompanionImageValidationCode.InvalidImage
                : CompanionImageValidationCode.UnsupportedFormat, null);
        }

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

    private static bool TryGetPngDimensions(byte[] bytes, out int width, out int height)
    {
        width = 0;
        height = 0;
        if (bytes.Length < 24 ||
            !bytes.AsSpan(0, 8).SequenceEqual(PngSignature) ||
            !bytes.AsSpan(12, 4).SequenceEqual("IHDR"u8))
        {
            return false;
        }

        width = System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(16, 4));
        height = System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(20, 4));
        return true;
    }

    private static bool IsRecognizedImagePrefix(byte[] bytes) =>
        (bytes.Length >= 8 && bytes.AsSpan(0, 8).SequenceEqual(PngSignature)) ||
        (bytes.Length >= 12 && bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) &&
         bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8));

    private static bool HasAnimationMarker(byte[] bytes)
    {
        if (bytes.Length >= 37 && bytes.AsSpan(0, 8).SequenceEqual(PngSignature))
        {
            var offset = 8;
            while (offset <= bytes.Length - 12)
            {
                var length = System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(offset, 4));
                if (length < 0 || length > bytes.Length - offset - 12)
                    return false;
                if (bytes.AsSpan(offset + 4, 4).SequenceEqual("acTL"u8))
                    return true;
                offset += length + 12;
            }
        }

        if (bytes.Length >= 30 && bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) &&
            bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8) &&
            bytes.AsSpan(12, 4).SequenceEqual("VP8X"u8))
        {
            return (bytes[20] & 0x02) != 0;
        }

        return false;
    }
}
