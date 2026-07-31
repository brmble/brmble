using System.Buffers.Binary;

namespace Brmble.Server.Paint;

public sealed record ImageMetadata(string MimeType, int Width, int Height);

public static class ImageMetadataReader
{
    public static ImageMetadata Read(byte[] data, string? declaredMimeType = null)
    {
        if (data.Length < 12)
        {
            throw new PaintValidationException("source image is invalid.");
        }

        if (IsPng(data, out var pngWidth, out var pngHeight))
        {
            return new("image/png", pngWidth, pngHeight);
        }

        if (IsJpeg(data, out var jpegWidth, out var jpegHeight))
        {
            return new("image/jpeg", jpegWidth, jpegHeight);
        }

        if (IsWebP(data, out var webpWidth, out var webpHeight))
        {
            return new("image/webp", webpWidth, webpHeight);
        }

        if (string.Equals(declaredMimeType, "image/gif", StringComparison.OrdinalIgnoreCase))
        {
            throw new PaintValidationException("gif sources are not supported.");
        }

        if (string.Equals(declaredMimeType, "image/svg+xml", StringComparison.OrdinalIgnoreCase))
        {
            throw new PaintValidationException("svg sources are not supported.");
        }

        throw new PaintValidationException("source image type is invalid.");
    }

    private static bool IsPng(byte[] data, out int width, out int height)
    {
        width = 0;
        height = 0;
        ReadOnlySpan<byte> signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        if (!data.AsSpan(0, 8).SequenceEqual(signature) || data.Length < 24)
        {
            return false;
        }

        width = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(16, 4));
        height = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(20, 4));
        return true;
    }

    private static bool IsJpeg(byte[] data, out int width, out int height)
    {
        width = 0;
        height = 0;
        if (data[0] != 0xFF || data[1] != 0xD8)
        {
            return false;
        }

        var offset = 2;
        while (offset + 8 < data.Length)
        {
            if (data[offset] != 0xFF)
            {
                offset++;
                continue;
            }

            var marker = data[offset + 1];
            offset += 2;
            if (marker == 0xD9 || marker == 0xDA)
            {
                break;
            }

            if (offset + 2 > data.Length)
            {
                break;
            }

            var segmentLength = BinaryPrimitives.ReadUInt16BigEndian(data.AsSpan(offset, 2));
            if (segmentLength < 2 || offset + segmentLength > data.Length)
            {
                break;
            }

            if (marker is >= 0xC0 and <= 0xC3 or >= 0xC5 and <= 0xC7 or >= 0xC9 and <= 0xCB or >= 0xCD and <= 0xCF)
            {
                if (segmentLength < 7)
                {
                    break;
                }

                height = BinaryPrimitives.ReadUInt16BigEndian(data.AsSpan(offset + 3, 2));
                width = BinaryPrimitives.ReadUInt16BigEndian(data.AsSpan(offset + 5, 2));
                return true;
            }

            offset += segmentLength;
        }

        return false;
    }

    private static bool IsWebP(byte[] data, out int width, out int height)
    {
        width = 0;
        height = 0;
        if (!data.AsSpan(0, 4).SequenceEqual("RIFF"u8) ||
            !data.AsSpan(8, 4).SequenceEqual("WEBP"u8) ||
            data.Length < 16)
        {
            return false;
        }

        var chunkType = data.AsSpan(12, 4);
        if (chunkType.SequenceEqual("VP8X"u8) && data.Length >= 30)
        {
            width = 1 + data[24] + (data[25] << 8) + (data[26] << 16);
            height = 1 + data[27] + (data[28] << 8) + (data[29] << 16);
            return true;
        }

        if (chunkType.SequenceEqual("VP8L"u8) && data.Length >= 25)
        {
            var bits = data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24);
            width = (bits & 0x3FFF) + 1;
            height = ((bits >> 14) & 0x3FFF) + 1;
            return true;
        }

        if (chunkType.SequenceEqual("VP8 "u8) && data.Length >= 30)
        {
            width = BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(26, 2)) & 0x3FFF;
            height = BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(28, 2)) & 0x3FFF;
            return true;
        }

        return false;
    }
}
