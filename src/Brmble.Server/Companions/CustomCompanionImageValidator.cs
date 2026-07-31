using System.Buffers.Binary;
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
        var container = DetectContainer(bytes);
        var hasAnimation = container switch
        {
            ImageContainer.Png => HasAnimatedPngControlChunk(bytes),
            ImageContainer.Webp => HasAnimatedWebpChunk(bytes),
            _ => false
        };

        using var data = SKData.CreateCopy(bytes);
        using var codec = SKCodec.Create(data);
        if (codec is null)
        {
            if (container == ImageContainer.Webp && hasAnimation)
                return new(CompanionImageValidationCode.AnimationNotSupported, null);
            return new(
                container == ImageContainer.Unknown
                    ? CompanionImageValidationCode.UnsupportedFormat
                    : CompanionImageValidationCode.InvalidImage,
                null);
        }

        var mimeType = codec.EncodedFormat switch
        {
            SKEncodedImageFormat.Png => "image/png",
            SKEncodedImageFormat.Webp => "image/webp",
            _ => null
        };
        if (mimeType is null)
            return new(CompanionImageValidationCode.UnsupportedFormat, null);

        if (hasAnimation)
            return new(CompanionImageValidationCode.AnimationNotSupported, null);

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

    private static ImageContainer DetectContainer(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length >= 8 &&
            bytes[..8].SequenceEqual(new byte[]
            {
                0x89, (byte)'P', (byte)'N', (byte)'G', 0x0d, 0x0a, 0x1a, 0x0a
            }))
        {
            return ImageContainer.Png;
        }

        if (bytes.Length >= 12 &&
            bytes[..4].SequenceEqual("RIFF"u8) &&
            bytes.Slice(8, 4).SequenceEqual("WEBP"u8))
        {
            return ImageContainer.Webp;
        }

        return ImageContainer.Unknown;
    }

    private static bool HasAnimatedPngControlChunk(ReadOnlySpan<byte> bytes)
    {
        var offset = 8;
        while (offset <= bytes.Length - 12)
        {
            var length = BinaryPrimitives.ReadUInt32BigEndian(bytes.Slice(offset, 4));
            var chunkSize = 12L + length;
            if (chunkSize > bytes.Length - offset)
                return false;

            var type = bytes.Slice(offset + 4, 4);
            if (type.SequenceEqual("acTL"u8) && length >= 8)
            {
                return BinaryPrimitives.ReadUInt32BigEndian(bytes.Slice(offset + 8, 4)) > 1;
            }

            offset += checked((int)chunkSize);
        }

        return false;
    }

    private static bool HasAnimatedWebpChunk(ReadOnlySpan<byte> bytes)
    {
        var offset = 12;
        while (offset <= bytes.Length - 8)
        {
            var type = bytes.Slice(offset, 4);
            var length = BinaryPrimitives.ReadUInt32LittleEndian(bytes.Slice(offset + 4, 4));
            var paddedLength = (long)length + (length & 1);
            if (paddedLength > bytes.Length - offset - 8)
                return false;

            if (type.SequenceEqual("ANIM"u8))
                return true;
            if (type.SequenceEqual("VP8X"u8) &&
                length >= 1 &&
                (bytes[offset + 8] & 0x02) != 0)
            {
                return true;
            }

            offset += checked((int)(8 + paddedLength));
        }

        return false;
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

    private enum ImageContainer
    {
        Unknown,
        Png,
        Webp
    }
}
